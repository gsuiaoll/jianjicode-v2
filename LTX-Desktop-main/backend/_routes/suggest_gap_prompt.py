"""Route handler for /api/suggest-gap-prompt."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends

from api_types import (
    SuggestGapPromptRequest,
    SuggestGapPromptResponse,
)
from state.deps import get_state_service

if TYPE_CHECKING:
    from app_handler import AppHandler

router = APIRouter(prefix="/api", tags=["prompt"])


@router.post("/suggest-gap-prompt", response_model=SuggestGapPromptResponse)
def route_suggest_gap_prompt(
    req: SuggestGapPromptRequest,
    handler: "AppHandler" = Depends(get_state_service),
) -> SuggestGapPromptResponse:
    return handler.suggest_gap_prompt.suggest_gap(req)