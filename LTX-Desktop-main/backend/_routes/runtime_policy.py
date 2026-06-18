"""Route handlers for /api/runtime-policy."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends

from api_types import RuntimePolicyResponse
from state.deps import get_state_service

if TYPE_CHECKING:
    from app_handler import AppHandler

router = APIRouter(prefix="/api", tags=["runtime-policy"])


@router.get("/runtime-policy", response_model=RuntimePolicyResponse)
def route_runtime_policy(handler: "AppHandler" = Depends(get_state_service)) -> RuntimePolicyResponse:
    return handler.runtime_policy.get_runtime_policy()