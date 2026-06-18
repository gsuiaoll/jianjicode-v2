"""jianjicode audio pipeline implementing A2VPipeline protocol."""

from __future__ import annotations

import os
import subprocess
from typing import ClassVar, Literal
import torch

from api_types import ImageConditioningInput


class JianjicodeAudioPipeline:
    """jianjicode implementation of A2VPipeline for audio-video operations."""

    @staticmethod
    def create(
        checkpoint_path: str,
        gemma_root: str | None,
        upsampler_path: str,
        device: torch.device,
    ) -> "JianjicodeAudioPipeline":
        """Create a jianjicode audio pipeline.

        Note: checkpoint_path, gemma_root, and upsampler_path are ignored
        for jianjicode as we use FFmpeg for audio-video operations.
        """
        return JianjicodeAudioPipeline(device=device)

    def __init__(self, device: torch.device) -> None:
        """Initialize jianjicode audio pipeline.

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
        prompt: str,
        negative_prompt: str,
        seed: int,
        height: int,
        width: int,
        num_frames: int,
        frame_rate: float,
        num_inference_steps: int,
        images: list[ImageConditioningInput],
        audio_path: str,
        audio_start_time: float,
        audio_max_duration: float | None,
        output_path: str,
    ) -> None:
        """Process audio-video operation using jianjicode.

        For jianjicode, this typically means merging audio with video
        or extracting audio from video.

        Args:
            prompt: Natural language command
            negative_prompt: Ignored
            seed: Random seed (ignored)
            height: Video height (ignored)
            width: Video width (ignored)
            num_frames: Number of frames (ignored)
            frame_rate: Frame rate (ignored)
            num_inference_steps: Inference steps (ignored)
            images: List of image conditioning inputs (video file)
            audio_path: Path to audio file
            audio_start_time: Audio start time (ignored)
            audio_max_duration: Maximum audio duration (ignored)
            output_path: Path to save output
        """
        # Determine input video file
        input_video = None
        if images and len(images) > 0:
            input_video = images[0].path
            if not os.path.exists(input_video):
                raise FileNotFoundError(f"Input video not found: {input_video}")

        if not input_video:
            raise ValueError("jianjicode requires an input video for audio operations.")

        # Check if audio file exists
        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        prompt_lower = prompt.lower()

        try:
            if "extract" in prompt_lower and "audio" in prompt_lower:
                # Extract audio from video
                if self.has_jianjicode:
                    result = self.jianjicode.extract_audio(
                        input_file=input_video,
                        output_file=output_path,
                    )
                else:
                    self._run_jianjicode_cli("extract_audio", {
                        "input": input_video,
                        "output": output_path,
                    })

            else:
                # Default: merge audio with video
                if self.has_jianjicode:
                    result = self.jianjicode.merge_audio(
                        video_file=input_video,
                        audio_file=audio_path,
                        output_file=output_path,
                    )
                else:
                    self._run_jianjicode_cli("merge_audio", {
                        "video": input_video,
                        "audio": audio_path,
                        "output": output_path,
                    })

        except Exception as e:
            # Fallback: copy video without audio
            import shutil
            import traceback
            print(f"jianjicode audio operation failed, falling back to copy: {e}")
            traceback.print_exc()
            shutil.copy2(input_video, output_path)

    def _run_jianjicode_cli(self, command: str, args: dict) -> None:
        """Run jianjicode CLI command."""
        import shutil

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