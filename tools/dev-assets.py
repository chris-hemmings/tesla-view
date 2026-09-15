#!/usr/bin/env python3
"""Install asset pack zip(s) into the dev harness / smoke server data dir, exactly like the integration does.

  python3 tools/dev-assets.py tesla-view-pack-bayberry.zip [more.zip …]     (or: npm run dev:assets -- pack.zip)

Uses custom_components/tesla_view/packs.py (no Home Assistant needed) and writes to card/dev/public/tesla_view/,
which Vite serves at http://127.0.0.1:5173/tesla_view/ (card/dev/index.html points TESLA_VIEW_ASSET_BASE there).
"""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "card" / "dev" / "public"   # = the "config dir"; packs.py appends tesla_view/

spec = importlib.util.spec_from_file_location("tv_packs", ROOT / "custom_components" / "tesla_view" / "packs.py")
packs = importlib.util.module_from_spec(spec)
sys.modules["tv_packs"] = packs   # dataclasses need the module registered
spec.loader.exec_module(packs)

if len(sys.argv) < 2:
    sys.exit(__doc__)
PUBLIC.mkdir(parents=True, exist_ok=True)
packs.ensure_dirs(PUBLIC)
for arg in sys.argv[1:]:
    try:
        info = packs.install_pack(PUBLIC, arg)
    except packs.PackError as err:
        sys.exit(f"{arg}: rejected ({err.code}) {err.detail}")
    print(f"installed {info.id}: models {', '.join(info.models)}, {len(info.wheels)} wheels, {info.size_bytes / 1e6:.1f} MB")
index = packs.write_index(PUBLIC, "dev")
print(f"index: {len(index['models'])} model(s) → {packs.index_path(PUBLIC)}  (rev {index['rev']})")
