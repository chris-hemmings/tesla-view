#!/usr/bin/env python3
"""Serve the *built* Tesla View bundle the way Home Assistant does, for a smoke test without HA.

  /tesla_view/…   → custom_components/tesla_view/frontend/   (bundle + assets, same URLs as in HA)
  /               → a test page that loads the bundle with a fake `hass` (trunk + charge port open, cable charging)

Usage:  python3 tools/smoke-server.py [port]       (default 8766)   → open http://127.0.0.1:<port>/
The page exposes `window.card` and `window.setState(entity_id, state)` for scripted checks.
"""
import http.server, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "custom_components", "tesla_view", "frontend")
VERSION = re.search(r'VERSION\s*=\s*"([^"]+)"', open(os.path.join(ROOT, "custom_components/tesla_view/const.py")).read()).group(1)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8766

PAGE = f"""<!doctype html><meta charset="utf-8"><title>tesla-view-card – built bundle smoke test</title>
<style>body{{margin:0;background:#161718;color:#ccc;font:13px system-ui}} tesla-view-card{{display:block;width:800px;margin:16px}} ha-card{{display:block}}</style>
<tesla-view-card></tesla-view-card>
<p style="margin:16px">bundle: <code>/tesla_view/tesla-view-card.js?v={VERSION}</code> — use <code>setState('cover.y_trunk','closed')</code> in the console.</p>
<script type="module">
  import '/tesla_view/tesla-view-card.js?v={VERSION}';
  const now = () => new Date().toISOString();
  const states = {{}};
  const st = (id, state) => states[id] = {{ entity_id: id, state, attributes: {{}}, last_changed: now(), last_updated: now() }};
  st('cover.y_frunk','closed'); st('cover.y_trunk','open'); st('cover.y_port','open'); st('binary_sensor.y_cable','on');
  st('sensor.y_charging','charging'); st('lock.y','locked');
  const card = document.querySelector('tesla-view-card');
  const publish = () => card.hass = {{ states: {{ ...states }}, themes: {{ darkMode: true }},
    callService: async (...a) => console.log('callService', a), callWS: async () => [] }};
  card.setConfig({{ type: 'custom:tesla-view-card', entities: {{ frunk: 'cover.y_frunk', trunk: 'cover.y_trunk',
    charge_port: 'cover.y_port', charge_cable: 'binary_sensor.y_cable', charging: 'sensor.y_charging', lock: 'lock.y' }} }});
  publish();
  window.card = card; window.setState = (id, s) => {{ st(id, s); publish(); }};
</script>"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=FRONTEND, **kw)

    def translate_path(self, path):
        path = path.split("?", 1)[0]
        if path.startswith("/tesla_view/"):
            return super().translate_path(path[len("/tesla_view"):])
        return None

    def do_GET(self):
        if self.translate_path(self.path) is None:
            body = PAGE.encode()
            self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()

    def log_message(self, fmt, *args):
        if "404" in fmt % args or "500" in fmt % args: super().log_message(fmt, *args)


if not os.path.exists(os.path.join(FRONTEND, "tesla-view-card.js")):
    sys.exit("no built bundle – run `npm run build` in card/ first")
print(f"serving {FRONTEND} at http://127.0.0.1:{PORT}/tesla_view/  –  test page: http://127.0.0.1:{PORT}/")
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
