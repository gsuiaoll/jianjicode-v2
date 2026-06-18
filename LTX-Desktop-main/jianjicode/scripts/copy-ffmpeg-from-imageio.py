#!/usr/bin/env python3
"""
Copy FFmpeg binaries from imageio_ffmpeg package to resources directory.
"""

import os
import sys
import shutil
from pathlib import Path

try:
    import imageio_ffmpeg
except ImportError:
    print("Error: imageio_ffmpeg not installed. Run: pip install imageio_ffmpeg")
    sys.exit(1)

def main():
    # Get the FFmpeg executable path
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    if not ffmpeg_exe or not os.path.exists(ffmpeg_exe):
        print("Error: FFmpeg executable not found via imageio_ffmpeg")
        sys.exit(1)

    print(f"Found FFmpeg at: {ffmpeg_exe}")

    # Determine platform
    platform = sys.platform  # 'win32', 'darwin', 'linux'

    # Target directory
    project_root = Path(__file__).parent.parent
    resources_dir = project_root / "resources" / "ffmpeg" / platform
    resources_dir.mkdir(parents=True, exist_ok=True)

    # Copy ffmpeg binary
    ffmpeg_target = resources_dir / os.path.basename(ffmpeg_exe)
    shutil.copy2(ffmpeg_exe, ffmpeg_target)
    print(f"Copied ffmpeg to: {ffmpeg_target}")

    # Try to find ffprobe (usually in same directory)
    ffprobe_exe = None
    exe_dir = os.path.dirname(ffmpeg_exe)

    # Look for ffprobe with similar name
    for f in os.listdir(exe_dir):
        if 'ffprobe' in f.lower() and not f.lower().endswith('.py'):
            ffprobe_exe = os.path.join(exe_dir, f)
            break

    if ffprobe_exe and os.path.exists(ffprobe_exe):
        ffprobe_target = resources_dir / os.path.basename(ffprobe_exe)
        shutil.copy2(ffprobe_exe, ffprobe_target)
        print(f"Copied ffprobe to: {ffprobe_target}")
    else:
        print("Warning: ffprobe not found in the same directory")

    print("\nFFmpeg binaries are now available in:", resources_dir)
    print("You can now use jianjicode without requiring FFmpeg in PATH.")

if __name__ == "__main__":
    main()