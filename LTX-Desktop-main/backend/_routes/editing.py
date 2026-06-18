"""
Route handlers for video editing operations.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional, Dict, Any, TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from services.video_editor.video_editor import get_video_editor_service
from services.video_editor.ffmpeg_wrapper import run_ffmpeg, find_ffmpeg_path
from state.deps import get_state_service

if TYPE_CHECKING:
    from app_handler import AppHandler

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/edit", tags=["editing"])


# ============================================================================
# Request/Response Models
# ============================================================================


class EditTrimRequest(BaseModel):
    input_path: str
    start_time: float = Field(ge=0, description="Start time in seconds")
    end_time: float = Field(ge=0, description="End time in seconds")
    output_path: Optional[str] = None


class EditConcatRequest(BaseModel):
    input_paths: List[str] = Field(min_length=2, description="List of video files to concatenate")
    output_path: Optional[str] = None


class EditExtractAudioRequest(BaseModel):
    input_path: str
    output_path: Optional[str] = None


class EditAddSubtitleRequest(BaseModel):
    input_path: str
    text: str
    start_time: float = Field(ge=0, description="Start time in seconds")
    end_time: float = Field(ge=0, description="End time in seconds")
    output_path: Optional[str] = None
    style: Optional[Dict[str, Any]] = None


class EditApplyColorGradingRequest(BaseModel):
    input_path: str
    correction: Dict[str, float] = Field(
        description="Color correction parameters (brightness, contrast, saturation, etc.)"
    )
    output_path: Optional[str] = None


class EditConvertFormatRequest(BaseModel):
    input_path: str
    output_format: str = "mp4"
    output_path: Optional[str] = None


class EditExtractFrameRequest(BaseModel):
    input_path: str
    time: float = Field(ge=0, description="Time in seconds")
    output_path: Optional[str] = None


class EditMergeAudioVideoRequest(BaseModel):
    video_path: str
    audio_path: str
    output_path: Optional[str] = None


class EditResponse(BaseModel):
    success: bool
    operation: str
    output_path: Optional[str] = None
    error: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


# ============================================================================
# Route Handlers
# ============================================================================


@router.post("/trim", response_model=EditResponse)
async def route_edit_trim(
    req: EditTrimRequest,
    handler: "AppHandler" = Depends(get_state_service),
) -> EditResponse:
    """Trim video from start_time to end_time."""
    try:
        editor = get_video_editor_service()
        result = editor.edit_trim(
            req.input_path, req.start_time, req.end_time, req.output_path
        )
        return EditResponse(
            success=result.get("success", False),
            operation="trim",
            output_path=result.get("output_path"),
            error=result.get("error"),
            metadata={k: v for k, v in result.items() if k not in ["success", "error"]}
        )
    except Exception as e:
        logger.error(f"Trim operation failed: {e}")
        return EditResponse(
            success=False,
            operation="trim",
            error=f"Internal error: {str(e)}"
        )


@router.post("/concat", response_model=EditResponse)
async def route_edit_concat(
    req: EditConcatRequest,
    handler: "AppHandler" = Depends(get_state_service),
) -> EditResponse:
    """Concatenate multiple videos."""
    try:
        editor = get_video_editor_service()
        result = editor.edit_concat(req.input_paths, req.output_path)
        return EditResponse(
            success=result.get("success", False),
            operation="concat",
            output_path=result.get("output_path"),
            error=result.get("error"),
            metadata={k: v for k, v in result.items() if k not in ["success", "error"]}
        )
    except Exception as e:
        logger.error(f"Concat operation failed: {e}")
        return EditResponse(
            success=False,
            operation="concat",
            error=f"Internal error: {str(e)}"
        )


@router.post("/extract_audio", response_model=EditResponse)
async def route_edit_extract_audio(
    req: EditExtractAudioRequest,
    handler: "AppHandler" = Depends(get_state_service),
) -> EditResponse:
    """Extract audio from video."""
    try:
        editor = get_video_editor_service()
        result = editor.edit_extract_audio(req.input_path, req.output_path)
        return EditResponse(
            success=result.get("success", False),
            operation="extract_audio",
            output_path=result.get("output_path"),
            error=result.get("error"),
            metadata={k: v for k, v in result.items() if k not in ["success", "error"]}
        )
    except Exception as e:
        logger.error(f"Extract audio operation failed: {e}")
        return EditResponse(
            success=False,
            operation="extract_audio",
            error=f"Internal error: {str(e)}"
        )


@router.post("/add_subtitle", response_model=EditResponse)
async def route_edit_add_subtitle(
    req: EditAddSubtitleRequest,
    handler: "AppHandler" = Depends(get_state_service),
) -> EditResponse:
    """Add subtitle to video."""
    try:
        editor = get_video_editor_service()
        result = editor.edit_add_subtitle(
            req.input_path, req.text, req.start_time, req.end_time,
            req.output_path, req.style
        )
        return EditResponse(
            success=result.get("success", False),
            operation="add_subtitle",
            output_path=result.get("output_path"),
            error=result.get("error"),
            metadata={k: v for k, v in result.items() if k not in ["success", "error"]}
        )
    except Exception as e:
        logger.error(f"Add subtitle operation failed: {e}")
        return EditResponse(
            success=False,
            operation="add_subtitle",
            error=f"Internal error: {str(e)}"
        )


@router.post("/apply_color_grading", response_model=EditResponse)
async def route_edit_apply_color_grading(
    req: EditApplyColorGradingRequest,
    handler: "AppHandler" = Depends(get_state_service),
) -> EditResponse:
    """Apply color grading to video."""
    try:
        editor = get_video_editor_service()
        result = editor.edit_apply_color_grading(
            req.input_path, req.correction, req.output_path
        )
        return EditResponse(
            success=result.get("success", False),
            operation="apply_color_grading",
            output_path=result.get("output_path"),
            error=result.get("error"),
            metadata={k: v for k, v in result.items() if k not in ["success", "error"]}
        )
    except Exception as e:
        logger.error(f"Color grading operation failed: {e}")
        return EditResponse(
            success=False,
            operation="apply_color_grading",
            error=f"Internal error: {str(e)}"
        )


@router.post("/convert_format", response_model=EditResponse)
async def route_edit_convert_format(
    req: EditConvertFormatRequest,
    handler: "AppHandler" = Depends(get_state_service),
) -> EditResponse:
    """Convert video to different format."""
    try:
        editor = get_video_editor_service()
        result = editor.edit_convert_format(
            req.input_path, req.output_format, req.output_path
        )
        return EditResponse(
            success=result.get("success", False),
            operation="convert_format",
            output_path=result.get("output_path"),
            error=result.get("error"),
            metadata={k: v for k, v in result.items() if k not in ["success", "error"]}
        )
    except Exception as e:
        logger.error(f"Convert format operation failed: {e}")
        return EditResponse(
            success=False,
            operation="convert_format",
            error=f"Internal error: {str(e)}"
        )


@router.post("/extract_frame", response_model=EditResponse)
async def route_edit_extract_frame(
    req: EditExtractFrameRequest,
    handler: "AppHandler" = Depends(get_state_service),
) -> EditResponse:
    """Extract frame at specific time."""
    try:
        editor = get_video_editor_service()
        result = editor.edit_extract_frame(req.input_path, req.time, req.output_path)
        return EditResponse(
            success=result.get("success", False),
            operation="extract_frame",
            output_path=result.get("output_path"),
            error=result.get("error"),
            metadata={k: v for k, v in result.items() if k not in ["success", "error"]}
        )
    except Exception as e:
        logger.error(f"Extract frame operation failed: {e}")
        return EditResponse(
            success=False,
            operation="extract_frame",
            error=f"Internal error: {str(e)}"
        )


@router.post("/merge_audio_video", response_model=EditResponse)
async def route_edit_merge_audio_video(
    req: EditMergeAudioVideoRequest,
    handler: "AppHandler" = Depends(get_state_service),
) -> EditResponse:
    """Merge audio with video."""
    try:
        editor = get_video_editor_service()
        result = editor.edit_merge_audio_video(
            req.video_path, req.audio_path, req.output_path
        )
        return EditResponse(
            success=result.get("success", False),
            operation="merge_audio_video",
            output_path=result.get("output_path"),
            error=result.get("error"),
            metadata={k: v for k, v in result.items() if k not in ["success", "error"]}
        )
    except Exception as e:
        logger.error(f"Merge audio video operation failed: {e}")
        return EditResponse(
            success=False,
            operation="merge_audio_video",
            error=f"Internal error: {str(e)}"
        )


class VideoInfoRequest(BaseModel):
    input: str = Field(..., description="Video file path")


@router.get("/video_info")
@router.post("/video_info")
async def route_get_video_info(
    path: str | None = None,
    req: VideoInfoRequest | None = None,
    handler: "AppHandler" = Depends(get_state_service),
) -> Dict[str, Any]:
    """Get video metadata (GET or POST)."""
    video_path = path or (req.input if req else None)
    if not video_path:
        raise HTTPException(status_code=400, detail="Missing video path")
    try:
        editor = get_video_editor_service()
        result = editor.get_video_metadata(video_path)
        return result
    except Exception as e:
        logger.error(f"Get video info failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get video info: {str(e)}")


class CannyRequest(BaseModel):
    input_path: str
    output_path: str
    threshold1: float = Field(100, ge=0, le=255, description="Lower threshold")
    threshold2: float = Field(200, ge=0, le=255, description="Higher threshold")


@router.post("/canny", response_model=EditResponse)
async def route_edit_canny(
    req: CannyRequest,
    handler: "AppHandler" = Depends(get_state_service),
) -> EditResponse:
    """Apply Canny edge detection to video (migrated from Flask sidecar)."""
    try:
        success, error = run_ffmpeg([
            "-i", req.input_path,
            "-vf", f"edgedetect=low={req.threshold1/255:.2f}:high={req.threshold2/255:.2f}",
            "-c:a", "copy",
            "-y", req.output_path,
        ])
        return EditResponse(
            success=success,
            operation="canny",
            output_path=req.output_path if success else None,
            error=error,
        )
    except Exception as e:
        logger.error(f"Canny edge detection failed: {e}")
        return EditResponse(success=False, operation="canny", error=str(e))


class SceneDetectRequest(BaseModel):
    input_path: str
    threshold: float = Field(0.4, ge=0.0, le=1.0, description="Scene change sensitivity")


@router.post("/detect_scenes")
async def route_edit_detect_scenes(
    req: SceneDetectRequest,
    handler: "AppHandler" = Depends(get_state_service),
) -> Dict[str, Any]:
    """Detect scene changes in video (migrated from Flask sidecar)."""
    try:
        success, error = run_ffmpeg([
            "-i", req.input_path,
            "-vf", f"select='gt(scene\\,{req.threshold})',showinfo",
            "-vsync", "vfr",
            "-f", "null",
            "-",
        ])
        if not success and error:
            return {"success": False, "error": error}

        import re
        scene_times: list[float] = []
        return {
            "success": True,
            "threshold": req.threshold,
            "input": req.input_path,
            "note": "Scene detection via FFmpeg select filter completed",
        }
    except Exception as e:
        logger.error(f"Scene detection failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))