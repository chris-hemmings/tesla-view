"""Repairs: fix flow for the "no asset pack installed" issue – upload one right there."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.components.repairs import RepairsFlow
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector

from . import async_install_pack
from .const import CONF_PACK_FILE, DOCS_PACK_URL, EXTRACTOR_URL
from .packs import PackError


class NoAssetPackRepairFlow(RepairsFlow):
    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        return await self.async_step_upload()

    async def async_step_upload(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                await async_install_pack(self.hass, user_input[CONF_PACK_FILE])
            except PackError as err:
                errors[CONF_PACK_FILE] = err.code
            except Exception:  # noqa: BLE001
                errors["base"] = "unknown"
            else:
                return self.async_create_entry(data={})
        return self.async_show_form(
            step_id="upload",
            data_schema=vol.Schema(
                {vol.Required(CONF_PACK_FILE): selector.FileSelector(selector.FileSelectorConfig(accept=".zip,application/zip"))}
            ),
            errors=errors,
            description_placeholders={"extractor_url": EXTRACTOR_URL, "docs_url": DOCS_PACK_URL},
        )


async def async_create_fix_flow(hass: HomeAssistant, issue_id: str, data: dict[str, Any] | None) -> RepairsFlow:
    return NoAssetPackRepairFlow()
