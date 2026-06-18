#!/usr/bin/env python3
"""
Test script for LTX video editing integration.
Run this script to verify the video editing API is working.
"""

import sys
import os
import json

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

try:
    from services.video_editor.ffmpeg_wrapper import find_ffmpeg_path
    FFMPEG_AVAILABLE = True
except ImportError as e:
    print(f"Note: FFmpeg wrapper import failed: {e}")
    FFMPEG_AVAILABLE = False
    find_ffmpeg_path = None

try:
    from services.video_editor.preset_manager import get_preset_manager
    PRESET_MANAGER_AVAILABLE = True
except ImportError as e:
    print(f"Note: Preset manager import failed: {e}")
    PRESET_MANAGER_AVAILABLE = False
    get_preset_manager = None


def test_ffmpeg():
    """Test if FFmpeg is available."""
    print("Testing FFmpeg availability...")
    ffmpeg_path = find_ffmpeg_path()
    if ffmpeg_path:
        print(f"✓ FFmpeg found at: {ffmpeg_path}")
        return True
    else:
        print("✗ FFmpeg not found. Video editing functions will not work.")
        print("  Make sure imageio-ffmpeg is installed or ffmpeg is in PATH.")
        return False


def test_preset_manager():
    """Test preset manager functionality."""
    print("\nTesting preset manager...")
    manager = get_preset_manager()

    # Test color presets
    color_presets = manager.list_color_presets()
    print(f"✓ Found {len(color_presets)} color grading presets")

    # Test subtitle templates
    subtitle_templates = manager.list_subtitle_templates()
    print(f"✓ Found {len(subtitle_templates)} subtitle templates")

    # Test effect templates
    effect_templates = manager.list_effect_templates()
    print(f"✓ Found {len(effect_templates)} effect templates")

    # Test getting specific preset
    if color_presets:
        preset_id = color_presets[0]["id"]
        preset = manager.get_color_preset(preset_id)
        if preset:
            print(f"✓ Successfully retrieved preset: {preset.name}")

    return True


def test_api_endpoints():
    """Test API endpoint availability (simulated)."""
    print("\nTesting API endpoints...")
    print("The following endpoints should be available when LTX backend is running:")
    print("  POST /api/edit/trim - Trim video")
    print("  POST /api/edit/concat - Concatenate videos")
    print("  POST /api/edit/extract_audio - Extract audio")
    print("  POST /api/edit/add_subtitle - Add subtitle")
    print("  POST /api/edit/apply_color_grading - Apply color grading")
    print("  POST /api/edit/convert_format - Convert video format")
    print("  POST /api/edit/extract_frame - Extract frame")
    print("  POST /api/edit/merge_audio_video - Merge audio with video")
    print("  GET /api/edit/video_info - Get video metadata")
    return True


def main():
    print("=" * 60)
    print("LTX Video Editing Integration Test")
    print("=" * 60)

    success = True

    # Test FFmpeg
    if not test_ffmpeg():
        success = False

    # Test preset manager
    try:
        test_preset_manager()
    except Exception as e:
        print(f"✗ Preset manager test failed: {e}")
        success = False

    # Test API endpoints
    test_api_endpoints()

    print("\n" + "=" * 60)
    if success:
        print("✓ All tests passed!")
        print("\nTo use the video editing API:")
        print("1. Start LTX backend server")
        print("2. Use the /api/edit/ endpoints for video editing")
        print("3. For AI-powered editing, use jianjicode CLI with LTX integration")
    else:
        print("⚠ Some tests failed. Video editing may not work correctly.")
        print("\nTroubleshooting:")
        print("1. Install imageio-ffmpeg: pip install imageio-ffmpeg")
        print("2. Or install FFmpeg system-wide")
        print("3. Restart LTX backend after installation")

    print("=" * 60)
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())