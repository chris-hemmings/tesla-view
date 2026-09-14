"""Tesla View – serves the 3D Lovelace card and its assets and registers the dashboard resource.

All vehicle logic lives in the card (frontend); this integration only makes the bundle reachable at /tesla_view/… and
adds it to the Lovelace resources (storage mode), the same way HACS registers plugins.
"""
from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import CARD_FILENAME, DOMAIN, URL_BASE, VERSION

_LOGGER = logging.getLogger(__name__)
FRONTEND_DIR = Path(__file__).parent / "frontend"
CARD_URL = f"{URL_BASE}/{CARD_FILENAME}"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    await _register_static_path(hass)
    await _register_lovelace_resource(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    await _remove_lovelace_resource(hass)
    return True


async def _register_static_path(hass: HomeAssistant) -> None:
    if hass.data.get(f"{DOMAIN}_static_registered"):
        return
    try:
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths(
            [StaticPathConfig(URL_BASE, str(FRONTEND_DIR), cache_headers=False)]
        )
    except ImportError:  # Home Assistant < 2024.7
        hass.http.register_static_path(URL_BASE, str(FRONTEND_DIR), cache_headers=False)
    hass.data[f"{DOMAIN}_static_registered"] = True
    _LOGGER.debug("Serving %s at %s", FRONTEND_DIR, URL_BASE)


def _lovelace_resources(hass: HomeAssistant):
    """Return (mode, resource collection) for the Lovelace frontend, tolerant to core versions."""
    lovelace = hass.data.get("lovelace")
    if lovelace is None:
        return None, None
    if isinstance(lovelace, dict):
        return lovelace.get("mode"), lovelace.get("resources")
    return getattr(lovelace, "mode", None), getattr(lovelace, "resources", None)


async def _register_lovelace_resource(hass: HomeAssistant) -> None:
    mode, resources = _lovelace_resources(hass)
    url = f"{CARD_URL}?v={VERSION}"
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
