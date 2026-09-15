"""Config flow (single instance, optional pack upload) and options flow (upload / remove packs) for Tesla View."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import selector

from . import async_install_pack, async_list_packs, async_remove_pack
from .const import CONF_PACK, CONF_PACK_FILE, DOCS_PACK_URL, DOMAIN, EXTRACTOR_URL
from .packs import PackError

_LOGGER = logging.getLogger(__name__)

PACK_FILE_SELECTOR = selector.FileSelector(selector.FileSelectorConfig(accept=".zip,application/zip"))
PLACEHOLDERS = {"extractor_url": EXTRACTOR_URL, "docs_url": DOCS_PACK_URL}


async def _try_install(hass, file_id: str | None, errors: dict[str, str]) -> bool:
    """Install an uploaded pack; fill `errors` and return False on failure."""
    if not file_id:
        return True
    try:
        await async_install_pack(hass, file_id)
    except PackError as err:
        _LOGGER.warning("Asset pack rejected: %s", err)
        errors[CONF_PACK_FILE] = err.code
        return False
    except Exception:  # noqa: BLE001
        _LOGGER.exception("Unexpected error while installing an asset pack")
        errors["base"] = "unknown"
        return False
    return True


class TeslaViewConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        errors: dict[str, str] = {}
        if user_input is not None:
            if await _try_install(self.hass, user_input.get(CONF_PACK_FILE), errors):
                return self.async_create_entry(title="Tesla View", data={})
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Optional(CONF_PACK_FILE): PACK_FILE_SELECTOR}),
            errors=errors,
            description_placeholders=PLACEHOLDERS,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> TeslaViewOptionsFlow:
        return TeslaViewOptionsFlow()


class TeslaViewOptionsFlow(OptionsFlow):
    """Configure → menu: upload a pack, remove a pack."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        packs = await async_list_packs(self.hass)
        summary = ", ".join(f"{p.id} ({', '.join(p.models)})" for p in packs) or "none"
        return self.async_show_menu(
            step_id="init",
            menu_options=["upload", "remove"],
            description_placeholders={"packs": summary, **PLACEHOLDERS},
        )

    async def async_step_upload(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            if await _try_install(self.hass, user_input.get(CONF_PACK_FILE), errors) and user_input.get(CONF_PACK_FILE):
                return self.async_create_entry(title="", data={})
            if not user_input.get(CONF_PACK_FILE):
                errors[CONF_PACK_FILE] = "no_file"
        return self.async_show_form(
            step_id="upload",
            data_schema=vol.Schema({vol.Required(CONF_PACK_FILE): PACK_FILE_SELECTOR}),
            errors=errors,
            description_placeholders=PLACEHOLDERS,
        )

    async def async_step_remove(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        packs = await async_list_packs(self.hass)
        if not packs:
            return self.async_abort(reason="no_packs")
        if user_input is not None:
            await async_remove_pack(self.hass, user_input[CONF_PACK])
            return self.async_create_entry(title="", data={})
        options = [
            selector.SelectOptionDict(value=p.id, label=f"{', '.join(p.models)} – {p.size_bytes / 1e6:.0f} MB ({p.id})")
            for p in packs
        ]
        return self.async_show_form(
            step_id="remove",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_PACK): selector.SelectSelector(
                        selector.SelectSelectorConfig(options=options, mode=selector.SelectSelectorMode.DROPDOWN)
                    )
                }
            ),
        )
