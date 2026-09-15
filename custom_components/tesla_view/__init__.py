"""Tesla View – 3D Lovelace card driven by your entities, rendered from a user-supplied asset pack.

The integration:
* serves the card bundle at ``/tesla_view/`` and the installed asset packs at ``/tesla_view_assets/``,
* registers the card as a Lovelace resource (storage-mode dashboards) with cache-busting query parameters,
* stores asset packs uploaded through the UI under ``<config>/tesla_view/`` (survives HACS upgrades),
* raises a Repairs issue while no pack is installed.

All vehicle logic lives in the card (frontend).
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.file_upload import process_uploaded_file
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir

from . import packs
from .const import ASSETS_URL_BASE, CARD_FILENAME, DOCS_PACK_URL, DOMAIN, ISSUE_NO_PACK, URL_BASE, VERSION

_LOGGER = logging.getLogger(__name__)
FRONTEND_DIR = Path(__file__).parent / "frontend"
CARD_URL = f"{URL_BASE}/{CARD_FILENAME}"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data_dir = await hass.async_add_executor_job(packs.ensure_dirs, hass.config.path())
    hass.data.setdefault(DOMAIN, {})["data_dir"] = data_dir
    await _register_static_paths(hass, data_dir)
    await async_register_lovelace_resource(hass)
    await async_update_repair_issue(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    await _remove_lovelace_resource(hass)
    ir.async_delete_issue(hass, DOMAIN, ISSUE_NO_PACK)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    _LOGGER.info(
        "Tesla View removed. Uploaded asset packs are kept in %s – delete that folder if you no longer need them",
        packs.data_dir(hass.config.path()),
    )


# ---------- static files ----------


async def _register_static_paths(hass: HomeAssistant, data_dir: Path) -> None:
    if hass.data[DOMAIN].get("static_registered"):
        return
    try:
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(URL_BASE, str(FRONTEND_DIR), cache_headers=False),
                StaticPathConfig(ASSETS_URL_BASE, str(data_dir), cache_headers=True),
            ]
        )
    except ImportError:  # Home Assistant < 2024.7
        hass.http.register_static_path(URL_BASE, str(FRONTEND_DIR), cache_headers=False)
        hass.http.register_static_path(ASSETS_URL_BASE, str(data_dir), cache_headers=True)
    hass.data[DOMAIN]["static_registered"] = True
    _LOGGER.debug("Serving %s at %s and %s at %s", FRONTEND_DIR, URL_BASE, data_dir, ASSETS_URL_BASE)


# ---------- Lovelace resource ----------


def _lovelace_resources(hass: HomeAssistant):
    """Return (mode, resource collection) for the Lovelace frontend, tolerant to core versions."""
    lovelace = hass.data.get("lovelace")
    if lovelace is None:
        return None, None
    if isinstance(lovelace, dict):
        return lovelace.get("mode"), lovelace.get("resources")
    return getattr(lovelace, "mode", None), getattr(lovelace, "resources", None)


async def _resource_url(hass: HomeAssistant) -> str:
    rev = await hass.async_add_executor_job(packs.index_rev, hass.config.path())
    return f"{CARD_URL}?v={VERSION}&assets={ASSETS_URL_BASE}/&p={rev}"


async def async_register_lovelace_resource(hass: HomeAssistant) -> None:
    mode, resources = _lovelace_resources(hass)
    url = await _resource_url(hass)
    if resources is None or mode == "yaml":
        _LOGGER.warning(
            "Lovelace is in YAML mode or resources are unavailable – add this resource manually: %s (type: module)", url
        )
        return
    if not getattr(resources, "loaded", True):
        await resources.async_load()
        resources.loaded = True
    for item in resources.async_items():
        if str(item.get("url", "")).split("?")[0] == CARD_URL:
            if item["url"] != url:
                await resources.async_update_item(item["id"], {"url": url})
                _LOGGER.info("Updated Tesla View card resource to %s", url)
            return
    await resources.async_create_item({"res_type": "module", "url": url})
    _LOGGER.info("Registered Tesla View card resource %s", url)


async def _remove_lovelace_resource(hass: HomeAssistant) -> None:
    mode, resources = _lovelace_resources(hass)
    if resources is None or mode == "yaml":
        return
    for item in list(resources.async_items()):
        if str(item.get("url", "")).split("?")[0] == CARD_URL:
            await resources.async_delete_item(item["id"])


# ---------- asset packs ----------


async def async_install_pack(hass: HomeAssistant, file_id: str) -> packs.PackInfo:
    """Move an uploaded zip (file_upload id) into the pack store. Raises packs.PackError."""

    def _do() -> packs.PackInfo:
        with process_uploaded_file(hass, file_id) as path:
            return packs.install_pack(hass.config.path(), path)

    info = await hass.async_add_executor_job(_do)
    _LOGGER.info(
        "Installed asset pack %s: models %s, %d wheels, %d paints, %.1f MB",
        info.id, ", ".join(info.models), len(info.wheels), len(info.paints), info.size_bytes / 1e6,
    )
    for model_id, model in (info.manifest.get("models") or {}).items():
        for warning in model.get("warnings") or []:
            _LOGGER.warning("Asset pack %s, model %s: %s", info.id, model_id, warning)
    await _after_pack_change(hass)
    return info


async def async_remove_pack(hass: HomeAssistant, pid: str) -> bool:
    ok = await hass.async_add_executor_job(packs.remove_pack, hass.config.path(), pid)
    if ok:
        _LOGGER.info("Removed asset pack %s", pid)
    await _after_pack_change(hass)
    return ok


async def async_list_packs(hass: HomeAssistant) -> list[packs.PackInfo]:
    return await hass.async_add_executor_job(packs.list_packs, hass.config.path())


async def _after_pack_change(hass: HomeAssistant) -> None:
    await hass.async_add_executor_job(packs.write_index, hass.config.path(), VERSION)
    await async_register_lovelace_resource(hass)
    await async_update_repair_issue(hass)


async def async_update_repair_issue(hass: HomeAssistant) -> None:
    if await hass.async_add_executor_job(packs.has_packs, hass.config.path()):
        ir.async_delete_issue(hass, DOMAIN, ISSUE_NO_PACK)
        return
    ir.async_create_issue(
        hass,
        DOMAIN,
        ISSUE_NO_PACK,
        is_fixable=True,
        severity=ir.IssueSeverity.WARNING,
        translation_key=ISSUE_NO_PACK,
        learn_more_url=DOCS_PACK_URL,
    )
    _LOGGER.warning("No Tesla View asset pack installed – the card shows instructions until one is uploaded")


@callback
def config_entry(hass: HomeAssistant) -> ConfigEntry | None:
    entries = hass.config_entries.async_entries(DOMAIN)
    return entries[0] if entries else None
