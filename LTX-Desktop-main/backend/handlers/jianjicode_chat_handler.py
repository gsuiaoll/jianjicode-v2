"""Handler for jianjicode AI chat — natural language video editing.

Uses HTTP POST to jianjicode server (Hono:3001) instead of subprocess CLI.
"""

from __future__ import annotations

import logging
import os
from threading import RLock
from typing import Any

import requests

from handlers.base import StateHandlerBase

if __package__:  # pragma: no cover
    from runtime_config.runtime_config import RuntimeConfig
    from state.app_state_types import AppState

logger = logging.getLogger(__name__)

_JIANJICODE_SERVER_URL = os.environ.get("JIANJICODE_SERVER_URL", "http://localhost:3001")


class JianjicodeChatHandler(StateHandlerBase):
    """Handles AI-powered natural language video editing via jianjicode HTTP API."""

    def __init__(self, state: AppState, lock: RLock, config: RuntimeConfig) -> None:
        super().__init__(state, lock, config)

    @property
    def _token(self) -> str:
        """每次请求时动态读取，确保 jianjicode 崩溃重启后 token 自动更新。"""
        return os.environ.get("JIANJICODE_TOKEN", "")

    def chat(
        self,
        prompt: str,
        provider: str | None = None,
        model: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        verbose: bool = False,
    ) -> dict[str, Any]:
        """Send a natural language video editing request to jianjicode AI.

        Uses HTTP POST to jianjicode server (configurable via JIANJICODE_SERVER_URL).
        Returns the parsed JSON result directly.
        """
        url = f"{_JIANJICODE_SERVER_URL}/chat"
        payload: dict[str, Any] = {
            "message": prompt,
            "args": {},
        }

        if model:
            payload["args"]["model"] = model
        if api_key:
            payload["args"]["apiKey"] = api_key
        if provider:
            payload["args"]["provider"] = provider
        if base_url:
            payload["args"]["baseURL"] = base_url

        logger.info("jianjicode chat (HTTP): %s", prompt[:120])

        try:
            token = self._token
            headers = {"Authorization": f"Bearer {token}"} if token else {}
            response = requests.post(url, json=payload, timeout=300, headers=headers)
            response.raise_for_status()
            result = response.json()
        except requests.exceptions.ConnectionError:
            logger.error("Cannot connect to jianjicode server at %s", url)
            return {
                "success": False,
                "error": f"Cannot connect to jianjicode server at {url}. Is it running?",
            }
        except requests.exceptions.Timeout:
            logger.error("jianjicode chat timed out after 300s")
            return {"success": False, "error": "Request timed out after 300 seconds"}
        except requests.exceptions.RequestException as exc:
            logger.error("jianjicode chat HTTP error: %s", exc)
            body = ""
            if hasattr(exc, "response") and exc.response is not None:
                try:
                    body = exc.response.text[:500]
                except Exception:
                    pass
            return {
                "success": False,
                "error": f"jianjicode server error: {exc}{' - ' + body if body else ''}",
            }
        except Exception as exc:
            logger.error("jianjicode chat exception: %s", exc, exc_info=True)
            return {"success": False, "error": str(exc)}

        # Map to the response format the LTX frontend expects
        if result.get("success"):
            return {
                "success": True,
                "data": {
                    "response": result.get("output", ""),
                    "operation": result.get("operation", "unknown"),
                    "prompt": prompt,
                    "sessionId": result.get("sessionId"),
                },
            }
        else:
            return {
                "success": False,
                "error": result.get("error", "Unknown error"),
            }

    def list_tools(self) -> dict[str, Any]:
        """List all available video editing tools."""
        return {
            "success": True,
            "data": {
                "tools": "See ai/tool/video/ for complete tool list",
                "categories": [
                    "trim", "concat", "convert", "extract_audio", "merge_audio",
                    "video_filter", "video_subtitle", "video_extract_frame",
                    "lut_filter", "video_mask", "keyframe_animation",
                    "video_speed", "video_stabilization", "audio_effects",
                    "hardware_acceleration", "video_pip", "video_watermark",
                    "video_transition",
                ],
            },
        }
