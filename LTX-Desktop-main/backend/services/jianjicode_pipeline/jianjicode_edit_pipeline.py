"""jianjicode edit pipeline implementing RetakePipeline protocol."""

from __future__ import annotations

import os
import subprocess
from typing import ClassVar, Literal
import torch


class JianjicodeEditPipeline:
    """jianjicode implementation of RetakePipeline for video editing."""

    @staticmethod
    def create(
        checkpoint_path: str,
        gemma_root: str | None,
        device: torch.device,
        *,
        loras: list = None,
        quantization = None,
    ) -> "JianjicodeEditPipeline":
        """Create a jianjicode edit pipeline.

        Note: All AI-related parameters are ignored for jianjicode.
        """
        return JianjicodeEditPipeline(device=device)

    def __init__(self, device: torch.device) -> None:
        """Initialize jianjicode edit pipeline.

        Args:
            device: Torch device (ignored for jianjicode)
        """
        self.device = device
        # Check if jianjicode Python library is available
        try:
            import jianjicode
            self.jianjicode = jianjicode
            self.has_jianjicode = True
        except ImportError:
            self.jianjicode = None
            self.has_jianjicode = False

    def generate(
        self,
        *,
        video_path: str,
        prompt: str,
        start_time: float,
        end_time: float,
        seed: int,
        output_path: str,
        negative_prompt: str = "",
        num_inference_steps: int = 40,
        video_guider_params = None,
        audio_guider_params = None,
        regenerate_video: bool = True,
        regenerate_audio: bool = True,
        enhance_prompt: bool = False,
        distilled: bool = True,
    ) -> None:
        """Edit video segment using jianjicode.

        For jianjicode, this is typically trimming or applying effects
        to a specific segment of the video.

        Args:
            video_path: Path to input video
            prompt: Natural language editing command
            start_time: Start time in seconds
            end_time: End time in seconds
            seed: Random seed (ignored)
            output_path: Path to save output
            negative_prompt: Ignored
            num_inference_steps: Ignored
            video_guider_params: Ignored
            audio_guider_params: Ignored
            regenerate_video: Ignored
            regenerate_audio: Ignored
            enhance_prompt: Ignored
            distilled: Ignored
        """
        # Check if input video exists
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Input video not found: {video_path}")

        prompt_lower = prompt.lower()

        try:
            # Convert times to HH:MM:SS format
            start_str = self._seconds_to_timestamp(start_time)
            end_str = self._seconds_to_timestamp(end_time)

            # Check what operation is requested
            if "trim" in prompt_lower or "cut" in prompt_lower:
                # Trim the specified segment
                if self.has_jianjicode:
                    result = self.jianjicode.trim(
                        input_file=video_path,
                        start=start_str,
                        end=end_str,
                        output_file=output_path,
                    )
                else:
                    self._run_jianjicode_cli("trim", {
                        "input": video_path,
                        "output": output_path,
                        "start": start_str,
                        "end": end_str,
                    })

            elif "apply" in prompt_lower and "filter" in prompt_lower:
                # Apply video filter to segment
                # First trim the segment, then apply filter
                with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as temp_file:
                    temp_path = temp_file.name

                # Trim segment first
                if self.has_jianjicode:
                    self.jianjicode.trim(
                        input_file=video_path,
                        start=start_str,
                        end=end_str,
                        output_file=temp_path,
                    )
                else:
                    self._run_jianjicode_cli("trim", {
                        "input": video_path,
                        "output": temp_path,
                        "start": start_str,
                        "end": end_str,
                    })

                # Apply filter (simple example: convert to grayscale)
                filter_complex = "colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3"
                if self.has_jianjicode:
                    self.jianjicode.apply_filter(
                        input_file=temp_path,
                        filter_complex=filter_complex,
                        output_file=output_path,
                    )
                else:
                    self._run_jianjicode_cli("apply_filter", {
                        "input": temp_path,
                        "filter": filter_complex,
                        "output": output_path,
                    })

                # Clean up temporary file
                if os.path.exists(temp_path):
                    os.remove(temp_path)

            else:
                # Default: copy the specified segment (trim)
                if self.has_jianjicode:
                    result = self.jianjicode.trim(
                        input_file=video_path,
                        start=start_str,
                        end=end_str,
                        output_file=output_path,
                    )
                else:
                    self._run_jianjicode_cli("trim", {
                        "input": video_path,
                        "output": output_path,
                        "start": start_str,
                        "end": end_str,
                    })

        except Exception as e:
            # Fallback: copy entire video
            import shutil
            import traceback
            print(f"jianjicode edit operation failed, falling back to copy: {e}")
            traceback.print_exc()
            shutil.copy2(video_path, output_path)

    def _seconds_to_timestamp(self, seconds: float) -> str:
        """Convert seconds to HH:MM:SS format."""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"

    def _run_jianjicode_cli(self, command: str, args: dict) -> None:
        """Run jianjicode CLI command."""
        import shutil
        import subprocess

        jianjicode_path = shutil.which("jianjicode")
        if not jianjicode_path:
            raise RuntimeError("jianjicode CLI not found in PATH")

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