"""
Timed multi-line subtitle test using LTX backend's CJK font detection.

Reads narration_timed.txt, creates separate drawtext filters for each line,
each with its own enable timerange. Single FFmpeg pass.
"""
import sys, os, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from services.video_editor.ffmpeg_wrapper import run_ffmpeg, find_cjk_font, _has_cjk

VIDEO = r"D:\code\jianjicode-5\tests\13421377767745425.mp4"
OUTPUT = r"D:\code\jianjicode-5\tests\outputs\ltx_timed_subtitles.mp4"
TIMING_FILE = r"D:\code\jianjicode-5\tests\outputs\narration_timed.txt"

# Read timing data
entries = []
with open(TIMING_FILE, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        parts = line.split(" ", 2)
        if len(parts) >= 3:
            entries.append((float(parts[0]), float(parts[1]), parts[2]))

print(f"Loaded {len(entries)} subtitle entries")

# Detect CJK font
cjk_font = find_cjk_font()
has_cjk = any(_has_cjk(t) for _, _, t in entries)
print(f"CJK text detected: {has_cjk}")
print(f"CJK font: {cjk_font}")

# Build multi-drawtext filter
# Each subtitle line gets its own temp text file (avoids Windows CLI encoding issues)
temp_files = []
filter_parts = []

for i, (start, end, text) in enumerate(entries):
    fd, tf = tempfile.mkstemp(suffix=".txt", prefix=f"ltx_sub_{i}_")
    with os.fdopen(fd, "w", encoding="utf-8") as fout:
        fout.write(text)
    temp_files.append(tf)

    tf_escaped = tf.replace("\\", "/").replace("'", "'\\''").replace(":", "\\:")

    parts = [
        f"textfile='{tf_escaped}'",
        "fontsize=26",
        "fontcolor=white",
        "box=1",
        "boxcolor=black@0.6",
        "boxborderw=8",
        "x=(w-text_w)/2",
        "y=h-text_h-40",
        f"enable='between(t\\,{start}\\,{end})'",
    ]

    if has_cjk and cjk_font:
        escaped_font = cjk_font.replace("\\", "/").replace(":", "\\:")
        parts.append(f"fontfile='{escaped_font}'")

    filter_parts.append(f"drawtext={':'.join(parts)}")

filter_str = ",".join(filter_parts)
print(f"\nFilter chain ({len(entries)} drawtext entries):")
print(filter_str[:200] + "...")

args = [
    "-i", VIDEO,
    "-vf", filter_str,
    "-c:a", "copy",
    "-y",
    OUTPUT,
]

print(f"\nRunning FFmpeg...")
success, error = run_ffmpeg(args, timeout=120)

# Cleanup temp files
for tf in temp_files:
    try:
        os.unlink(tf)
    except OSError:
        pass

if success:
    size_mb = os.path.getsize(OUTPUT) / (1024 * 1024)
    orig_mb = os.path.getsize(VIDEO) / (1024 * 1024)
    print(f"\nSUCCESS: {OUTPUT}")
    print(f"  Original: {orig_mb:.2f} MB")
    print(f"  Output:   {size_mb:.2f} MB")
    print(f"  Increase: {(size_mb - orig_mb) * 1024:.1f} KB")
else:
    print(f"\nFAILED: {error}")
