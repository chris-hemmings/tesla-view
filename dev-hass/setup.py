#!/usr/bin/env python3
"""One-shot setup of the dev Home Assistant for Tesla View (stdlib only, idempotent).

  docker compose up -d && python3 setup.py

1. waits for HA, 2. completes onboarding (creates the owner `dev` / `dev`), 3. adds the Tesla View config entry
(which serves /tesla_view/ and registers the Lovelace resource), 4. creates the storage-mode dashboard `dev-cards` with a
Tesla View card (for testing the visual editor), 5. checks the dummy entities and the card bundle.
Prints a short-lived access token you can use with curl / the REST API.
"""
import base64, json, os, socket, struct, sys, time, urllib.error, urllib.parse, urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8123"
USER, PASSWORD, NAME = "dev", "dev", "Dev"
CLIENT_ID = BASE + "/"


def req(path, data=None, token=None, method=None, form=False):
    body = None
    headers = {"Content-Type": "application/x-www-form-urlencoded" if form else "application/json"}
    if data is not None:
        body = urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(BASE + path, data=body, headers=headers, method=method or ("POST" if body is not None else "GET"))
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read()
            if not raw or "json" not in resp.headers.get("Content-Type", ""):
                return resp.status, raw
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw


def wait_for_ha():
    """/api/ answers 401 as soon as the HTTP server is up (the onboarding API disappears once onboarding is done)."""
    for _ in range(120):
        try:
            status, _ = req("/api/")
            if status in (200, 401):
                return
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            pass
        time.sleep(2)
    sys.exit(f"Home Assistant not reachable at {BASE}")


def token_from_code(code):
    status, tok = req("/auth/token", {"grant_type": "authorization_code", "code": code, "client_id": CLIENT_ID}, form=True)
    assert status == 200, tok
    return tok["access_token"]


def login():
    """Password login through the normal auth flow → access token."""
    status, flow = req("/auth/login_flow", {"client_id": CLIENT_ID, "handler": ["homeassistant", None], "redirect_uri": CLIENT_ID})
    assert status == 200, flow
    status, res = req(f"/auth/login_flow/{flow['flow_id']}", {"client_id": CLIENT_ID, "username": USER, "password": PASSWORD})
    assert status == 200 and res.get("type") == "create_entry", res
    return token_from_code(res["result"])


def onboard():
    status, steps = req("/api/onboarding")
    done = {s["step"]: s["done"] for s in steps} if status == 200 else {"user": True}   # 404 = onboarding finished earlier
    if done.get("user"):
        print("onboarding: already done, logging in")
        return login()
    status, res = req("/api/onboarding/users", {"client_id": CLIENT_ID, "name": NAME, "username": USER, "password": PASSWORD, "language": "en"})
    assert status == 200, res
    token = token_from_code(res["auth_code"])
    print(f"onboarding: created owner {USER!r} (password {PASSWORD!r})")
    status, res = req("/api/onboarding/core_config", {}, token)
    assert status == 200, res
    status, res = req("/api/onboarding/analytics", {}, token)
    assert status == 200, res
    status, res = req("/api/onboarding/integration", {"client_id": CLIENT_ID, "redirect_uri": CLIENT_ID}, token)
    assert status == 200, res
    print("onboarding: core_config / analytics / integration steps done")
    return token


def add_tesla_view(token):
    status, entries = req("/api/config/config_entries/entry?domain=tesla_view", token=token)
    if status == 200 and entries:
        print(f"tesla_view: config entry already present ({entries[0]['state']})")
        return
    status, flow = req("/api/config/config_entries/flow", {"handler": "tesla_view", "show_advanced_options": False}, token)
    assert status == 200 and flow.get("type") == "form", flow
    status, res = req(f"/api/config/config_entries/flow/{flow['flow_id']}", {}, token)
    assert status == 200 and res.get("type") == "create_entry", res
    print("tesla_view: config entry created")


class WS:
    """Tiny Home Assistant websocket client (the Lovelace dashboard API is websocket-only)."""

    def __init__(self, token):
        u = urllib.parse.urlparse(BASE)
        self.sock = socket.create_connection((u.hostname, u.port or 80), timeout=30)   # every recv/send times out → no silent hangs
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET /api/websocket HTTP/1.1\r\nHost: {u.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            head += self.sock.recv(1)
        assert b" 101 " in head.split(b"\r\n")[0], head
        self.buf = b""
        self.id = 0
        assert self.recv()["type"] == "auth_required"
        self.send_raw({"type": "auth", "access_token": token})
        assert self.recv()["type"] == "auth_ok"

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("websocket closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self):
        while True:
            b1, b2 = self._read(2)
            length = b2 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._read(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(length)
            op = b1 & 0x0F
            if op == 1:
                return json.loads(payload)
            if op == 9:                                   # ping → pong
                self.sock.sendall(bytes([0x8A, 0x80 | len(payload)]) + b"\0\0\0\0" + payload)
            elif op == 8:
                raise ConnectionError("websocket closed by server")

    def send_raw(self, msg):
        data = json.dumps(msg).encode()
        mask = os.urandom(4)
        header = bytes([0x81])
        if len(data) < 126:
            header += bytes([0x80 | len(data)])
        elif len(data) < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", len(data))
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", len(data))
        self.sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def call(self, msg):
        self.id += 1
        self.send_raw({"id": self.id, **msg})
        while True:
            res = self.recv()
            if res.get("id") == self.id:
                assert res.get("success"), res
                return res.get("result")


DEV_CARDS = {"title": "Dev cards", "views": [{"title": "Editor test", "path": "editor", "cards": [
    {"type": "custom:tesla-view-card", "paint": "Quicksilver",
     "entities": {"trunk": "cover.model_y_trunk", "charge_cable": "binary_sensor.model_y_charge_cable", "charging": "sensor.model_y_charging"}}]}]}


def add_dev_dashboard(token):
    """Storage-mode dashboard so the card's *visual editor* can be tested (the tesla-view dashboard is YAML mode)."""
    ws = WS(token)
    if not any(d["url_path"] == "dev-cards" for d in ws.call({"type": "lovelace/dashboards/list"})):
        ws.call({"type": "lovelace/dashboards/create", "url_path": "dev-cards", "title": "Dev cards", "icon": "mdi:pencil-ruler",
                 "mode": "storage", "show_in_sidebar": True, "require_admin": False})
        ws.call({"type": "lovelace/config/save", "url_path": "dev-cards", "config": DEV_CARDS})
        print("dashboard: created storage-mode dashboard /dev-cards with a Tesla View card")
    else:
        print("dashboard: /dev-cards already present")
    ws.sock.close()


def check(token):
    status, states = req("/api/states", token=token)
    ids = {s["entity_id"] for s in states}
    want = ["cover.model_y_frunk", "cover.model_y_trunk", "cover.model_y_charge_port_door", "lock.model_y_lock",
            "binary_sensor.model_y_charge_cable", "sensor.model_y_charging", "button.model_y_flash_lights",
            "binary_sensor.model_y_front_driver_door", "binary_sensor.model_y_rear_passenger_window"]
    missing = [w for w in want if w not in ids]
    print("dummy entities:", "all present" if not missing else f"MISSING {missing}")
    status, raw = req("/tesla_view/tesla-view-card.js")
    print(f"card bundle /tesla_view/tesla-view-card.js: HTTP {status}, {len(raw) / 1e3:.0f} kB")
    status, _ = req("/tesla_view/assets/paint-colors.json")
    print(f"card assets /tesla_view/assets/…: HTTP {status}")
    return not missing and status == 200


if __name__ == "__main__":
    wait_for_ha()
    tok = onboard()
    add_tesla_view(tok)
    add_dev_dashboard(tok)
    ok = check(tok)
    print(f"\ndashboards: {BASE}/tesla-view (YAML, dummy controls)   {BASE}/dev-cards (storage, visual editor)   login: {USER} / {PASSWORD}")
    print(f"access token (≈30 min): {tok}")
    sys.exit(0 if ok else 1)
