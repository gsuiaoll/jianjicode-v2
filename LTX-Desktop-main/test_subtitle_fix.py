"""Quick test for the fixed add_subtitle with CJK rendering."""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from services.video_editor.ffmpeg_wrapper import add_subtitle, find_cjk_font, _has_cjk

VIDEO = r"D:\code\jianjicode-5\tests\13421377767745425.mp4"
OUTPUT = r"D:\code\jianjicode-5\tests\outputs\ltx_subtitle_test.mp4"
TEXT = "这是一段测试字幕\n用于验证 LTX 后端的 CJK 渲染修复"

print(f"Input:  {VIDEO}")
print(f"Output: {OUTPUT}")
print(f"Text:   {TEXT!r}")
print(f"hasCJK: {_has_cjk(TEXT)}")

font = find_cjk_font()
print(f"CJK font: {font}")

success, result = add_subtitle(
    VIDEO,
    TEXT,
    start_time=5,
    end_time=15,
    output_path=OUTPUT,
    style={"fontsize": 28, "fontcolor": "white", "box": 1, "boxcolor": "black@0.6", "boxborderw": 8},
)

if success:
    import pathlib
    size_mb = pathlib.Path(result).stat().st_size / (1024 * 1024)
    print(f"\n✅ SUCCESS: {result} ({size_mb:.2f} MB)")
else:
    print(f"\n❌ FAILED: {result}")
