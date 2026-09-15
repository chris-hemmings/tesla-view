# Migrating from a manual 0.1.x install to 0.2.0 (HACS + asset packs)

0.1.x was installed by copying a folder that contained the 3D assets. 0.2.0 ships no assets; you build an asset pack
from your own copy of the Tesla app and upload it. Dashboards and card configs are kept.

1. **Build your pack** with [tesla-view-extractor](https://github.com/koenhendriks/tesla-view-extractor):
   `tesla-view-extract Tesla_<version>.apks --models bayberry` (Model Y 2025+ Premium; `bayberry_e41` for the Standard).
2. **Keep the Tesla View config entry** – do not delete the integration in Settings; its entry carries over unchanged.
3. **Replace the code**: remove `config/custom_components/tesla_view/` (the manual copy), then install through HACS
   (custom repository `https://github.com/koenhendriks/tesla-view`, category *Integration*) or unpack the release
   `tesla_view.zip` into that folder. Restart Home Assistant.
4. On startup the integration rewrites the dashboard resource URL to the new version and raises the Repairs item
   **"Tesla View has no asset pack"**. Open it (Settings → Repairs → Fix) and upload the zip from step 1 – or use
   Settings → Devices & services → Tesla View → Configure → Upload.
5. Hard-refresh the dashboard (or unregister the site's service worker once). Existing cards keep working:
   `model: juniper` / `standard` resolve through aliases to the pack's `bayberry` / `bayberry_e41`, `paint: Quicksilver`
   and `wheels: Crossflow19` are pack names, `camera: parked|top_down` are pack presets. New options: `seats`, `cable`.

Dashboards live in `.storage/lovelace*`, independent of the integration; a normal Home Assistant backup covers them.
Packs are stored in `<config>/tesla_view/packs/` and survive future updates.
