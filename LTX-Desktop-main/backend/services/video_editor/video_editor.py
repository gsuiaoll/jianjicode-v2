"""
Video editing service for LTX Desktop.
Provides high-level video editing operations using FFmpeg.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
import tempfile

from .ffmpeg_wrapper import (
    find_ffmpeg_path,
    run_ffmpeg,
    get_video_info,
    trim_video,
    concat_videos,
    extract_audio,
    add_subtitle,
    apply_color_correction,
)

logger = logging.getLogger(__name__)


class VideoEditorService:
    """High-level video editing service."""

    def __init__(self):
        self.ffmpeg_available = find_ffmpeg_path() is not None
        if not self.ffmpeg_available:
            logger.warning("FFmpeg not available - video editing functions will fail")

    def get_video_metadata(self, video_path: str) -> Dict[str, Any]:
        """Get detailed video metadata."""
        info = get_video_info(video_path)
        if info is None:
            return {"error": "Failed to get video info"}
        return info

    def edit_trim(self, input_path: str, start_time: float, end_time: float,
                  output_path: Optional[str] = None) -> Dict[str, Any]:
        """Trim video from start_time to end_time."""
        if not self.ffmpeg_available:
            return {"success": False, "error": "FFmpeg not available"}

        success, result = trim_video(input_path, start_time, end_time, output_path)
        if success:
            return {
                "success": True,
                "output_path": result,
                "operation": "trim",
                "input": input_path,
                "start_time": start_time,
                "end_time": end_time,
                "duration": end_time - start_time
            }
        else:
            return {"success": False, "error": result}

    def edit_concat(self, input_paths: List[str], output_path: Optional[str] = None) -> Dict[str, Any]:
        """Concatenate multiple videos."""
        if not self.ffmpeg_available:
            return {"success": False, "error": "FFmpeg not available"}

        success, result = concat_videos(input_paths, output_path)
        if success:
            return {
                "success": True,
                "output_path": result,
                "operation": "concat",
                "input_files": input_paths,
                "count": len(input_paths)
            }
        else:
            return {"success": False, "error": result}

    def edit_extract_audio(self, input_path: str, output_path: Optional[str] = None) -> Dict[str, Any]:
        """Extract audio from video."""
        if not self.ffmpeg_available:
            return {"success": False, "error": "FFmpeg not available"}

        success, result = extract_audio(input_path, output_path)
        if success:
            return {
                "success": True,
                "output_path": result,
                "operation": "extract_audio",
                "input": input_path
            }
        else:
            return {"success": False, "error": result}

    def edit_add_subtitle(self, input_path: str, text: str,
                          start_time: float, end_time: float,
                          output_path: Optional[str] = None,
                          style: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Add subtitle to video."""
        if not self.ffmpeg_available:
            return {"success": False, "error": "FFmpeg not available"}

        success, result = add_subtitle(input_path, text, start_time, end_time, output_path, style)
        if success:
            return {
                "success": True,
                "output_path": result,
                "operation": "add_subtitle",
                "input": input_path,
                "text": text,
                "start_time": start_time,
                "end_time": end_time
            }
        else:
            return {"success": False, "error": result}

    def edit_apply_color_grading(self, input_path: str,
                                 correction: Dict[str, float],
                                 output_path: Optional[str] = None) -> Dict[str, Any]:
        """Apply color grading to video."""
        if not self.ffmpeg_available:
            return {"success": False, "error": "FFmpeg not available"}

        success, result = apply_color_correction(input_path, correction, output_path)
        if success:
            return {
                "success": True,
                "output_path": result,
                "operation": "apply_color_grading",
                "input": input_path,
                "correction": correction
            }
        else:
            return {"success": False, "error": result}

    def edit_convert_format(self, input_path: str, output_format: str = "mp4",
                            output_path: Optional[str] = None) -> Dict[str, Any]:
        """Convert video to different format/codec."""
        if not self.ffmpeg_available:
            return {"success": False, "error": "FFmpeg not available"}

        if not os.path.exists(input_path):
            return {"success": False, "error": f"Input file not found: {input_path}"}

        if output_path is None:
            input_stem = Path(input_path).stem
            output_path = str(Path(input_path).with_name(f"{input_stem}_converted.{output_format}"))

        # Basic conversion with H.264 codec
        args = [
            "-i", input_path,
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "128k",
            "-y",
            output_path
        ]

        success, error = run_ffmpeg(args, timeout=120)
        if success:
            return {
                "success": True,
                "output_path": output_path,
                "operation": "convert_format",
                "input": input_path,
                "format": output_format
            }
        else:
            return {"success": False, "error": error}

    def edit_extract_frame(self, input_path: str, time: float,
                           output_path: Optional[str] = None) -> Dict[str, Any]:
        """Extract frame at specific time as image."""
        if not self.ffmpeg_available:
            return {"success": False, "error": "FFmpeg not available"}

        if not os.path.exists(input_path):
            return {"success": False, "error": f"Input file not found: {input_path}"}

        if output_path is None:
            output_path = str(Path(input_path).with_name(f"frame_at_{time:.1f}s.jpg"))

        args = [
            "-ss", str(time),
            "-i", input_path,
            "-frames:v", "1",
            "-q:v", "2",  # Quality (2-31, lower is better)
            "-y",
            output_path
        ]

        success, error = run_ffmpeg(args, timeout=30)
        if success:
            return {
                "success": True,
                "output_path": output_path,
                "operation": "extract_frame",
                "input": input_path,
                "time": time
            }
        else:
            return {"success": False, "error": error}

    def edit_merge_audio_video(self, video_path: str, audio_path: str,
                               output_path: Optional[str] = None) -> Dict[str, Any]:
        """Merge audio with video (replace or add audio track)."""
        if not self.ffmpeg_available:
            return {"success": False, "error": "FFmpeg not available"}

        if not os.path.exists(video_path):
            return {"success": False, "error": f"Video file not found: {video_path}"}
        if not os.path.exists(audio_path):
            return {"success": False, "error": f"Audio file not found: {audio_path}"}

        if output_path is None:
            video_stem = Path(video_path).stem
            output_path = str(Path(video_path).with_name(f"{video_stem}_with_audio.mp4"))

        # Simple merge: copy video, encode audio
        args = [
            "-i", video_path,
            "-i", audio_path,
            "-c:v", "copy",  # Copy video stream
            "-c:a", "aac",   # Encode audio to AAC
            "-map", "0:v:0", # Take video from first input
            "-map", "1:a:0", # Take audio from second input
            "-shortest",     # End with shortest stream
            "-y",
            output_path
        ]

        success, error = run_ffmpeg(args, timeout=120)
        if success:
            return {
                "success": True,
                "output_path": output_path,
                "operation": "merge_audio_video",
                "video_input": video_path,
                "audio_input": audio_path
            }
        else:
            return {"success": False, "error": error}


# Global instance
_video_editor_service: Optional[VideoEditorService] = None


def get_video_editor_service() -> VideoEditorService:
    """Get or create global VideoEditorService instance."""
    global _video_editor_service
    if _video_editor_service is None:
        _video_editor_service = VideoEditorService()
    return _video_editor_service