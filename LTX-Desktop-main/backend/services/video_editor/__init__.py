"""
Video editing services for LTX Desktop.
"""

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

from .video_editor import (
    VideoEditorService,
    get_video_editor_service,
)

from .preset_manager import (
    ColorCorrection,
    DEFAULT_COLOR_CORRECTION,
    ColorGradingPreset,
    SubtitleStyle,
    SubtitleTemplate,
    EffectDefinition,
    EffectTemplate,
    PresetManager,
    get_preset_manager,
)

__all__ = [
    # FFmpeg wrapper
    "find_ffmpeg_path",
    "run_ffmpeg",
    "get_video_info",
    "trim_video",
    "concat_videos",
    "extract_audio",
    "add_subtitle",
    "apply_color_correction",

    # Video editor service
    "VideoEditorService",
    "get_video_editor_service",

    # Preset manager
    "ColorCorrection",
    "DEFAULT_COLOR_CORRECTION",
    "ColorGradingPreset",
    "SubtitleStyle",
    "SubtitleTemplate",
    "EffectDefinition",
    "EffectTemplate",
    "PresetManager",
    "get_preset_manager",
]