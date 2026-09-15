"""Asset-pack storage for Tesla View: validate uploaded zips, unpack them, keep an index for the card.

Pure Python on purpose (no Home Assistant imports) so the dev tooling (`tools/dev-assets.py`) can reuse it.

Layout under ``<config>/tesla_view/``::

    index.json                     ← written here; the card reads it first
    packs/<pack_id>/manifest.json  ← one unzipped pack (paths inside are pack-relative)
    packs/<pack_id>/Ego/…          ← models, textures, animations …

``pack_id`` = joined sorted model ids + short sha256 of the zip, so every asset URL is immutable and can be cached
forever; re-uploading a pack for the same models replaces the old directory.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import os
import posixpath
import re
import shutil
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_LOGGER = logging.getLogger(__name__)

PACK_FORMAT = 1
DATA_DIR_NAME = "tesla_view"
PACKS_DIR_NAME = "packs"
INDEX_FILENAME = "index.json"
MAX_UNCOMPRESSED = 1500 * 1024 * 1024
MODEL_ID_RE = re.compile(r"^[a-z0-9_]+$")


class PackError(Exception):
    """A pack was rejected. ``code`` doubles as the translation key of the error shown in the UI."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


@dataclass
class PackInfo:
    id: str
    dir: str  # relative to the data dir, with trailing slash
    models: list[str]
    wheels: list[str]
    paints: list[str]
    app_version: str | None
    generated_by: dict[str, Any] | None
    generated_at: str | None
    installed_at: str | None
    size_bytes: int
    manifest: dict[str, Any] = field(repr=False, default_factory=dict)


# ---------- paths ----------


def data_dir(config_dir: str | Path) -> Path:
    return Path(config_dir) / DATA_DIR_NAME


def packs_dir(config_dir: str | Path) -> Path:
    return data_dir(config_dir) / PACKS_DIR_NAME


def index_path(config_dir: str | Path) -> Path:
    return data_dir(config_dir) / INDEX_FILENAME


def ensure_dirs(config_dir: str | Path) -> Path:
    """Create the data directory tree (must exist before the static path is registered) and an empty index."""
    d = data_dir(config_dir)
    packs_dir(config_dir).mkdir(parents=True, exist_ok=True)
    if not index_path(config_dir).exists():
        write_index(config_dir)
    return d


# ---------- validation ----------


def _safe_member(name: str) -> bool:
    if not name or name.startswith(("/", "\\")) or "\\" in name:
        return False
    if re.match(r"^[A-Za-z]:", name):
        return False
    parts = name.split("/")
    if any(p in ("..", "") for p in parts[:-1]) or parts[-1] == "..":
        return False
    return posixpath.normpath(name) == name.rstrip("/")


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    return ((info.external_attr >> 16) & 0o170000) == 0o120000


def _required_files(manifest: dict[str, Any]) -> list[str]:
    req: list[str] = []
    for model in manifest.get("models", {}).values():
        if model.get("glb"):
            req.append(model["glb"])
        if model.get("overrides"):
            req.append(model["overrides"])
        req += list((model.get("animations") or {}).values())
        for brake_set in (model.get("brakes") or {}).values():
            req += list(brake_set.values())
    for wheel in manifest.get("wheels", {}).values():
        if wheel.get("kind") in ("glb", "obj"):
            for key in ("glb", "overrides"):
                if wheel.get(key):
                    req.append(wheel[key])
    for cable in manifest.get("cables", {}).values():
        if isinstance(cable, dict) and cable.get("overrides"):
            req.append(cable["overrides"])
    return req


def inspect_zip(zip_path: str | Path) -> dict[str, Any]:
    """Validate a pack zip and return its manifest. Raises PackError."""
    zip_path = Path(zip_path)
    if not zipfile.is_zipfile(zip_path):
        raise PackError("not_zip")
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        if "manifest.json" not in names:
            raise PackError("no_manifest")
        try:
            manifest = json.loads(zf.read("manifest.json"))
        except (json.JSONDecodeError, UnicodeDecodeError) as err:
            raise PackError("bad_manifest", str(err)) from err
        if not isinstance(manifest, dict):
            raise PackError("bad_manifest", "not an object")
        if manifest.get("format") != PACK_FORMAT:
            raise PackError("unsupported_format", f"format {manifest.get('format')!r}, expected {PACK_FORMAT}")
        models = manifest.get("models")
        if not isinstance(models, dict) or not models:
            raise PackError("no_models")
        for model_id in models:
            if not MODEL_ID_RE.match(model_id):
                raise PackError("bad_model_id", model_id)
        total = 0
        for info in zf.infolist():
            if not _safe_member(info.filename) or _is_symlink(info):
                raise PackError("unsafe_path", info.filename)
            total += info.file_size
        if total > MAX_UNCOMPRESSED:
            raise PackError("too_large", f"{total // (1024 * 1024)} MiB uncompressed")
        name_set = set(names)
        missing = [f for f in _required_files(manifest) if f not in name_set]
        if missing:
            raise PackError("missing_file", ", ".join(missing[:5]))
        panorama = (manifest.get("environment") or {}).get("panorama")
        if panorama and panorama not in name_set:
            _LOGGER.warning("Asset pack has no panorama %s; reflections will be flat", panorama)
    return manifest


def pack_id(manifest: dict[str, Any], zip_path: str | Path) -> str:
    ids = "-".join(sorted(manifest["models"]))[:40].strip("-")
    digest = hashlib.sha256(Path(zip_path).read_bytes()).hexdigest()[:8]
    return f"{ids}-{digest}"


# ---------- install / remove ----------


def _read_manifest(pack_dir: Path) -> dict[str, Any] | None:
    try:
        return json.loads((pack_dir / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as err:
        _LOGGER.warning("Ignoring pack directory %s: %s", pack_dir, err)
        return None


def _dir_size(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())


def _info(config_dir: str | Path, pack_dir: Path, manifest: dict[str, Any]) -> PackInfo:
    wheels = [k for k, w in (manifest.get("wheels") or {}).items() if isinstance(w, dict) and w.get("kind") != "unsupported"]
    installed = None
    meta = pack_dir / ".installed.json"
    if meta.exists():
        try:
            installed = json.loads(meta.read_text()).get("installed_at")
        except (OSError, json.JSONDecodeError):
            installed = None
    return PackInfo(
        id=pack_dir.name,
        dir=f"{PACKS_DIR_NAME}/{pack_dir.name}/",
        models=list(manifest.get("models", {})),
        wheels=wheels,
        paints=list(((manifest.get("paints") or {}).get("colors") or {})),
        app_version=manifest.get("app_version"),
        generated_by=manifest.get("generated_by"),
        generated_at=manifest.get("generated_at"),
        installed_at=installed,
        size_bytes=_dir_size(pack_dir),
        manifest=manifest,
    )


def list_packs(config_dir: str | Path) -> list[PackInfo]:
    out: list[PackInfo] = []
    pdir = packs_dir(config_dir)
    if not pdir.exists():
        return out
    for child in sorted(pdir.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        manifest = _read_manifest(child)
        if manifest is None:
            continue
        out.append(_info(config_dir, child, manifest))
    out.sort(key=lambda p: p.installed_at or "", reverse=True)  # newest first
    return out


def has_packs(config_dir: str | Path) -> bool:
    return bool(list_packs(config_dir))


def install_pack(config_dir: str | Path, zip_path: str | Path) -> PackInfo:
    """Validate, unpack into packs/<id>/, drop packs whose model ids overlap, refresh the index."""
    manifest = inspect_zip(zip_path)
    pid = pack_id(manifest, zip_path)
    pdir = packs_dir(config_dir)
    pdir.mkdir(parents=True, exist_ok=True)
    final = pdir / pid
    staging = pdir / f".tmp-{pid}"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir()
    try:
        with zipfile.ZipFile(zip_path) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                target = staging / info.filename
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)
        (staging / ".installed.json").write_text(
            json.dumps({"installed_at": _now(), "source": Path(zip_path).name, "size_bytes": Path(zip_path).stat().st_size})
        )
        new_models = set(manifest["models"])
        for existing in list_packs(config_dir):
            if existing.id != pid and new_models & set(existing.models):
                _LOGGER.info("Replacing asset pack %s (models %s)", existing.id, existing.models)
                shutil.rmtree(pdir / existing.id, ignore_errors=True)
        if final.exists():
            shutil.rmtree(final)
        os.replace(staging, final)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    write_index(config_dir)
    return _info(config_dir, final, manifest)


def remove_pack(config_dir: str | Path, pid: str) -> bool:
    target = packs_dir(config_dir) / pid
    if not target.is_dir() or "/" in pid or pid.startswith("."):
        return False
    shutil.rmtree(target)
    write_index(config_dir)
    return True


# ---------- index ----------


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def build_index(config_dir: str | Path, integration_version: str | None = None) -> dict[str, Any]:
    packs = list_packs(config_dir)
    index: dict[str, Any] = {
        "format": 1,
        "generated_at": _now(),
        "integration_version": integration_version,
        "default_model": None,
        "packs": {},
        "models": {},
    }
    for p in packs:
        index["packs"][p.id] = {
            "dir": p.dir,
            "app_version": p.app_version,
            "generated_by": p.generated_by,
            "generated_at": p.generated_at,
            "installed_at": p.installed_at,
            "size_bytes": p.size_bytes,
            "models": p.models,
            "wheels": p.wheels,
            "paints": p.paints,
        }
        wheels = p.manifest.get("wheels") or {}
        for model_id, model in (p.manifest.get("models") or {}).items():
            if model_id in index["models"]:
                continue  # newest pack wins
            family = model.get("wheel_family")
            model_wheels = [
                k
                for k, w in wheels.items()
                if isinstance(w, dict)
                and w.get("kind") != "unsupported"
                and (w.get("family") == family or (family and str(w.get("dir", "")).startswith(family + "/")))
            ]
            index["models"][model_id] = {
                "pack": p.id,
                "name": model.get("name") or model_id,
                "codename": model.get("codename"),
                "aliases": model.get("aliases") or [],
                "api_match": model.get("api_match") or {},
                "variants": [k for k, v in (model.get("variants") or {}).items() if v],
                "wheel_family": family,
                "default_wheel": model.get("default_wheel"),
                "wheels": model_wheels,
            }
            if index["default_model"] is None:
                index["default_model"] = model_id
    index["rev"] = hashlib.sha1(json.dumps(index["packs"], sort_keys=True).encode()).hexdigest()[:8]
    return index


def write_index(config_dir: str | Path, integration_version: str | None = None) -> dict[str, Any]:
    index = build_index(config_dir, integration_version)
    data_dir(config_dir).mkdir(parents=True, exist_ok=True)
    tmp = index_path(config_dir).with_suffix(".json.tmp")
    tmp.write_text(json.dumps(index, indent=1), encoding="utf-8")
    os.replace(tmp, index_path(config_dir))
    return index


def read_index(config_dir: str | Path) -> dict[str, Any] | None:
    try:
        return json.loads(index_path(config_dir).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def index_rev(config_dir: str | Path) -> str:
    idx = read_index(config_dir)
    return str(idx.get("rev", "0")) if idx else "0"
