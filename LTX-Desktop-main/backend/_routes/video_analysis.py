"""Route handlers for video analysis."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends

from api_types import VideoAnalysisRequest, VideoAnalysisResponse
from state.deps import get_state_service

if TYPE_CHECKING:
    from app_handler import AppHandler

router = APIRouter(prefix="/api", tags=["video_analysis"])


@router.post("/analyze/video", response_model=VideoAnalysisResponse)
def route_analyze_video(
    req: VideoAnalysisRequest,
    handler: "AppHandler" = Depends(get_state_service),
) -> VideoAnalysisResponse:
    """POST /api/analyze/video — analyze video for editing insights."""
    return handler.video_analysis.analyze_video(req)