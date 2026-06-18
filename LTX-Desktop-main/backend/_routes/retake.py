"""Route handler for POST /api/retake."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends

from api_types import RetakeRequest, RetakeResponse
from state.deps import get_state_service

if TYPE_CHECKING:
    from app_handler import AppHandler

router = APIRouter(prefix="/api", tags=["retake"])


@router.post("/retake", response_model=RetakeResponse)
def route_retake(req: RetakeRequest, handler: "AppHandler" = Depends(get_state_service)) -> RetakeResponse:
    return handler.retake.run(req)