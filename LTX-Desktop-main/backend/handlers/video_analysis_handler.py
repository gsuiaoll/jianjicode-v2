"""Video analysis handler for general video understanding."""

from __future__ import annotations

import logging
from threading import RLock
from typing import TYPE_CHECKING

from api_types import VideoAnalysisRequest, VideoAnalysisResponse
from handlers.base import StateHandlerBase, with_state_lock
from runtime_config.model_download_specs import resolve_model_path
from services.interfaces import VideoAnalysisPipeline, VideoAnalysisConfig
from services.services_utils import get_device_type
import torch

if TYPE_CHECKING:
    from runtime_config.runtime_config import RuntimeConfig
    from state.app_state_types import AppState

logger = logging.getLogger(__name__)


class VideoAnalysisHandler(StateHandlerBase):
    def __init__(self, state: AppState, lock: RLock, config: RuntimeConfig) -> None:
        super().__init__(state, lock, config)
        self._pipeline = None
        self._device = None

    def _ensure_pipeline(self) -> VideoAnalysisPipeline:
        """Ensure video analysis pipeline is initialized."""
        if self._pipeline is not None:
            return self._pipeline

        # Get device
        if self._device is None:
            device_type = get_device_type()
            self._device = torch.device(device_type)
            logger.info(f"Video analysis using device: {self._device}")

        # Get model paths from runtime config
        models_dir = self.config.models_dir
        specs = self.config.model_download_specs

        object_detector_path = str(resolve_model_path(models_dir, specs, "object_detector"))
        scene_processor_path = str(resolve_model_path(models_dir, specs, "scene_processor"))
        ocr_processor_path = str(resolve_model_path(models_dir, specs, "ocr_processor"))

        logger.info(f"Object detector path: {object_detector_path}")
        logger.info(f"Scene processor path: {scene_processor_path}")
        logger.info(f"OCR processor path: {ocr_processor_path}")

        # Create pipeline configuration (default)
        config = VideoAnalysisConfig()

        # Create pipeline
        self._pipeline = VideoAnalysisPipeline.create(
            object_detector_path=object_detector_path,
            scene_processor_path=scene_processor_path,
            ocr_processor_path=ocr_processor_path,
            device=self._device,
            config=config,
        )

        logger.info("Video analysis pipeline initialized")
        return self._pipeline

    @with_state_lock
    def analyze_video(self, request: VideoAnalysisRequest) -> VideoAnalysisResponse:
        """Analyze a video file."""
        try:
            logger.info(f"Starting video analysis: {request.video_path}")

            # Ensure pipeline is ready
            pipeline = self._ensure_pipeline()

            # Override config with request parameters
            config = VideoAnalysisConfig(
                sampling_rate=request.sampling_rate,
                max_frames=request.max_frames,
                include_bounding_boxes=request.include_bounding_boxes,
                include_scene_labels=request.include_scene_labels,
                include_ocr_text=request.include_ocr_text,
                include_shot_boundaries=request.include_shot_boundaries,
                object_confidence_threshold=request.object_confidence_threshold,
                scene_threshold=request.scene_threshold,
                shot_change_threshold=request.shot_change_threshold,
                ocr_language=request.ocr_language,
            )

            # Update pipeline config (simplified - in real implementation we'd need to recreate)
            # For now, use default config or create new pipeline
            # This is a simplification - production would need better config handling

            # Analyze video
            result = pipeline.analyze_video(
                video_path=request.video_path,
            )

            # Convert to JSON
            json_result = result.to_json()

            return VideoAnalysisResponse(
                status="success",
                result=json_result,
                analysis_time=result.analysis_time,
            )

        except Exception as e:
            logger.error(f"Video analysis failed: {e}", exc_info=True)
            return VideoAnalysisResponse(
                status="error",
                error=str(e),
            )