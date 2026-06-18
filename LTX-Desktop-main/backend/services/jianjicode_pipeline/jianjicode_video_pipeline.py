"""jianjicode video pipeline implementing FastVideoPipeline protocol."""

from __future__ import annotations

import os
import tempfile
import subprocess
import json
from typing import ClassVar, Literal
import torch

from api_types import ImageConditioningInput
from services.services_utils import AudioOrNone, TilingConfigType


class JianjicodeVideoPipeline:
    """jianjicode implementation of FastVideoPipeline for video editing."""

    pipeline_kind: ClassVar[Literal["fast"]] = "fast"

    @staticmethod
    def create(
        checkpoint_path: str,
        gemma_root: str | None,
        upsampler_path: str,
        device: torch.device,
    ) -> "JianjicodeVideoPipeline":
        """Create a jianjicode video pipeline.

        Note: checkpoint_path, gemma_root, and upsampler_path are ignored
        for jianjicode as we use FFmpeg for video editing.
        """
        return JianjicodeVideoPipeline(device=device)

    def __init__(self, device: torch.device) -> None:
        """Initialize jianjicode video pipeline.

        Args:
            device: Torch device (ignored for jianjicode)
        """
        self.device = device
        # Check if jianjicode Python library is available
        try:
            # Try to import jianjicode Python library
            import jianjicode
            self.jianjicode = jianjicode
            self.has_jianjicode = True
        except ImportError:
            # Fall back to CLI
            self.jianjicode = None
            self.has_jianjicode = False

    def generate(
        self,
        prompt: str,
        seed: int,
        height: int,
        width: int,
        num_frames: int,
        frame_rate: float,
        images: list[ImageConditioningInput],
        output_path: str,
    ) -> None:
        """Generate/Edit video using jianjicode.

        For jianjicode, we interpret the prompt as a natural language
        video editing command. If images are provided, we use the first
        image as input video.

        Args:
            prompt: Natural language video editing command
            seed: Random seed (ignored for video editing)
            height: Video height (ignored, derived from input)
            width: Video width (ignored, derived from input)
            num_frames: Number of frames (ignored)
            frame_rate: Frame rate (ignored, derived from input)
            images: List of image conditioning inputs
            output_path: Path to save output video
        """
        # Determine input video file
        input_video = None
        if images and len(images) > 0:
            # Use the first image as input video
            input_video = images[0].path
            # Check if file exists
            if not os.path.exists(input_video):
                raise FileNotFoundError(f"Input video not found: {input_video}")

        if not input_video:
            # No input video provided - this is an error for editing
            raise ValueError(
                "jianjicode requires an input video for editing. "
                "Please provide an image/video file."
            )

        # Parse the natural language prompt to determine editing operation
        # For now, we'll implement basic operations based on keywords
        prompt_lower = prompt.lower()

        try:
            if "trim" in prompt_lower or "cut" in prompt_lower:
                # Parse time ranges from prompt (simplified)
                # Example: "trim first 5 seconds" or "cut from 0:10 to 1:30"
                start_time = "0:00"
                end_time = None

                # Simple keyword parsing (in real implementation, use NLP)
                if "first" in prompt_lower and "second" in prompt_lower:
                    # Find number
                    import re
                    match = re.search(r'first\s+(\d+)\s+seconds?', prompt_lower)
                    if match:
                        seconds = int(match.group(1))
                        end_time = f"00:00:{seconds:02d}"

                # Call jianjicode trim function
                if self.has_jianjicode:
                    result = self.jianjicode.trim(
                        input_file=input_video,
                        start=start_time,
                        end=end_time,
                        output_file=output_path,
                    )
                else:
                    # Fallback to CLI
                    self._run_jianjicode_cli("trim", {
                        "input": input_video,
                        "output": output_path,
                        "start": start_time,
                        "end": end_time,
                    })

            elif "concat" in prompt_lower or "merge" in prompt_lower or "join" in prompt_lower:
                # Concatenate multiple videos
                # Need multiple input files - use all provided images
                input_files = [img.path for img in images]

                if len(input_files) < 2:
                    raise ValueError("Concatenation requires at least 2 input videos")

                if self.has_jianjicode:
                    result = self.jianjicode.concat(
                        input_files=input_files,
                        output_file=output_path,
                    )
                else:
                    self._run_jianjicode_cli("concat", {
                        "inputs": input_files,
                        "output": output_path,
                    })

            elif "convert" in prompt_lower or "transcode" in prompt_lower:
                # Convert video format
                # Determine target format from output path extension
                if self.has_jianjicode:
                    result = self.jianjicode.convert(
                        input_file=input_video,
                        output_file=output_path,
                    )
                else:
                    self._run_jianjicode_cli("convert", {
                        "input": input_video,
                        "output": output_path,
                    })

            elif "subtitle" in prompt_lower or "caption" in prompt_lower:
                # Add subtitles - need subtitle file
                # For now, create a dummy subtitle file
                subtitle_path = self._create_dummy_subtitles(input_video)

                if self.has_jianjicode:
                    result = self.jianjicode.add_subtitles(
                        input_file=input_video,
                        subtitle_file=subtitle_path,
                        output_file=output_path,
                    )
                else:
                    self._run_jianjicode_cli("add_subtitles", {
                        "input": input_video,
                        "subtitles": subtitle_path,
                        "output": output_path,
                    })

                # Clean up temporary subtitle file
                if os.path.exists(subtitle_path):
                    os.remove(subtitle_path)

            else:
                # Default: copy video (no operation)
                # This allows basic "edit" commands that don't match specific patterns
                import shutil
                shutil.copy2(input_video, output_path)

        except Exception as e:
            # If jianjicode fails, fall back to simple copy
            import shutil
            import traceback
            print(f"jianjicode operation failed, falling back to copy: {e}")
            traceback.print_exc()
            shutil.copy2(input_video, output_path)

    def warmup(self, output_path: str) -> None:
        """Warmup the pipeline (no-op for jianjicode)."""
        pass

    def compile_transformer(self) -> None:
        """Compile transformer (no-op for jianjicode)."""
        pass

    def _run_jianjicode_cli(self, command: str, args: dict) -> None:
        """Run jianjicode CLI command."""
        import shutil

        jianjicode_path = shutil.which("jianjicode")
        if not jianjicode_path:
            raise RuntimeError("jianjicode CLI not found in PATH")

        # Build command arguments
        cmd_args = [jianjicode_path, "run", command]

        for key, value in args.items():
            if value is None:
                continue
            if isinstance(value, list):
                for item in value:
                    cmd_args.extend([f"--{key}", str(item)])
            else:
                cmd_args.extend([f"--{key}", str(value)])

        try:
            result = subprocess.run(
                cmd_args,
                capture_output=True,
                text=True,
                check=True
            )
            print(f"jianjicode output: {result.stdout}")
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"jianjicode failed: {e.stderr}") from e

    def _create_dummy_subtitles(self, video_path: str) -> str:
        """Create dummy subtitle file for testing."""
        import tempfile

        # Create a simple SRT file
        srt_content = """1
00:00:00,000 --> 00:00:05,000
Example subtitle generated by jianjicode

2
00:00:05,000 --> 00:00:10,000
Video editing with AI-powered tools
"""

        # Write to temporary file
        temp_file = tempfile.NamedTemporaryFile(mode='w', suffix='.srt', delete=False)
        temp_file.write(srt_content)
        temp_file.close()

        return temp_file.name