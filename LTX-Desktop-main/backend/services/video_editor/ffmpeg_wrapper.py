"""
FFmpeg wrapper for video editing operations.
Based on LTX's TypeScript ffmpeg-utils.ts, adapted for Python.
"""

from __future__ import annotations

import subprocess
import os
import re
import tempfile
import logging
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Any
import imageio_ffmpeg

logger = logging.getLogger(__name__)

_CJK_PATTERN = re.compile(r"[一-鿿㐀-䶿豈-﫿]")


def _has_cjk(text: str) -> bool:
    """Check if text contains CJK (Chinese/Japanese/Korean) characters."""
    return bool(_CJK_PATTERN.search(text))


def find_cjk_font() -> Optional[str]:
    """Find a CJK-capable font on the system. Returns path or None."""
    if os.name == "nt":
        candidates = [
            "C:/Windows/Fonts/simhei.ttf",
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/simsun.ttc",
            "C:/Windows/Fonts/msgothic.ttc",
        ]
    elif os.uname().sysname == "Darwin":
        candidates = [
            "/System/Library/Fonts/Hiragino Sans GB.ttc",
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/STHeiti Light.ttc",
        ]
    else:
        candidates = [
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
        ]

    for f in candidates:
        if os.path.exists(f):
            return f
    return None


def find_ffmpeg_path() -> Optional[str]:
    """Find FFmpeg binary path using imageio-ffmpeg or system PATH."""
    try:
        # imageio_ffmpeg.get_ffmpeg_exe() returns the path to the bundled ffmpeg binary
        ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
        if ffmpeg_path and os.path.exists(ffmpeg_path):
            return ffmpeg_path
    except Exception as e:
        logger.debug(f"Failed to get ffmpeg from imageio_ffmpeg: {e}")

    # Fallback to system ffmpeg
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        return "ffmpeg"
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def run_ffmpeg(args: List[str], timeout: int = 30) -> Tuple[bool, Optional[str]]:
    """
    Run ffmpeg command and return (success, error_message).

    Args:
        args: FFmpeg arguments list
        timeout: Command timeout in seconds

    Returns:
        Tuple of (success, error_message)
    """
    ffmpeg_path = find_ffmpeg_path()
    if not ffmpeg_path:
        return False, "FFmpeg not found"

    logger.info(f"[ffmpeg] Running: {' '.join(args[:20])}")

    try:
        result = subprocess.run(
            [ffmpeg_path] + args,
            capture_output=True,
            text=True,
            timeout=timeout
        )

        if result.returncode == 0:
            return True, None
        else:
            error_output = result.stderr.strip()
            # Take last few lines of error
            error_lines = [line for line in error_output.split('\n') if line.strip()]
            error_snippet = '\n'.join(error_lines[-5:]) if error_lines else "Unknown error"
            logger.error(f"[ffmpeg] Command failed (code {result.returncode}): {error_snippet}")
            return False, f"FFmpeg failed (code {result.returncode}): {error_snippet}"

    except subprocess.TimeoutExpired:
        logger.error(f"[ffmpeg] Command timed out after {timeout}s")
        return False, f"FFmpeg command timed out after {timeout}s"
    except Exception as e:
        logger.error(f"[ffmpeg] Failed to run command: {e}")
        return False, f"Failed to run ffmpeg: {str(e)}"


def get_video_info(video_path: str) -> Optional[Dict[str, Any]]:
    """
    Get video metadata using ffprobe/ffmpeg.

    Returns:
        Dictionary with video info or None if failed
    """
    ffmpeg_path = find_ffmpeg_path()
    if not ffmpeg_path:
        return None

    try:
        # Use ffprobe if available, otherwise ffmpeg
        probe_cmd = [ffmpeg_path, "-i", video_path, "-hide_banner"]
        result = subprocess.run(
            probe_cmd,
            capture_output=True,
            text=True,
            timeout=10
        )

        output = result.stdout + result.stderr

        info = {
            "path": video_path,
            "duration": 0.0,
            "width": 0,
            "height": 0,
            "fps": 0.0,
            "has_audio": False,
            "audio_codec": None,
            "video_codec": None,
        }

        # Parse duration
        import re
        duration_match = re.search(r"Duration:\s*(\d{2}):(\d{2}):(\d{2}\.\d+)", output)
        if duration_match:
            hours, minutes, seconds = duration_match.groups()
            info["duration"] = float(hours) * 3600 + float(minutes) * 60 + float(seconds)

        # Parse resolution
        resolution_match = re.search(r"(\d+)x(\d+)", output)
        if resolution_match:
            info["width"], info["height"] = map(int, resolution_match.groups())

        # Parse FPS
        fps_match = re.search(r"(\d+(?:\.\d+)?)\s*fps", output)
        if fps_match:
            info["fps"] = float(fps_match.group(1))

        # Check for audio
        info["has_audio"] = "Audio:" in output

        # Parse codecs
        video_codec_match = re.search(r"Video:\s*([^\s,]+)", output)
        if video_codec_match:
            info["video_codec"] = video_codec_match.group(1)

        audio_codec_match = re.search(r"Audio:\s*([^\s,]+)", output)
        if audio_codec_match:
            info["audio_codec"] = audio_codec_match.group(1)

        return info

    except Exception as e:
        logger.error(f"Failed to get video info: {e}")
        return None


def trim_video(input_path: str, start_time: float, end_time: float,
               output_path: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """
    Trim video from start_time to end_time.

    Args:
        input_path: Input video file
        start_time: Start time in seconds
        end_time: End time in seconds
        output_path: Output file path (optional, defaults to input_path_trimmed.mp4)

    Returns:
        Tuple of (success, output_path_or_error)
    """
    if not os.path.exists(input_path):
        return False, f"Input file not found: {input_path}"

    if output_path is None:
        input_stem = Path(input_path).stem
        output_path = str(Path(input_path).with_name(f"{input_stem}_trimmed.mp4"))

    duration = end_time - start_time
    if duration <= 0:
        return False, "Invalid duration (end_time must be greater than start_time)"

    args = [
        "-ss", str(start_time),
        "-i", input_path,
        "-t", str(duration),
        "-c", "copy",  # Copy codec (no re-encoding)
        "-avoid_negative_ts", "make_zero",
        "-y",  # Overwrite output
        output_path
    ]

    success, error = run_ffmpeg(args, timeout=60)
    if success:
        return True, output_path
    else:
        return False, error


def concat_videos(input_paths: List[str], output_path: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """
    Concatenate multiple videos.

    Args:
        input_paths: List of input video files
        output_path: Output file path

    Returns:
        Tuple of (success, output_path_or_error)
    """
    if len(input_paths) < 2:
        return False, "Need at least 2 videos to concatenate"

    for path in input_paths:
        if not os.path.exists(path):
            return False, f"Input file not found: {path}"

    if output_path is None:
        output_path = str(Path(input_paths[0]).with_name("concatenated.mp4"))

    # Create temporary file list for ffmpeg concat
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
        for path in input_paths:
            # Escape backslashes for Windows paths
            escaped_path = path.replace('\\', '/')
            f.write(f"file '{escaped_path}'\n")
        list_file = f.name

    try:
        args = [
            "-f", "concat",
            "-safe", "0",
            "-i", list_file,
            "-c", "copy",  # Copy codec
            "-y",
            output_path
        ]

        success, error = run_ffmpeg(args, timeout=120)
        if success:
            return True, output_path
        else:
            return False, error
    finally:
        os.unlink(list_file)


def extract_audio(input_path: str, output_path: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """
    Extract audio from video.

    Args:
        input_path: Input video file
        output_path: Output audio file path (optional)

    Returns:
        Tuple of (success, output_path_or_error)
    """
    if not os.path.exists(input_path):
        return False, f"Input file not found: {input_path}"

    if output_path is None:
        input_stem = Path(input_path).stem
        output_path = str(Path(input_path).with_name(f"{input_stem}_audio.mp3"))

    args = [
        "-i", input_path,
        "-q:a", "0",  # Best quality
        "-map", "a",
        "-y",
        output_path
    ]

    success, error = run_ffmpeg(args, timeout=60)
    if success:
        return True, output_path
    else:
        return False, error


def add_subtitle(input_path: str, subtitle_text: str,
                 start_time: float, end_time: float,
                 output_path: Optional[str] = None,
                 style: Optional[Dict[str, Any]] = None) -> Tuple[bool, Optional[str]]:
    """
    Add subtitle to video using drawtext filter.

    Args:
        input_path: Input video file
        subtitle_text: Subtitle text
        start_time: Start time in seconds
        end_time: End time in seconds
        output_path: Output file path
        style: Subtitle style dictionary

    Returns:
        Tuple of (success, output_path_or_error)
    """
    if not os.path.exists(input_path):
        return False, f"Input file not found: {input_path}"

    if output_path is None:
        input_stem = Path(input_path).stem
        output_path = str(Path(input_path).with_name(f"{input_stem}_subtitled.mp4"))

    # Default style
    if style is None:
        style = {
            "fontsize": 32,
            "fontcolor": "white",
            "box": 1,
            "boxcolor": "black@0.6",
            "boxborderw": 8,
            "x": "(w-text_w)/2",
            "y": "h-text_h-30"
        }

    fontsize = style.get("fontsize", 32)
    fontcolor = style.get("fontcolor", "white")
    box = style.get("box", 1)
    boxcolor = style.get("boxcolor", "black@0.6")
    boxborderw = style.get("boxborderw", 8)
    x = style.get("x", "(w-text_w)/2")
    y = style.get("y", "h-text_h-30")

    # Write subtitle text to a temp UTF-8 file to avoid Windows CLI encoding issues
    # Using textfile= bypasses all command-line Unicode corruption
    text_file = None
    try:
        fd, text_file = tempfile.mkstemp(suffix=".txt", prefix="ltx_subtitle_")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(subtitle_text)

        # Build filter with textfile= (avoids Windows CLI UTF-8 corruption)
        text_file_fixed = text_file.replace("\\", "/").replace("'", "'\\''").replace(":", "\\:")
        filter_parts = [
            f"textfile='{text_file_fixed}'",
            f"fontsize={fontsize}",
            f"fontcolor={fontcolor}",
            f"box={box}",
            f"boxcolor={boxcolor}",
            f"boxborderw={boxborderw}",
            f"x={x}",
            f"y={y}",
            f"enable='between(t\\,{start_time}\\,{end_time})'",
        ]

        # Detect CJK font — FFmpeg's default font lacks CJK glyphs (renders □□□)
        if _has_cjk(subtitle_text):
            cjk_font = find_cjk_font()
            if cjk_font:
                escaped_font = cjk_font.replace("\\", "/").replace(":", "\\:")
                filter_parts.append(f"fontfile='{escaped_font}'")
                logger.info(f"[add_subtitle] CJK text detected, using font: {cjk_font}")

        filter_str = "drawtext=" + ":".join(filter_parts)

        args = [
            "-i", input_path,
            "-vf", filter_str,
            "-c:a", "copy",
            "-y",
            output_path
        ]

        success, error = run_ffmpeg(args, timeout=60)
        if success:
            return True, output_path
        else:
            return False, error

    finally:
        if text_file and os.path.exists(text_file):
            try:
                os.unlink(text_file)
            except OSError:
                pass


def apply_color_correction(input_path: str,
                          correction: Dict[str, float],
                          output_path: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """
    Apply color correction to video.

    Args:
        input_path: Input video file
        correction: Color correction parameters (brightness, contrast, saturation, etc.)
        output_path: Output file path

    Returns:
        Tuple of (success, output_path_or_error)
    """
    if not os.path.exists(input_path):
        return False, f"Input file not found: {input_path}"

    if output_path is None:
        input_stem = Path(input_path).stem
        output_path = str(Path(input_path).with_name(f"{input_stem}_graded.mp4"))

    # Build color correction filter
    brightness = correction.get("brightness", 0)
    contrast = correction.get("contrast", 0)
    saturation = correction.get("saturation", 0)
    temperature = correction.get("temperature", 0)

    # Convert parameters to ffmpeg filter values
    # Note: These formulas are approximate and may need adjustment
    eq_filter = (
        f"eq=brightness={brightness/100:.3f}:"
        f"contrast={1 + contrast/100:.3f}:"
        f"saturation={1 + saturation/100:.3f}"
    )

    # Temperature/tint adjustment (simplified)
    colorbalance_filter = ""
    if temperature != 0:
        # Simplified: adjust red/blue balance for temperature
        temp_adj = temperature / 200  # Arbitrary scaling
        colorbalance_filter = f",colorbalance=rs={max(0, temp_adj)}:gs=0:bs={max(0, -temp_adj)}"

    filter_str = eq_filter + colorbalance_filter

    args = [
        "-i", input_path,
        "-vf", filter_str,
        "-c:a", "copy",
        "-y",
        output_path
    ]

    success, error = run_ffmpeg(args, timeout=60)
    if success:
        return True, output_path
    else:
        return False, error