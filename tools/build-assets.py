#!/usr/bin/env python3
"""Copy only the assets the Tesla View card needs from extracted/ into the integration's frontend/assets folder.

Walks the scene-overrides JSON files (car scenes, wheels, brakes, charge cable) and copies every referenced texture,
GLB/OBJ, plus the JSON tables, animations and the studio panorama. Skips wrap skins.
"""
import json, os, shutil, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "extracted")
DST = os.path.join(ROOT, "custom_components", "tesla_view", "frontend", "assets")

SCENES = {   # overrides json -> glb (or None for obj-based scenes)
    "model-y-juniper/scene-overrides.json": "model-y-juniper/Bayberry.glb",
    "model-y-standard-e41/scene-overrides.json": "model-y-standard-e41/BayberryE41.glb",
    "wheels/GeminiDark/scene-overrides.json": "wheels/GeminiDark/GeminiDark.glb",
    "wheels/Helix2/scene-overrides.json": "wheels/Helix2/Helix2.glb",
    "wheels/Helix2_Dark/scene-overrides.json": "wheels/Helix2/Helix2.glb",
    "brakes/Brakes_Std_F.json": None, "brakes/Brakes_Std_R.json": None,
    "charging/Charging_Cable/Charging_Cable_CCS2_V3.json": None,
}
EXTRA = ["paint-colors.json", "wheel-map.json", "shared/environment/studio/New_Studio.png",
         "brakes/Textures/Brakes_Std_BC.png", "brakes/Textures/Brakes_Std_MRA.png",
         ]

def refs(desc):
    for k, v in desc.items():
        if isinstance(v, str) and v.lower().endswith((".png", ".jpg", ".webp", ".obj", ".glb")) and "/" in v:
            yield v
        elif isinstance(v, dict):
            yield from refs(v)

files = set(EXTRA)
for ov, glb in SCENES.items():
    files.add(ov)
    if glb: files.add(glb)
    d = json.load(open(os.path.join(SRC, ov)))
    for m in d["materials"].values(): files.update(refs(m))
    for n in d["nodes"].values():
        if n.get("mesh"): files.add(n["mesh"])
    anims = os.path.join(SRC, os.path.dirname(ov), "animations", "json")
    if os.path.isdir(anims):
        for f in os.listdir(anims): files.add(os.path.join(os.path.dirname(ov), "animations", "json", f))
files = {f for f in files if "/Skins/" not in f}

copied = 0; missing = []
for rel in sorted(files):
    src = os.path.join(SRC, rel)
    if not os.path.exists(src): missing.append(rel); continue
    dst = os.path.join(DST, rel); os.makedirs(os.path.dirname(dst), exist_ok=True)
    if not os.path.exists(dst) or os.path.getmtime(src) > os.path.getmtime(dst): shutil.copy2(src, dst)
    copied += 1
total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(DST) for f in fs)
print(f"{copied} files → {os.path.relpath(DST, ROOT)} ({total/1e6:.1f} MB)")
if missing: print("missing:", missing); sys.exit(1)
