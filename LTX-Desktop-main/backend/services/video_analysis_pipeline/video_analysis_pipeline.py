"""Lightweight video analysis pipeline for general video understanding.

Provides object detection, scene classification, OCR, and shot detection
for video editing applications.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
import torch

from services.services_utils import FrameArray

# Configuration constants
DEFAULT_SAMPLING_RATE = 2.0  # frames per second
DEFAULT_CONFIDENCE_THRESHOLD = 0.25
DEFAULT_IOU_THRESHOLD = 0.45
CLIP_FEATURE_DIM = 512
SHOT_CHANGE_THRESHOLD = 0.3


@dataclass
class VideoAnalysisConfig:
    """Configuration for video analysis pipeline."""

    # Frame sampling
    sampling_rate: float = DEFAULT_SAMPLING_RATE  # frames per second
    max_frames: Optional[int] = None  # limit total frames analyzed

    # Object detection
    object_confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD
    object_iou_threshold: float = DEFAULT_IOU_THRESHOLD
    track_buffer: int = 30  # ByteTrack buffer

    # Scene classification
    scene_threshold: float = 0.5
    shot_change_threshold: float = SHOT_CHANGE_THRESHOLD

    # OCR settings
    ocr_language: str = "ch"  # Chinese by default
    ocr_use_gpu: bool = True

    # Output settings
    include_bounding_boxes: bool = True
    include_trajectories: bool = True
    include_scene_labels: bool = True
    include_ocr_text: bool = True
    include_shot_boundaries: bool = True

    # Performance optimization
    batch_size: int = 1  # for CLIP processing
    use_half_precision: bool = True

    # Basketball analysis settings
    enable_basketball_analysis: bool = False
    basketball_confidence_threshold: float = 0.6
    min_shot_duration: float = 1.5  # minimum duration of a shot attempt (seconds)
    max_shot_duration: float = 5.0  # maximum duration of a shot attempt (seconds)
    hoop_position: Optional[Tuple[float, float]] = None  # normalized hoop position (x, y)
    detect_missed_shots: bool = True  # detect and mark missed shots for editing
    detect_made_shots: bool = False  # detect made shots (for statistics)

    # Two-stage high-fps analysis settings
    high_fps_sampling_rate: float = 10.0  # fps for detailed shot analysis
    high_fps_analysis_window: float = 2.0  # seconds to extend around shot time
    min_continuous_frames_for_make: int = 3  # min frames ball must be in hoop region
    hoop_region: Tuple[float, float, float, float] = (0.4, 0.05, 0.6, 0.2)  # x1, y1, x2, y2


@dataclass
class DetectedObject:
    """Detected object with tracking information."""

    object_id: int  # unique track ID
    class_name: str  # COCO class name
    confidence: float
    bbox: Tuple[float, float, float, float]  # x1, y1, x2, y2 (normalized 0-1)
    frame_index: int
    timestamp: float

    # For trajectory analysis
    velocity: Optional[Tuple[float, float]] = None  # pixel/frame
    acceleration: Optional[Tuple[float, float]] = None


@dataclass
class BasketballShotResult:
    """Basketball shot detection result."""

    start_time: float
    end_time: float
    duration: float
    shot_type: str  # e.g., "jump_shot", "layup", "three_point"
    shot_result: str  # "make", "miss", "blocked"
    confidence: float
    ball_track_id: int  # track ID of the basketball
    player_track_id: Optional[int] = None  # track ID of shooting player
    trajectory: Optional[List[Tuple[float, float]]] = None  # ball trajectory positions
    distance_to_hoop: Optional[float] = None  # distance to hoop at release
    release_angle: Optional[float] = None  # release angle in degrees
    release_speed: Optional[float] = None  # release speed (pixels/frame)

    # Two-stage high-fps analysis results
    needs_high_fps_analysis: bool = True  # whether this shot needs detailed analysis
    high_fps_result: Optional[str] = None  # result from high-fps analysis ("make", "miss")
    high_fps_confidence: Optional[float] = None  # confidence from high-fps analysis
    continuous_frames_in_hoop: Optional[int] = None  # frames ball continuously in hoop region


@dataclass
class SceneSegment:
    """Scene segment with classification results."""

    start_time: float
    end_time: float
    scene_label: str
    scene_confidence: float
    activity_label: Optional[str] = None
    activity_confidence: Optional[float] = None
    dominant_objects: List[str] = None  # most frequent objects in segment
    clip_priority: int = 5  # 0-10, higher = more important for editing

    def __post_init__(self):
        if self.dominant_objects is None:
            self.dominant_objects = []


@dataclass
class OCRResult:
    """OCR text detection result."""

    text: str
    confidence: float
    bbox: Tuple[float, float, float, float]  # x1, y1, x2, y2 (normalized 0-1)
    frame_index: int
    timestamp: float


@dataclass
class ShotBoundary:
    """Shot boundary detection result."""

    frame_index: int
    timestamp: float
    boundary_type: str  # "cut", "gradual", "fade", "wipe"
    similarity_score: float  # CLIP feature similarity with previous frame


@dataclass
class VideoAnalysisResult:
    """Complete video analysis result."""

    # Video metadata
    video_path: str
    duration: float
    fps: float
    resolution: Tuple[int, int]
    total_frames_analyzed: int

    # Analysis results
    objects_timeline: List[DetectedObject]
    scene_segments: List[SceneSegment]
    ocr_results: List[OCRResult]
    shot_boundaries: List[ShotBoundary]

    # Summary for editing
    invalid_segments: List[Dict[str, Any]]  # black screens, static frames, etc.
    recommended_clips: List[Dict[str, Any]]  # suggested clips for editing
    basketball_analysis: Optional[List[BasketballShotResult]] = None  # basketball shot analysis
    analysis_time: float = 0.0

    def to_json(self) -> Dict[str, Any]:
        """Convert to JSON-serializable dictionary."""
        # Helper function to convert numpy types to Python native types
        def _convert_value(value):
            import numpy as np
            if isinstance(value, np.generic):
                return value.item()  # Convert numpy scalar to Python scalar
            if isinstance(value, (list, tuple)):
                return [_convert_item(v) for v in value]
            if isinstance(value, dict):
                return {k: _convert_item(v) for k, v in value.items()}
            return value

        def _convert_item(item):
            import numpy as np
            if isinstance(item, np.generic):
                return item.item()
            if isinstance(item, (list, tuple)):
                return [_convert_item(v) for v in item]
            if isinstance(item, dict):
                return {k: _convert_item(v) for k, v in item.items()}
            return item

        result = {
            "video_info": {
                "path": self.video_path,
                "duration": _convert_item(self.duration),
                "fps": _convert_item(self.fps),
                "resolution": f"{self.resolution[0]}x{self.resolution[1]}",
                "total_frames_analyzed": self.total_frames_analyzed,
            },
            "scene_analysis": [
                {
                    "time_range": [_convert_item(seg.start_time), _convert_item(seg.end_time)],
                    "scene": seg.scene_label,
                    "confidence": _convert_item(seg.scene_confidence),
                    "activity": seg.activity_label,
                    "activity_confidence": _convert_item(seg.activity_confidence) if seg.activity_confidence is not None else None,
                    "dominant_objects": seg.dominant_objects,
                    "clip_priority": seg.clip_priority,
                }
                for seg in self.scene_segments
            ],
            "object_timeline": [
                {
                    "object_id": obj.object_id,
                    "class": obj.class_name,
                    "frame": obj.frame_index,
                    "time": _convert_item(obj.timestamp),
                    "bbox": [_convert_item(v) for v in obj.bbox],
                    "confidence": _convert_item(obj.confidence),
                }
                for obj in self.objects_timeline
            ],
            "ocr_results": [
                {
                    "text": ocr.text,
                    "confidence": _convert_item(ocr.confidence),
                    "bbox": [_convert_item(v) for v in ocr.bbox] if ocr.bbox else None,
                    "frame": ocr.frame_index,
                    "time": _convert_item(ocr.timestamp),
                }
                for ocr in self.ocr_results
            ],
            "shot_boundaries": [
                {
                    "frame": shot.frame_index,
                    "time": _convert_item(shot.timestamp),
                    "type": shot.boundary_type,
                    "similarity": _convert_item(shot.similarity_score),
                }
                for shot in self.shot_boundaries
            ],
            "invalid_segments": self.invalid_segments,
            "recommended_clips": self.recommended_clips,
            "basketball_analysis": [
                {
                    "start_time": _convert_item(shot.start_time),
                    "end_time": _convert_item(shot.end_time),
                    "duration": _convert_item(shot.duration),
                    "shot_type": shot.shot_type,
                    "shot_result": shot.shot_result,
                    "confidence": _convert_item(shot.confidence),
                    "ball_track_id": shot.ball_track_id,
                    "player_track_id": shot.player_track_id,
                    "distance_to_hoop": _convert_item(shot.distance_to_hoop) if shot.distance_to_hoop is not None else None,
                    "release_angle": _convert_item(shot.release_angle) if shot.release_angle is not None else None,
                    "release_speed": _convert_item(shot.release_speed) if shot.release_speed is not None else None,
                }
                for shot in self.basketball_analysis
            ] if self.basketball_analysis else None,
            "analysis_metadata": {
                "analysis_time": _convert_item(self.analysis_time),
                "sampling_rate": DEFAULT_SAMPLING_RATE,
                "model_versions": {
                    "object_detector": "yolov8s",
                    "scene_processor": "clip-vit-base-patch32",
                    "ocr_processor": "paddleocr-light",
                },
            },
        }
        return _convert_item(result)


class VideoAnalysisPipeline:
    """Main video analysis pipeline."""

    @staticmethod
    def create(
        object_detector_path: str,
        scene_processor_path: str,
        ocr_processor_path: str,
        device: torch.device,
        config: Optional[VideoAnalysisConfig] = None,
    ) -> "VideoAnalysisPipeline":
        """Create a new video analysis pipeline.

        Args:
            object_detector_path: Path to YOLOv8s model
            scene_processor_path: Path to CLIP model directory
            ocr_processor_path: Path to PaddleOCR model directory
            device: Torch device to use
            config: Optional configuration

        Returns:
            VideoAnalysisPipeline instance
        """
        return VideoAnalysisPipeline(
            object_detector_path=object_detector_path,
            scene_processor_path=scene_processor_path,
            ocr_processor_path=ocr_processor_path,
            device=device,
            config=config or VideoAnalysisConfig(),
        )

    def __init__(
        self,
        object_detector_path: str,
        scene_processor_path: str,
        ocr_processor_path: str,
        device: torch.device,
        config: VideoAnalysisConfig,
    ) -> None:
        """Initialize the pipeline.

        Note: Model loading is lazy - models are loaded on first use.
        """
        self._object_detector_path = object_detector_path
        self._scene_processor_path = scene_processor_path
        self._ocr_processor_path = ocr_processor_path
        self._device = device
        self._config = config

        # Lazy-loaded models
        self._object_detector = None
        self._scene_processor = None
        self._ocr_processor = None
        self._tracker_config = None  # Tracker configuration for YOLOv8

        # State for tracking
        self._track_ids = {}  # map from detection ID to track ID
        self._next_track_id = 1

        # Check for optional dependencies
        self._dependencies_available = self._check_dependencies()

        print(f"[VideoAnalysis] Pipeline initialized on device: {device}")
        print(f"[VideoAnalysis] Sampling rate: {config.sampling_rate} fps")
        print(f"[VideoAnalysis] Dependencies available: {self._dependencies_available}")

    def _check_dependencies(self) -> dict[str, bool]:
        """Check availability of optional dependencies."""
        deps = {
            "ultralytics": False,
            "transformers": False,
            "paddleocr": False,
        }

        try:
            import ultralytics
            deps["ultralytics"] = True
        except ImportError:
            pass

        try:
            import transformers
            deps["transformers"] = True
        except ImportError:
            pass

        try:
            import paddleocr
            deps["paddleocr"] = True
        except ImportError:
            pass

        return deps

    def _load_object_detector(self) -> Any:
        """Load YOLOv8 object detector with ByteTrack."""
        if not self._dependencies_available.get("ultralytics", False):
            print("[VideoAnalysis] Ultralytics not available, object detection disabled")
            return None

        try:
            from ultralytics import YOLO

            print(f"[VideoAnalysis] Loading object detector from: {self._object_detector_path}")

            # Load model (if path exists) or use pretrained
            if Path(self._object_detector_path).exists():
                model = YOLO(self._object_detector_path)
            else:
                # Fallback to pretrained YOLOv8s
                print(f"[VideoAnalysis] Model file not found, using pretrained yolov8s")
                model = YOLO("yolov8s.pt")

            # Configure tracker for ByteTrack
            # YOLOv8 uses these parameters when model.track() is called
            tracker_config = {
                "tracker_type": "bytetrack.yaml",  # Use YAML config
                "track_high_thresh": self._config.object_confidence_threshold,
                "track_low_thresh": 0.1,
                "new_track_thresh": 0.6,
                "track_buffer": self._config.track_buffer,
                "match_thresh": 0.8,
                "fuse_score": True,
            }

            # Store tracker config for later use
            self._tracker_config = tracker_config

            print(f"[VideoAnalysis] Object detector loaded: {model.__class__.__name__}")
            print(f"[VideoAnalysis] Tracker configured: {tracker_config['tracker_type']}")
            return model

        except Exception as e:
            print(f"[VideoAnalysis] Failed to load object detector: {e}")
            return None

    def _load_scene_processor(self) -> Any:
        """Load CLIP model for scene classification."""
        if not self._dependencies_available.get("transformers", False):
            print("[VideoAnalysis] Transformers not available, scene classification disabled")
            return None

        try:
            from transformers import CLIPProcessor, CLIPModel
            import torch

            print(f"[VideoAnalysis] Loading scene processor from: {self._scene_processor_path}")

            # Use default model if path is dummy or invalid
            model_path = self._scene_processor_path
            if model_path == "dummy" or model_path == "dummy/":
                model_path = "openai/clip-vit-base-patch32"
                print(f"[VideoAnalysis] Using default CLIP model: {model_path}")

            model = CLIPModel.from_pretrained(model_path)
            processor = CLIPProcessor.from_pretrained(model_path)

            if self._config.use_half_precision:
                model = model.half()

            model = model.to(self._device)
            model.eval()

            print(f"[VideoAnalysis] Scene processor loaded: {model.__class__.__name__}")
            return {"model": model, "processor": processor}

        except Exception as e:
            print(f"[VideoAnalysis] Failed to load scene processor: {e}")
            return None

    def _load_ocr_processor(self) -> Any:
        """Load PaddleOCR for text recognition."""
        if not self._dependencies_available.get("paddleocr", False):
            print("[VideoAnalysis] PaddleOCR not available, OCR disabled")
            return None

        try:
            # Set environment variables to avoid OneDNN errors on Windows with AMD CPU
            import os
            os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'
            os.environ['ONEDNN_MAX_CPU_ISA'] = '0'
            os.environ['ONEDNN_ENABLE'] = '0'  # Completely disable OneDNN
            os.environ['OMP_NUM_THREADS'] = '1'
            os.environ['CUDA_VISIBLE_DEVICES'] = ''  # Disable CUDA, use CPU
            os.environ['FLAGS_use_mkldnn'] = '0'  # Disable MKLDNN
            os.environ['FLAGS_use_onednn'] = '0'  # Disable OneDNN (alternative)
            os.environ['FLAGS_use_cuda'] = '0'  # Disable CUDA
            os.environ['FLAGS_use_gpu'] = '0'  # Disable GPU
            os.environ['ONEDNN_DEFAULT_FPMATH_MODE'] = 'BF16'  # Try BF16 float mode
            os.environ['ONEDNN_VERBOSE'] = '1'  # Enable verbose logging for debugging

            # Also try to set PaddlePaddle internal flags
            os.environ['GLOG_v'] = '0'  # Reduce logging verbosity

            from paddleocr import PaddleOCR

            print(f"[VideoAnalysis] Loading OCR processor from: {self._ocr_processor_path}")

            # Try different parameter combinations for PaddleOCR 3.4.1
            # Based on the available parameters from __init__ signature
            param_attempts = [
                # Attempt 1: Minimal parameters for PaddleOCR 3.4.1
                {"lang": self._config.ocr_language},
                # Attempt 2: With deprecated use_angle_cls (for backward compatibility)
                {"lang": self._config.ocr_language, "use_angle_cls": True},
                # Attempt 3: With new use_textline_orientation parameter
                {"lang": self._config.ocr_language, "use_textline_orientation": True},
                # Attempt 4: With doc orientation features disabled
                {"lang": self._config.ocr_language, "use_doc_orientation_classify": False, "use_doc_unwarping": False},
            ]

            ocr = None
            last_error = None

            for i, params in enumerate(param_attempts):
                try:
                    print(f"[VideoAnalysis] Attempt {i+1}: {params}")
                    ocr = PaddleOCR(**params)
                    print(f"[VideoAnalysis] OCR processor loaded successfully with attempt {i+1}")
                    break
                except Exception as e:
                    last_error = e
                    print(f"[VideoAnalysis] Attempt {i+1} failed: {e}")
                    continue

            if ocr is None:
                print(f"[VideoAnalysis] All OCR loading attempts failed. Last error: {last_error}")
                return None

            print(f"[VideoAnalysis] OCR processor loaded: {ocr.__class__.__name__}")
            return ocr

        except Exception as e:
            print(f"[VideoAnalysis] Failed to load OCR processor: {e}")
            return None

    def analyze_video(
        self,
        video_path: Union[str, Path],
        output_json_path: Optional[Union[str, Path]] = None,
    ) -> VideoAnalysisResult:
        """Analyze a video file and return structured results.

        Args:
            video_path: Path to video file
            output_json_path: Optional path to save JSON output

        Returns:
            VideoAnalysisResult object
        """
        start_time = time.time()

        # Load video and extract frames
        print(f"[VideoAnalysis] Analyzing video: {video_path}")
        frames, frame_times, video_info = self._extract_frames(video_path)

        if not frames:
            raise ValueError(f"No frames extracted from video: {video_path}")

        print(f"[VideoAnalysis] Extracted {len(frames)} frames for analysis")

        # Initialize models (lazy loading)
        if self._object_detector is None:
            self._object_detector = self._load_object_detector()

        if self._config.include_scene_labels and self._scene_processor is None:
            self._scene_processor = self._load_scene_processor()

        if self._config.include_ocr_text and self._ocr_processor is None:
            self._ocr_processor = self._load_ocr_processor()

        # Process frames
        all_objects = []
        all_ocr_results = []
        scene_features = []

        for i, (frame, timestamp) in enumerate(zip(frames, frame_times)):
            print(f"[VideoAnalysis] Processing frame {i+1}/{len(frames)} (t={timestamp:.2f}s)")

            # Object detection and tracking
            if self._config.include_bounding_boxes:
                frame_objects = self._detect_objects(frame, i, timestamp)
                all_objects.extend(frame_objects)

            # OCR text recognition
            if self._config.include_ocr_text:
                ocr_results = self._extract_text(frame, i, timestamp)
                all_ocr_results.extend(ocr_results)

            # Extract scene features (for shot detection and classification)
            if self._config.include_scene_labels or self._config.include_shot_boundaries:
                features = self._extract_scene_features(frame)
                scene_features.append((i, timestamp, features))

        # Scene classification and shot detection
        scene_segments = []
        shot_boundaries = []

        if scene_features:
            if self._config.include_scene_labels:
                scene_segments = self._classify_scenes(scene_features, all_objects)

            if self._config.include_shot_boundaries:
                shot_boundaries = self._detect_shot_boundaries(scene_features)

        # Identify invalid segments (black screens, static frames)
        invalid_segments = self._detect_invalid_segments(frames, frame_times)

        # Recommend clips for editing
        recommended_clips = self._recommend_clips(
            scene_segments, all_objects, shot_boundaries, frame_times
        )

        # Basketball analysis (if enabled)
        basketball_analysis = None
        if self._config.enable_basketball_analysis:
            basketball_analysis = self._analyze_basketball_shots(
                all_objects, frame_times, frames, video_info
            )

            # Add missed shots to invalid segments for editing
            if basketball_analysis and self._config.detect_missed_shots:
                missed_shots = self._extract_missed_shots(basketball_analysis)
                invalid_segments.extend(missed_shots)

            # Two-stage analysis: High FPS analysis for all shots
            if basketball_analysis and self._config.high_fps_sampling_rate > 0:
                print(f"[TwoStageAnalysis] Starting high FPS analysis for {len(basketball_analysis)} shots")

                for shot in basketball_analysis:
                    if shot.needs_high_fps_analysis:
                        print(f"[TwoStageAnalysis] Analyzing shot at {shot.start_time:.2f}s with high FPS")

                        try:
                            high_fps_result = self._analyze_shot_with_high_fps(
                                video_path, shot
                            )

                            # Update shot with high-fps results
                            shot.high_fps_result = high_fps_result.get("result")
                            shot.high_fps_confidence = high_fps_result.get("confidence")
                            shot.continuous_frames_in_hoop = high_fps_result.get("continuous_frames_in_hoop")

                            # Override original result if high-fps confidence is high enough
                            if (shot.high_fps_confidence and shot.high_fps_confidence > 0.7 and
                                shot.high_fps_result and shot.high_fps_result != shot.shot_result):
                                print(f"[TwoStageAnalysis] Overriding result from '{shot.shot_result}' to '{shot.high_fps_result}' "
                                      f"(confidence: {shot.high_fps_confidence:.2f})")
                                shot.shot_result = shot.high_fps_result
                                shot.confidence = shot.high_fps_confidence

                            print(f"[TwoStageAnalysis] Shot at {shot.start_time:.2f}s: "
                                  f"original={shot.shot_result}, high_fps={shot.high_fps_result}, "
                                  f"confidence={shot.high_fps_confidence:.2f}, "
                                  f"continuous_frames={shot.continuous_frames_in_hoop}")

                        except Exception as e:
                            print(f"[TwoStageAnalysis] High FPS analysis failed for shot at {shot.start_time:.2f}s: {e}")
                            shot.high_fps_result = "error"
                            shot.high_fps_confidence = 0.0

                print(f"[TwoStageAnalysis] High FPS analysis completed for {len(basketball_analysis)} shots")

        # Build result
        result = VideoAnalysisResult(
            video_path=str(video_path),
            duration=video_info["duration"],
            fps=video_info["fps"],
            resolution=(video_info["width"], video_info["height"]),
            total_frames_analyzed=len(frames),
            objects_timeline=all_objects,
            scene_segments=scene_segments,
            ocr_results=all_ocr_results,
            shot_boundaries=shot_boundaries,
            invalid_segments=invalid_segments,
            recommended_clips=recommended_clips,
            basketball_analysis=basketball_analysis,
            analysis_time=time.time() - start_time,
        )

        # Save JSON output if requested
        if output_json_path:
            output_path = Path(output_json_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)

            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(result.to_json(), f, indent=2, ensure_ascii=False)

            print(f"[VideoAnalysis] Results saved to: {output_path}")

        print(f"[VideoAnalysis] Analysis completed in {result.analysis_time:.2f} seconds")
        return result

    def _extract_frames(
        self, video_path: Union[str, Path]
    ) -> Tuple[List[np.ndarray], List[float], Dict[str, Any]]:
        """Extract frames from video at configured sampling rate."""
        try:
            import cv2

            video_path = str(video_path)
            cap = cv2.VideoCapture(video_path)

            if not cap.isOpened():
                raise ValueError(f"Could not open video: {video_path}")

            # Get video info
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            duration = total_frames / fps if fps > 0 else 0

            # Calculate frame interval for sampling
            frame_interval = max(1, int(fps / self._config.sampling_rate))

            frames = []
            frame_times = []
            frame_count = 0

            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                if frame_count % frame_interval == 0:
                    # Convert BGR to RGB
                    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    frames.append(frame_rgb)
                    frame_times.append(frame_count / fps)

                frame_count += 1

                # Limit frames if configured
                if (self._config.max_frames and
                    len(frames) >= self._config.max_frames):
                    break

            cap.release()

            video_info = {
                "fps": fps,
                "total_frames": total_frames,
                "width": width,
                "height": height,
                "duration": duration,
            }

            return frames, frame_times, video_info

        except ImportError as e:
            raise ImportError(
                "OpenCV not installed. Install with: pip install opencv-python"
            ) from e

    def _extract_high_fps_frames(
        self,
        video_path: Union[str, Path],
        time_window: Tuple[float, float]
    ) -> Tuple[List[np.ndarray], List[float], Dict[str, Any]]:
        """Extract high FPS frames from a specific time window.

        Args:
            video_path: Path to video file
            time_window: Tuple of (start_time, end_time) in seconds

        Returns:
            frames: List of RGB frames
            frame_times: List of corresponding timestamps
            video_info: Video metadata
        """
        try:
            import cv2

            start_time, end_time = time_window
            video_path = str(video_path)
            cap = cv2.VideoCapture(video_path)

            if not cap.isOpened():
                raise ValueError(f"Could not open video: {video_path}")

            # Get video info
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            duration = total_frames / fps if fps > 0 else 0

            # Calculate frame interval for high FPS sampling
            # Use config.high_fps_sampling_rate, default to 10 fps
            target_fps = self._config.high_fps_sampling_rate
            frame_interval = max(1, int(fps / target_fps))

            # Convert time window to frame indices
            start_frame = int(start_time * fps)
            end_frame = int(end_time * fps)

            # Clamp to valid range
            start_frame = max(0, min(start_frame, total_frames - 1))
            end_frame = max(start_frame + 1, min(end_frame, total_frames - 1))

            print(f"[HighFPS] Extracting frames {start_frame}-{end_frame} ({start_time:.2f}-{end_time:.2f}s)")
            print(f"[HighFPS] Target FPS: {target_fps}, frame interval: {frame_interval}")

            frames = []
            frame_times = []

            # Seek to start frame
            cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

            current_frame = start_frame
            frames_extracted = 0

            while current_frame <= end_frame:
                ret, frame = cap.read()
                if not ret:
                    break

                # Extract frame based on interval
                if frames_extracted % frame_interval == 0:
                    # Convert BGR to RGB
                    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    frames.append(frame_rgb)
                    frame_times.append(current_frame / fps)

                frames_extracted += 1
                current_frame += 1

            cap.release()

            video_info = {
                "fps": fps,
                "total_frames": total_frames,
                "width": width,
                "height": height,
                "duration": duration,
                "extracted_frames": len(frames),
                "time_window": time_window,
                "actual_fps": len(frames) / (end_time - start_time) if (end_time - start_time) > 0 else 0,
            }

            print(f"[HighFPS] Extracted {len(frames)} frames from {start_time:.2f}-{end_time:.2f}s")
            print(f"[HighFPS] Actual FPS: {video_info['actual_fps']:.1f}")

            return frames, frame_times, video_info

        except ImportError as e:
            raise ImportError(
                "OpenCV not installed. Install with: pip install opencv-python"
            ) from e

    def _analyze_continuous_frames(
        self,
        frames: List[np.ndarray],
        frame_times: List[float],
        video_info: Dict[str, Any],
        ball_track_id: int
    ) -> Dict[str, Any]:
        """Analyze continuous frames to detect if ball stays in hoop region.

        Args:
            frames: List of high FPS frames
            frame_times: List of timestamps for each frame
            video_info: Video metadata
            ball_track_id: Track ID of the basketball to analyze

        Returns:
            Analysis results with:
                - continuous_frames_in_hoop: Number of frames ball continuously in hoop
                - frames_in_hoop: List of (frame_index, timestamp, in_hoop)
                - hoop_region: The hoop region used for analysis
                - ball_positions: List of ball positions
        """
        print(f"[ContinuousAnalysis] Analyzing continuous frames for ball track {ball_track_id}")
        print(f"[ContinuousAnalysis] Total frames: {len(frames)}, time range: {frame_times[0]:.2f}-{frame_times[-1]:.2f}s")

        # Get hoop region from config
        hoop_region = self._config.hoop_region  # (x1, y1, x2, y2)
        x1, y1, x2, y2 = hoop_region
        print(f"[ContinuousAnalysis] Hoop region: ({x1:.2f}, {y1:.2f}) - ({x2:.2f}, {y2:.2f})")
        print(f"[ContinuousAnalysis] Hoop center: ({(x1+x2)/2:.2f}, {(y1+y2)/2:.2f}), width: {x2-x1:.2f}, height: {y2-y1:.2f}")

        # Run object detection on all frames
        all_objects = []
        for i, (frame, timestamp) in enumerate(zip(frames, frame_times)):
            frame_objects = self._detect_objects(frame, i, timestamp)
            all_objects.extend(frame_objects)

        # Filter objects for the specific ball track
        ball_objects = [obj for obj in all_objects if obj.object_id == ball_track_id]

        # If no objects found for specific track ID, try to find any basketball objects
        if not ball_objects:
            print(f"[ContinuousAnalysis] No ball objects found for track {ball_track_id}, searching for any basketballs...")
            basketball_objects = [obj for obj in all_objects if obj.class_name == "sports ball"]

            if basketball_objects:
                print(f"[ContinuousAnalysis] Found {len(basketball_objects)} basketball objects (not matching track ID)")

                # Group by track ID to find the most consistent basketball track
                track_groups = {}
                for obj in basketball_objects:
                    track_id = obj.object_id
                    if track_id not in track_groups:
                        track_groups[track_id] = []
                    track_groups[track_id].append(obj)

                # Find the track with most detections (most consistent)
                if track_groups:
                    best_track = max(track_groups.items(), key=lambda x: len(x[1]))
                    best_track_id, best_objects = best_track
                    print(f"[ContinuousAnalysis] Using basketball track {best_track_id} with {len(best_objects)} detections")
                    ball_objects = best_objects
                else:
                    ball_objects = basketball_objects
            else:
                print(f"[ContinuousAnalysis] No basketball objects found at all")
                return {
                    "continuous_frames_in_hoop": 0,
                    "frames_in_hoop": [],
                    "hoop_region": hoop_region,
                    "ball_positions": [],
                    "ball_detected": False,
                }

        print(f"[ContinuousAnalysis] Found {len(ball_objects)} ball detections (track ID: {ball_objects[0].object_id if ball_objects else 'none'})")

        # Sort by timestamp
        ball_objects.sort(key=lambda obj: obj.timestamp)

        # Analyze each ball position relative to hoop region
        frames_in_hoop = []
        ball_positions = []
        current_streak = 0
        max_streak = 0

        for i, obj in enumerate(ball_objects):
            x_center = (obj.bbox[0] + obj.bbox[2]) / 2.0
            y_center = (obj.bbox[1] + obj.bbox[3]) / 2.0

            ball_positions.append({
                "timestamp": obj.timestamp,
                "position": (x_center, y_center),
                "bbox": obj.bbox,
                "confidence": obj.confidence,
            })

            # Check if ball is in hoop region
            in_hoop = (x1 <= x_center <= x2) and (y1 <= y_center <= y2)

            # Calculate distance to hoop center for debugging
            hoop_center_x = (x1 + x2) / 2
            hoop_center_y = (y1 + y2) / 2
            distance = np.sqrt((x_center - hoop_center_x) ** 2 + (y_center - hoop_center_y) ** 2)

            # Print debugging info for all balls
            print(f"[ContinuousAnalysis] Ball {i+1}/{len(ball_objects)} at ({x_center:.3f}, {y_center:.3f}), "
                  f"distance to hoop: {distance:.3f}, in_hoop: {in_hoop}, t={obj.timestamp:.2f}s")

            frames_in_hoop.append({
                "frame_index": obj.frame_index,
                "timestamp": obj.timestamp,
                "in_hoop": in_hoop,
                "position": (x_center, y_center),
                "distance_to_hoop_center": distance if not in_hoop else 0,
            })

            # Update streak
            if in_hoop:
                current_streak += 1
                max_streak = max(max_streak, current_streak)
            else:
                current_streak = 0

        # Analyze streaks
        print(f"[ContinuousAnalysis] Maximum continuous frames in hoop: {max_streak}")
        print(f"[ContinuousAnalysis] Ball positions analyzed: {len(ball_positions)}")

        # Find all streaks of ball in hoop
        streaks = []
        current_streak = 0
        streak_start_idx = -1

        for i, frame_info in enumerate(frames_in_hoop):
            if frame_info["in_hoop"]:
                if current_streak == 0:
                    streak_start_idx = i
                current_streak += 1
            else:
                if current_streak > 0:
                    streaks.append({
                        "start_idx": streak_start_idx,
                        "end_idx": i - 1,
                        "length": current_streak,
                        "start_time": frames_in_hoop[streak_start_idx]["timestamp"],
                        "end_time": frames_in_hoop[i - 1]["timestamp"],
                    })
                    current_streak = 0

        # Check for streak at the end
        if current_streak > 0:
            streaks.append({
                "start_idx": streak_start_idx,
                "end_idx": len(frames_in_hoop) - 1,
                "length": current_streak,
                "start_time": frames_in_hoop[streak_start_idx]["timestamp"],
                "end_time": frames_in_hoop[-1]["timestamp"],
            })

        # Sort streaks by length (longest first)
        streaks.sort(key=lambda s: s["length"], reverse=True)

        return {
            "continuous_frames_in_hoop": max_streak,
            "frames_in_hoop": frames_in_hoop,
            "hoop_region": hoop_region,
            "ball_positions": ball_positions,
            "ball_detected": True,
            "total_ball_frames": len(ball_positions),
            "streaks": streaks,
            "longest_streak": max_streak,
        }

    def _analyze_shot_with_high_fps(
        self,
        video_path: Union[str, Path],
        shot_result: BasketballShotResult
    ) -> Dict[str, Any]:
        """Analyze a basketball shot with high FPS for detailed assessment.

        Args:
            video_path: Path to video file
            shot_result: The shot result from low-fps analysis

        Returns:
            High-FPS analysis results with:
                - result: "make", "miss", or "uncertain"
                - confidence: Confidence score 0.0-1.0
                - continuous_frames_in_hoop: Number of frames ball continuously in hoop
                - analysis_details: Detailed breakdown of analysis
        """
        print(f"[HighFPSAnalysis] Starting high FPS analysis for shot at {shot_result.start_time:.2f}s")

        # Calculate time window for high FPS analysis
        window = self._config.high_fps_analysis_window
        start_time = max(0, shot_result.start_time - window/2)
        end_time = shot_result.end_time + window/2

        # Ensure minimum window size
        min_window = 1.0  # seconds
        if end_time - start_time < min_window:
            # Center the window around the shot
            center = (shot_result.start_time + shot_result.end_time) / 2
            start_time = max(0, center - min_window/2)
            end_time = start_time + min_window

        print(f"[HighFPSAnalysis] Time window: {start_time:.2f}-{end_time:.2f}s (duration: {end_time-start_time:.2f}s)")

        # Step 1: Extract high FPS frames
        try:
            frames, frame_times, video_info = self._extract_high_fps_frames(
                video_path, (start_time, end_time)
            )
        except Exception as e:
            print(f"[HighFPSAnalysis] Failed to extract high FPS frames: {e}")
            return {
                "result": "uncertain",
                "confidence": 0.3,
                "continuous_frames_in_hoop": 0,
                "error": f"Frame extraction failed: {e}",
                "analysis_details": {},
            }

        if len(frames) < 3:
            print(f"[HighFPSAnalysis] Not enough frames extracted: {len(frames)}")
            return {
                "result": "uncertain",
                "confidence": 0.3,
                "continuous_frames_in_hoop": 0,
                "error": f"Insufficient frames: {len(frames)}",
                "analysis_details": {
                    "frames_extracted": len(frames),
                    "time_window": (start_time, end_time),
                },
            }

        # Step 2: Analyze continuous frames for ball in hoop
        continuous_analysis = self._analyze_continuous_frames(
            frames, frame_times, video_info, shot_result.ball_track_id
        )

        # Step 3: Calculate confidence based on continuous analysis
        confidence_result = self._calculate_shot_confidence(
            shot_result, continuous_analysis
        )

        # Step 4: Determine final result
        min_frames_for_make = self._config.min_continuous_frames_for_make
        continuous_frames = continuous_analysis["continuous_frames_in_hoop"]

        if continuous_frames >= min_frames_for_make:
            result = "make"
            print(f"[HighFPSAnalysis] Shot judged as MAKE: {continuous_frames} continuous frames in hoop (≥{min_frames_for_make})")
        else:
            result = "miss"
            print(f"[HighFPSAnalysis] Shot judged as MISS: {continuous_frames} continuous frames in hoop (<{min_frames_for_make})")

        # Combine results
        final_result = {
            "result": result,
            "confidence": confidence_result["confidence"],
            "continuous_frames_in_hoop": continuous_frames,
            "original_shot_result": shot_result.shot_result,
            "original_confidence": shot_result.confidence,
            "analysis_details": {
                "time_window": (start_time, end_time),
                "frames_extracted": len(frames),
                "actual_fps": video_info.get("actual_fps", 0),
                "continuous_analysis": continuous_analysis,
                "confidence_breakdown": confidence_result,
                "min_frames_for_make": min_frames_for_make,
            },
        }

        print(f"[HighFPSAnalysis] Analysis complete: {result} (confidence: {final_result['confidence']:.2f})")
        return final_result

    def _calculate_shot_confidence(
        self,
        shot_result: BasketballShotResult,
        continuous_analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Calculate confidence score for a shot based on continuous frame analysis.

        Args:
            shot_result: Original shot result from low-fps analysis
            continuous_analysis: Results from continuous frame analysis

        Returns:
            Confidence breakdown with:
                - confidence: Overall confidence score (0.0-1.0)
                - factors: Individual factor scores
                - explanation: Text explanation of confidence calculation
        """
        # Base confidence from original analysis
        base_confidence = shot_result.confidence

        # Extract continuous analysis results
        continuous_frames = continuous_analysis.get("continuous_frames_in_hoop", 0)
        streaks = continuous_analysis.get("streaks", [])
        total_ball_frames = continuous_analysis.get("total_ball_frames", 0)
        ball_detected = continuous_analysis.get("ball_detected", False)

        # Initialize factor scores
        factors = {
            "continuous_frames_score": 0.0,
            "streak_length_score": 0.0,
            "ball_detection_score": 0.0,
            "consistency_score": 0.0,
        }

        explanations = []

        # Factor 1: Continuous frames in hoop
        min_frames_for_make = self._config.min_continuous_frames_for_make
        if continuous_frames >= min_frames_for_make:
            frames_score = min(1.0, continuous_frames / (min_frames_for_make * 2))
            factors["continuous_frames_score"] = frames_score
            explanations.append(f"Ball in hoop for {continuous_frames} consecutive frames (score: {frames_score:.2f})")
        else:
            # Partial credit for some frames
            if continuous_frames > 0:
                frames_score = continuous_frames / min_frames_for_make * 0.5
                factors["continuous_frames_score"] = frames_score
                explanations.append(f"Ball in hoop for {continuous_frames} frames (partial, score: {frames_score:.2f})")
            else:
                factors["continuous_frames_score"] = 0.0
                explanations.append("Ball never detected in hoop region")

        # Factor 2: Streak analysis (multiple streaks are better)
        if streaks:
            # Use longest streak
            longest_streak = max([s["length"] for s in streaks])
            streak_score = min(1.0, longest_streak / (min_frames_for_make * 1.5))
            factors["streak_length_score"] = streak_score
            explanations.append(f"Longest streak: {longest_streak} frames (score: {streak_score:.2f})")
        else:
            factors["streak_length_score"] = 0.0

        # Factor 3: Ball detection reliability
        if ball_detected and total_ball_frames > 0:
            # Higher score if ball detected in most frames
            detection_ratio = total_ball_frames / len(continuous_analysis.get("frames_in_hoop", [1]))
            detection_score = detection_ratio * 0.8
            factors["ball_detection_score"] = detection_score
            explanations.append(f"Ball detected in {total_ball_frames} frames ({detection_ratio:.1%}, score: {detection_score:.2f})")
        else:
            factors["ball_detection_score"] = 0.0
            if not ball_detected:
                explanations.append("Ball not detected in high-fps analysis")

        # Factor 4: Consistency with original analysis
        original_result = shot_result.shot_result
        if continuous_frames >= min_frames_for_make:
            # High-fps suggests make
            if original_result == "make":
                consistency_score = 0.8
                explanations.append("Consistent with original 'make' prediction (score: 0.80)")
            else:
                consistency_score = 0.3
                explanations.append("Contradicts original 'miss' prediction (score: 0.30)")
        else:
            # High-fps suggests miss
            if original_result == "miss":
                consistency_score = 0.8
                explanations.append("Consistent with original 'miss' prediction (score: 0.80)")
            else:
                consistency_score = 0.3
                explanations.append("Contradicts original 'make' prediction (score: 0.30)")

        factors["consistency_score"] = consistency_score

        # Calculate weighted overall confidence
        weights = {
            "continuous_frames_score": 0.4,   # Most important: actual ball in hoop
            "streak_length_score": 0.2,       # Strength of evidence
            "ball_detection_score": 0.2,      # Reliability of detection
            "consistency_score": 0.2,         # Agreement with low-fps
        }

        weighted_sum = sum(score * weights[name] for name, score in factors.items())
        overall_confidence = min(1.0, max(0.0, weighted_sum))

        # Adjust based on original confidence
        if overall_confidence > 0.5:
            # Blend with original confidence (70% high-fps, 30% original)
            final_confidence = 0.7 * overall_confidence + 0.3 * base_confidence
        else:
            # Low confidence from high-fps, trust it more
            final_confidence = 0.9 * overall_confidence + 0.1 * base_confidence

        final_confidence = min(0.95, max(0.05, final_confidence))

        print(f"[ConfidenceCalc] Overall confidence: {final_confidence:.2f} (weighted: {weighted_sum:.2f}, base: {base_confidence:.2f})")

        return {
            "confidence": final_confidence,
            "factors": factors,
            "weights": weights,
            "explanations": explanations,
            "base_confidence": base_confidence,
            "continuous_frames": continuous_frames,
            "min_frames_for_make": min_frames_for_make,
        }

    def _detect_objects(
        self, frame: np.ndarray, frame_index: int, timestamp: float
    ) -> List[DetectedObject]:
        """Detect objects in frame using YOLOv8 with tracking."""
        if self._object_detector is None:
            self._object_detector = self._load_object_detector()

        height, width = frame.shape[:2]
        detected_objects = []

        try:
            # Run YOLOv8 tracking on the frame
            # The persist=True parameter maintains track IDs across frames
            results = self._object_detector.track(
                frame,
                persist=True,
                conf=self._config.object_confidence_threshold,
                iou=self._config.object_iou_threshold,
                verbose=False,  # Reduce output noise
            )

            # Process detection results
            if results and len(results) > 0:
                result = results[0]  # First batch element

                # Check if tracking information is available
                if result.boxes is not None and result.boxes.id is not None:
                    boxes = result.boxes.xyxy.cpu().numpy()  # [x1, y1, x2, y2]
                    confidences = result.boxes.conf.cpu().numpy()
                    class_ids = result.boxes.cls.cpu().numpy().astype(int)
                    track_ids = result.boxes.id.cpu().numpy().astype(int)

                    # COCO class names (YOLOv8 default)
                    class_names = result.names

                    for i in range(len(boxes)):
                        bbox = boxes[i]
                        confidence = float(confidences[i])
                        class_id = class_ids[i]
                        track_id = int(track_ids[i])
                        class_name = class_names.get(class_id, f"class_{class_id}")

                        # Normalize bounding box coordinates
                        norm_bbox = self._normalize_bbox(
                            (bbox[0], bbox[1], bbox[2], bbox[3]),
                            width,
                            height
                        )

                        # Create DetectedObject
                        obj = DetectedObject(
                            object_id=track_id,
                            class_name=class_name,
                            confidence=confidence,
                            bbox=norm_bbox,
                            frame_index=frame_index,
                            timestamp=timestamp,
                        )

                        detected_objects.append(obj)

                        # Update track ID mapping
                        self._track_ids[track_id] = track_id

                elif result.boxes is not None:
                    # Detection without tracking (first frame or lost tracks)
                    boxes = result.boxes.xyxy.cpu().numpy()
                    confidences = result.boxes.conf.cpu().numpy()
                    class_ids = result.boxes.cls.cpu().numpy().astype(int)
                    class_names = result.names

                    for i in range(len(boxes)):
                        bbox = boxes[i]
                        confidence = float(confidences[i])
                        class_id = class_ids[i]
                        class_name = class_names.get(class_id, f"class_{class_id}")

                        # Assign new track ID
                        track_id = self._next_track_id
                        self._next_track_id += 1

                        # Normalize bounding box
                        norm_bbox = self._normalize_bbox(
                            (bbox[0], bbox[1], bbox[2], bbox[3]),
                            width,
                            height
                        )

                        obj = DetectedObject(
                            object_id=track_id,
                            class_name=class_name,
                            confidence=confidence,
                            bbox=norm_bbox,
                            frame_index=frame_index,
                            timestamp=timestamp,
                        )

                        detected_objects.append(obj)
                        self._track_ids[track_id] = track_id

            if detected_objects:
                print(f"[VideoAnalysis] Detected {len(detected_objects)} objects in frame {frame_index}")
            else:
                print(f"[VideoAnalysis] No objects detected in frame {frame_index}")

        except Exception as e:
            print(f"[VideoAnalysis] Error in object detection: {str(e)}")
            # Fallback to empty list
            detected_objects = []

        return detected_objects

    def _extract_text(
        self, frame: np.ndarray, frame_index: int, timestamp: float
    ) -> List[OCRResult]:
        """Extract text from frame using PaddleOCR."""
        if not self._config.include_ocr_text:
            return []

        if self._ocr_processor is None:
            self._ocr_processor = self._load_ocr_processor()

        try:
            # Ensure environment variables are set to avoid OneDNN errors
            import os
            os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'
            os.environ['ONEDNN_MAX_CPU_ISA'] = '0'
            os.environ['ONEDNN_ENABLE'] = '0'  # Completely disable OneDNN
            os.environ['OMP_NUM_THREADS'] = '1'
            os.environ['CUDA_VISIBLE_DEVICES'] = ''  # Disable CUDA, use CPU
            height, width = frame.shape[:2]
            ocr_results = []

            # Run PaddleOCR on the frame
            # PaddleOCR expects BGR format, but our frame is RGB
            # Convert RGB to BGR for PaddleOCR
            import cv2
            frame_bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

            # Run OCR
            result = self._ocr_processor.ocr(frame_bgr)

            # Process OCR results
            if result and result[0]:
                for line in result[0]:
                    if len(line) >= 2:
                        # line structure: [[bbox points], (text, confidence)]
                        bbox_points = line[0]  # [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]
                        text_info = line[1]  # (text, confidence)

                        if text_info and len(text_info) >= 2:
                            text = text_info[0]
                            confidence = float(text_info[1])

                            # Convert polygon bbox to axis-aligned bbox
                            # Get min/max coordinates
                            xs = [point[0] for point in bbox_points]
                            ys = [point[1] for point in bbox_points]
                            x1, x2 = min(xs), max(xs)
                            y1, y2 = min(ys), max(ys)

                            # Normalize bbox coordinates to 0-1 range
                            norm_bbox = (
                                x1 / width,
                                y1 / height,
                                x2 / width,
                                y2 / height,
                            )

                            # Filter out low confidence results
                            if confidence >= 0.5:  # Minimum confidence threshold
                                ocr_result = OCRResult(
                                    text=text,
                                    confidence=confidence,
                                    bbox=norm_bbox,
                                    frame_index=frame_index,
                                    timestamp=timestamp,
                                )
                                ocr_results.append(ocr_result)

            if ocr_results:
                print(f"[VideoAnalysis] Extracted {len(ocr_results)} text regions from frame {frame_index}")
                # Print first few texts for debugging
                for i, ocr in enumerate(ocr_results[:3]):
                    print(f"[VideoAnalysis]   Text {i+1}: '{ocr.text}' (conf={ocr.confidence:.3f})")
            else:
                print(f"[VideoAnalysis] No text detected in frame {frame_index}")

            return ocr_results

        except Exception as e:
            print(f"[VideoAnalysis] Error in OCR processing: {str(e)}")
            # Return empty list on error
            return []

    def _extract_scene_features(self, frame: np.ndarray) -> np.ndarray:
        """Extract CLIP features from frame for scene understanding."""
        if self._scene_processor is None:
            self._scene_processor = self._load_scene_processor()

        try:
            model = self._scene_processor["model"]
            processor = self._scene_processor["processor"]

            # Preprocess frame for CLIP
            # CLIP expects PIL Image, so convert numpy array to PIL
            from PIL import Image
            pil_image = Image.fromarray(frame)

            # Process image through CLIP
            inputs = processor(images=pil_image, return_tensors="pt")

            # Move to device
            inputs = {k: v.to(self._device) for k, v in inputs.items()}

            # Extract image features
            with torch.no_grad():
                image_features = model.get_image_features(**inputs)

                # Handle different return types from CLIP model
                # Some versions return BaseModelOutputWithPooling, others return tensor directly
                if hasattr(image_features, 'last_hidden_state'):
                    # It's a BaseModelOutputWithPooling object
                    image_features_tensor = image_features.last_hidden_state
                elif hasattr(image_features, 'pooler_output'):
                    # Alternative output type
                    image_features_tensor = image_features.pooler_output
                else:
                    # Assume it's already a tensor
                    image_features_tensor = image_features

                # Normalize features
                if hasattr(image_features_tensor, 'norm'):
                    image_features_tensor = image_features_tensor / image_features_tensor.norm(dim=-1, keepdim=True)
                else:
                    # Manual normalization
                    image_features_tensor = image_features_tensor / torch.norm(image_features_tensor, dim=-1, keepdim=True)

                features = image_features_tensor.cpu().numpy().flatten()

            return features

        except Exception as e:
            print(f"[VideoAnalysis] Error extracting scene features: {str(e)}")
            # Return zero vector as fallback
            return np.zeros(CLIP_FEATURE_DIM)

    def _classify_scenes(
        self, scene_features: List[Tuple[int, float, np.ndarray]], objects: List[DetectedObject]
    ) -> List[SceneSegment]:
        """Classify scenes and activities based on features."""
        if not scene_features:
            return []

        # Predefined scene labels for zero-shot classification
        scene_labels = [
            "indoor room", "outdoor landscape", "city street", "office", "kitchen",
            "living room", "bedroom", "restaurant", "store", "park", "beach",
            "mountain", "forest", "sports field", "stage", "concert", "classroom",
            "laboratory", "hospital", "factory", "construction site", "airport",
            "train station", "road", "highway", "bridge", "tunnel", "parking lot",
            "playground", "gym", "swimming pool", "stadium", "museum", "library",
            "hotel", "bar", "club", "church", "temple", "mosque"
        ]

        # Activity labels (optional)
        activity_labels = [
            "people walking", "people talking", "people running", "people dancing",
            "people eating", "people drinking", "people working", "people playing sports",
            "people driving", "people shopping", "people exercising", "people cooking",
            "people cleaning", "people reading", "people writing", "people watching TV",
            "people using computer", "people sleeping", "people standing", "people sitting"
        ]

        scene_segments = []
        current_segment_start = 0
        current_features = []

        # Group similar frames into segments
        for i, (frame_idx, timestamp, features) in enumerate(scene_features):
            current_features.append(features)

            # If we have enough frames or reached the end, classify the segment
            if i == len(scene_features) - 1 or len(current_features) >= 10:
                # Average features for the segment
                avg_features = np.mean(current_features, axis=0)

                # Classify scene using zero-shot CLIP (simplified)
                # In real implementation, we would use CLIP model
                scene_label, scene_confidence = self._classify_with_clip(
                    avg_features, scene_labels
                )

                # Classify activity (optional)
                activity_label, activity_confidence = None, None
                if self._config.include_scene_labels:
                    activity_label, activity_confidence = self._classify_with_clip(
                        avg_features, activity_labels
                    )

                # Determine dominant objects in this segment
                segment_objects = [
                    obj for obj in objects
                    if current_segment_start <= obj.frame_index <= frame_idx
                ]
                dominant_objects = self._get_dominant_objects(segment_objects)

                # Calculate clip priority based on scene and objects
                clip_priority = self._calculate_clip_priority(
                    scene_label, activity_label, dominant_objects
                )

                # Create scene segment
                start_time = scene_features[current_segment_start][1]
                end_time = timestamp

                segment = SceneSegment(
                    start_time=start_time,
                    end_time=end_time,
                    scene_label=scene_label,
                    scene_confidence=scene_confidence,
                    activity_label=activity_label,
                    activity_confidence=activity_confidence,
                    dominant_objects=dominant_objects,
                    clip_priority=clip_priority,
                )

                scene_segments.append(segment)
                print(f"[VideoAnalysis] Scene segment: {start_time:.2f}-{end_time:.2f}s, "
                      f"scene={scene_label}, priority={clip_priority}")

                # Reset for next segment
                current_segment_start = i + 1
                current_features = []

        return scene_segments

    def _detect_shot_boundaries(
        self, scene_features: List[Tuple[int, float, np.ndarray]]
    ) -> List[ShotBoundary]:
        """Detect shot boundaries using CLIP feature similarity."""
        if not scene_features or len(scene_features) < 2:
            return []

        shot_boundaries = []
        prev_features = None
        prev_frame_idx = None
        prev_timestamp = None

        for frame_idx, timestamp, features in scene_features:
            if prev_features is not None:
                # Calculate cosine similarity between current and previous features
                similarity = self._cosine_similarity(features, prev_features)

                # Determine boundary type based on similarity score
                if similarity < self._config.shot_change_threshold:
                    boundary_type = "cut" if similarity < 0.1 else "gradual"

                    shot_boundary = ShotBoundary(
                        frame_index=frame_idx,
                        timestamp=timestamp,
                        boundary_type=boundary_type,
                        similarity_score=similarity,
                    )
                    shot_boundaries.append(shot_boundary)

                    print(f"[VideoAnalysis] Shot boundary detected at frame {frame_idx} "
                          f"(t={timestamp:.2f}s, similarity={similarity:.3f}, type={boundary_type})")

            prev_features = features
            prev_frame_idx = frame_idx
            prev_timestamp = timestamp

        print(f"[VideoAnalysis] Detected {len(shot_boundaries)} shot boundaries")
        return shot_boundaries

    def _detect_invalid_segments(
        self, frames: List[np.ndarray], frame_times: List[float]
    ) -> List[Dict[str, Any]]:
        """Detect invalid segments (black screens, static frames)."""
        if not frames or len(frames) < 2:
            return []

        invalid_segments = []
        current_invalid_start = None
        current_invalid_type = None
        frame_interval = frame_times[1] - frame_times[0] if len(frame_times) > 1 else 0.5

        try:
            import cv2

            prev_frame = None
            prev_features = None

            for i, (frame, timestamp) in enumerate(zip(frames, frame_times)):
                # Check for black screen (low average pixel intensity)
                gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
                avg_intensity = np.mean(gray)

                # Check for static frame (similar to previous frame)
                is_static = False
                if prev_frame is not None:
                    # Calculate structural similarity
                    from skimage.metrics import structural_similarity
                    try:
                        # Resize for faster comparison
                        prev_small = cv2.resize(prev_frame, (64, 64))
                        curr_small = cv2.resize(frame, (64, 64))
                        prev_gray = cv2.cvtColor(prev_small, cv2.COLOR_RGB2GRAY)
                        curr_gray = cv2.cvtColor(curr_small, cv2.COLOR_RGB2GRAY)

                        ssim_score = structural_similarity(prev_gray, curr_gray, data_range=255)
                        is_static = ssim_score > 0.95  # Very similar frames
                    except:
                        # Fallback: simple pixel difference
                        diff = np.abs(prev_frame.astype(float) - frame.astype(float))
                        is_static = np.mean(diff) < 5.0  # Almost no change

                # Extract scene features for content analysis
                current_features = self._extract_scene_features(frame)

                # Check for low content variation
                low_variation = False
                if prev_features is not None:
                    similarity = self._cosine_similarity(current_features, prev_features)
                    low_variation = similarity > 0.98  # Almost identical features

                # Determine invalid type
                invalid_type = None
                invalid_reason = None
                clip_priority = 0

                if avg_intensity < 30:  # Very dark frame
                    invalid_type = "black_screen"
                    invalid_reason = f"low brightness (avg={avg_intensity:.1f})"
                    clip_priority = 0
                elif avg_intensity > 220:  # Very bright/overexposed
                    invalid_type = "overexposed"
                    invalid_reason = f"high brightness (avg={avg_intensity:.1f})"
                    clip_priority = 1
                elif is_static:
                    invalid_type = "static_frame"
                    invalid_reason = "no significant change from previous frame"
                    clip_priority = 1
                elif low_variation:
                    invalid_type = "low_variation"
                    invalid_reason = "very similar content to previous frame"
                    clip_priority = 2
                else:
                    # Not invalid, check if we need to close a previous invalid segment
                    if current_invalid_start is not None:
                        # Close the invalid segment
                        invalid_segments.append({
                            "time_range": [current_invalid_start, timestamp],
                            "reason": current_invalid_type,
                            "clip_priority": clip_priority,
                            "frames": i - self._find_frame_index(frame_times, current_invalid_start)
                        })
                        current_invalid_start = None
                        current_invalid_type = None
                    continue

                # Start or continue invalid segment
                if current_invalid_start is None:
                    current_invalid_start = timestamp
                    current_invalid_type = invalid_type
                elif current_invalid_type != invalid_type:
                    # Type changed, close previous segment
                    invalid_segments.append({
                        "time_range": [current_invalid_start, timestamp],
                        "reason": current_invalid_type,
                        "clip_priority": clip_priority,
                        "frames": i - self._find_frame_index(frame_times, current_invalid_start)
                    })
                    current_invalid_start = timestamp
                    current_invalid_type = invalid_type

                prev_frame = frame
                prev_features = current_features

            # Close any remaining invalid segment
            if current_invalid_start is not None and len(frame_times) > 0:
                invalid_segments.append({
                    "time_range": [current_invalid_start, frame_times[-1]],
                    "reason": current_invalid_type,
                    "clip_priority": 0,
                    "frames": len(frames) - self._find_frame_index(frame_times, current_invalid_start)
                })

            print(f"[VideoAnalysis] Detected {len(invalid_segments)} invalid segments")
            for seg in invalid_segments:
                print(f"[VideoAnalysis]   Invalid: {seg['time_range'][0]:.2f}-{seg['time_range'][1]:.2f}s "
                      f"({seg['reason']})")

            return invalid_segments

        except Exception as e:
            print(f"[VideoAnalysis] Error detecting invalid segments: {str(e)}")
            return []

    def _recommend_clips(
        self,
        scene_segments: List[SceneSegment],
        objects: List[DetectedObject],
        shot_boundaries: List[ShotBoundary],
        frame_times: List[float],
    ) -> List[Dict[str, Any]]:
        """Recommend clips for editing based on analysis results."""
        recommended_clips = []

        if not scene_segments:
            print(f"[VideoAnalysis] No scene segments for clip recommendation")
            return []

        # Strategy 1: Recommend high-priority scene segments
        for segment in scene_segments:
            if segment.clip_priority >= 7:  # High priority segments
                # Extend segment slightly before and after for better editing
                start_time = max(0, segment.start_time - 0.5)  # 0.5s before
                end_time = min(frame_times[-1] if frame_times else segment.end_time,
                              segment.end_time + 0.5)  # 0.5s after

                # Find nearest shot boundary for clean cut
                clean_start, clean_end = self._align_to_shot_boundaries(
                    start_time, end_time, shot_boundaries
                )

                # Check if this segment has interesting objects
                segment_objects = [
                    obj for obj in objects
                    if clean_start <= obj.timestamp <= clean_end
                ]
                interesting_objects = self._get_interesting_objects(segment_objects)

                # Build recommendation
                recommendation = {
                    "start_time": clean_start,
                    "end_time": clean_end,
                    "duration": clean_end - clean_start,
                    "reason": f"high priority scene: {segment.scene_label}",
                    "confidence": segment.scene_confidence,
                    "clip_priority": segment.clip_priority,
                    "scene_type": segment.scene_label,
                    "activity": segment.activity_label,
                    "interesting_objects": interesting_objects,
                    "type": "scene_highlight",
                }

                recommended_clips.append(recommendation)
                print(f"[VideoAnalysis] Recommended clip: {clean_start:.2f}-{clean_end:.2f}s "
                      f"({segment.scene_label}, priority={segment.clip_priority})")

        # Strategy 2: Recommend based on object interactions
        object_based_clips = self._recommend_clips_by_objects(objects, frame_times, shot_boundaries)
        recommended_clips.extend(object_based_clips)

        # Strategy 3: Recommend around shot boundaries (clean transitions)
        boundary_based_clips = self._recommend_clips_by_boundaries(shot_boundaries, frame_times)
        recommended_clips.extend(boundary_based_clips)

        # Sort clips by priority and remove overlapping clips
        recommended_clips = self._deduplicate_and_sort_clips(recommended_clips)

        print(f"[VideoAnalysis] Generated {len(recommended_clips)} recommended clips")
        return recommended_clips

    # Utility methods
    def _normalize_bbox(
        self, bbox: Tuple[float, float, float, float], frame_width: int, frame_height: int
    ) -> Tuple[float, float, float, float]:
        """Normalize bounding box coordinates to 0-1 range."""
        x1, y1, x2, y2 = bbox
        return (
            x1 / frame_width,
            y1 / frame_height,
            x2 / frame_width,
            y2 / frame_height,
        )

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Calculate cosine similarity between two vectors."""
        # Ensure vectors are normalized
        a_norm = a / (np.linalg.norm(a) + 1e-10)
        b_norm = b / (np.linalg.norm(b) + 1e-10)
        return float(np.dot(a_norm, b_norm))

    def _classify_with_clip(self, features: np.ndarray, labels: List[str]) -> Tuple[str, float]:
        """Classify features against text labels using CLIP (simplified)."""
        # In a real implementation, this would use CLIP text encoder
        # For now, return a mock classification
        if not labels:
            return "unknown", 0.5

        # Simulate classification by returning first label with random confidence
        # TODO: Replace with actual CLIP text encoding and similarity calculation
        import random
        selected_label = random.choice(labels)
        confidence = random.uniform(0.7, 0.95)

        return selected_label, confidence

    def _get_dominant_objects(self, objects: List[DetectedObject]) -> List[str]:
        """Get the most frequent object classes in a list."""
        from collections import Counter

        if not objects:
            return []

        # Count object classes
        class_counter = Counter(obj.class_name for obj in objects)

        # Get top 3 most frequent classes
        top_classes = [class_name for class_name, _ in class_counter.most_common(3)]

        return top_classes

    def _calculate_clip_priority(
        self, scene_label: str, activity_label: Optional[str], dominant_objects: List[str]
    ) -> int:
        """Calculate clip priority score (0-10) for editing."""
        priority = 5  # Default middle priority

        # Adjust based on scene type
        high_priority_scenes = {
            "sports field", "stage", "concert", "playground", "gym",
            "swimming pool", "stadium", "park", "beach"
        }

        low_priority_scenes = {
            "parking lot", "highway", "bridge", "tunnel", "factory"
        }

        if scene_label in high_priority_scenes:
            priority += 2
        elif scene_label in low_priority_scenes:
            priority -= 2

        # Adjust based on activity
        if activity_label and any(keyword in activity_label for keyword in [
            "dancing", "playing sports", "exercising", "running"
        ]):
            priority += 1

        # Adjust based on objects
        high_value_objects = {"person", "dog", "cat", "car", "sports ball"}
        for obj in dominant_objects:
            if obj in high_value_objects:
                priority += 1
                break

        # Clamp to 0-10 range
        return max(0, min(10, priority))

    def _find_frame_index(self, frame_times: List[float], timestamp: float) -> int:
        """Find the frame index closest to the given timestamp."""
        if not frame_times:
            return 0

        # Find closest frame time
        closest_idx = 0
        min_diff = abs(frame_times[0] - timestamp)

        for i, t in enumerate(frame_times):
            diff = abs(t - timestamp)
            if diff < min_diff:
                min_diff = diff
                closest_idx = i

        return closest_idx

    def _align_to_shot_boundaries(
        self, start_time: float, end_time: float, shot_boundaries: List[ShotBoundary]
    ) -> Tuple[float, float]:
        """Align clip boundaries to nearest shot boundaries for clean cuts."""
        if not shot_boundaries:
            return start_time, end_time

        # Find nearest shot boundary for start
        nearest_start = start_time
        min_start_diff = float('inf')
        for boundary in shot_boundaries:
            diff = abs(boundary.timestamp - start_time)
            if diff < min_start_diff and diff < 1.0:  # Within 1 second
                min_start_diff = diff
                nearest_start = boundary.timestamp

        # Find nearest shot boundary for end
        nearest_end = end_time
        min_end_diff = float('inf')
        for boundary in shot_boundaries:
            diff = abs(boundary.timestamp - end_time)
            if diff < min_end_diff and diff < 1.0:  # Within 1 second
                min_end_diff = diff
                nearest_end = boundary.timestamp

        return nearest_start, nearest_end

    def _get_interesting_objects(self, objects: List[DetectedObject]) -> List[str]:
        """Get interesting object types from a list."""
        interesting_types = {
            "person", "dog", "cat", "bird", "horse", "sheep", "cow", "elephant",
            "bear", "zebra", "giraffe", "sports ball", "frisbee", "kite",
            "baseball bat", "baseball glove", "skateboard", "surfboard",
            "tennis racket", "bottle", "wine glass", "cup", "fork", "knife",
            "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli",
            "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
            "potted plant", "bed", "dining table", "toilet", "tv", "laptop",
            "mouse", "remote", "keyboard", "cell phone", "microwave", "oven",
            "toaster", "sink", "refrigerator", "book", "clock", "vase",
            "scissors", "teddy bear", "hair drier", "toothbrush"
        }

        # Get unique object classes
        object_classes = set(obj.class_name for obj in objects)

        # Filter for interesting classes
        interesting = [cls for cls in object_classes if cls in interesting_types]

        # Limit to top 5 most interesting
        return interesting[:5]

    def _recommend_clips_by_objects(
        self, objects: List[DetectedObject], frame_times: List[float], shot_boundaries: List[ShotBoundary]
    ) -> List[Dict[str, Any]]:
        """Recommend clips based on interesting object interactions."""
        if not objects or not frame_times:
            return []

        # Group objects by track ID to find continuous appearances
        object_tracks = {}
        for obj in objects:
            if obj.object_id not in object_tracks:
                object_tracks[obj.object_id] = []
            object_tracks[obj.object_id].append(obj)

        recommended_clips = []

        # Look for interesting object tracks
        interesting_objects = {"person", "dog", "cat", "sports ball", "car", "bird"}
        for track_id, track_objects in object_tracks.items():
            if len(track_objects) < 3:  # Need at least 3 frames for a meaningful clip
                continue

            # Check if this is an interesting object type
            obj_type = track_objects[0].class_name
            if obj_type not in interesting_objects:
                continue

            # Get time range for this track
            start_time = min(obj.timestamp for obj in track_objects)
            end_time = max(obj.timestamp for obj in track_objects)

            # Extend clip for context
            clip_start = max(0, start_time - 1.0)  # 1 second before
            clip_end = min(frame_times[-1], end_time + 1.0)  # 1 second after

            # Ensure minimum duration
            if clip_end - clip_start < 2.0:
                clip_end = min(frame_times[-1], clip_start + 3.0)

            # Align to shot boundaries
            clean_start, clean_end = self._align_to_shot_boundaries(
                clip_start, clip_end, shot_boundaries
            )

            # Calculate confidence based on object detection consistency
            avg_confidence = np.mean([obj.confidence for obj in track_objects])

            recommendation = {
                "start_time": clean_start,
                "end_time": clean_end,
                "duration": clean_end - clean_start,
                "reason": f"interesting object: {obj_type} (track {track_id})",
                "confidence": float(avg_confidence),
                "clip_priority": 6,  # Medium priority for object tracks
                "object_type": obj_type,
                "track_id": track_id,
                "frame_count": len(track_objects),
                "type": "object_tracking",
            }

            recommended_clips.append(recommendation)

        return recommended_clips

    def _recommend_clips_by_boundaries(
        self, shot_boundaries: List[ShotBoundary], frame_times: List[float]
    ) -> List[Dict[str, Any]]:
        """Recommend clips around shot boundaries (clean transitions)."""
        if not shot_boundaries or len(shot_boundaries) < 2:
            return []

        recommended_clips = []
        video_end = frame_times[-1] if frame_times else 0

        # Group consecutive shot boundaries into potential clips
        for i in range(len(shot_boundaries) - 1):
            current_boundary = shot_boundaries[i]
            next_boundary = shot_boundaries[i + 1]

            # Only consider cuts (not gradual transitions)
            if current_boundary.boundary_type != "cut":
                continue

            # Create clip from this boundary to next (or a few seconds)
            clip_start = current_boundary.timestamp
            clip_end = next_boundary.timestamp

            # Ensure minimum and maximum duration
            duration = clip_end - clip_start
            if duration < 1.0:  # Too short
                clip_end = min(video_end, clip_start + 3.0)
            elif duration > 10.0:  # Too long
                clip_end = clip_start + 5.0  # Limit to 5 seconds

            recommendation = {
                "start_time": clip_start,
                "end_time": clip_end,
                "duration": clip_end - clip_start,
                "reason": f"clean transition at {clip_start:.2f}s",
                "confidence": 0.8,
                "clip_priority": 5,  # Medium priority for transitions
                "transition_type": current_boundary.boundary_type,
                "similarity_score": current_boundary.similarity_score,
                "type": "shot_transition",
            }

            recommended_clips.append(recommendation)

        return recommended_clips

    def _deduplicate_and_sort_clips(
        self, clips: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Remove overlapping clips and sort by priority."""
        if not clips:
            return []

        # Sort by start time
        clips.sort(key=lambda x: x["start_time"])

        deduplicated = []
        current_end = -1.0

        for clip in clips:
            # Skip clips that are too short (< 1 second)
            if clip["duration"] < 1.0:
                continue

            # Skip clips that overlap significantly with previous clip
            if clip["start_time"] < current_end - 0.5:  # 0.5 second overlap threshold
                # Keep the higher priority clip
                if deduplicated and clip["clip_priority"] > deduplicated[-1]["clip_priority"]:
                    deduplicated[-1] = clip
                    current_end = clip["end_time"]
                continue

            deduplicated.append(clip)
            current_end = clip["end_time"]

        # Sort by priority (descending) then by start time
        deduplicated.sort(key=lambda x: (-x["clip_priority"], x["start_time"]))

        # Limit to top 10 clips
        return deduplicated[:10]

    # ============================================================
    # Basketball Analysis Methods
    # ============================================================

    def _analyze_basketball_shots(
        self,
        objects: List[DetectedObject],
        frame_times: List[float],
        frames: List[np.ndarray],
        video_info: Dict[str, Any]
    ) -> Optional[List[BasketballShotResult]]:
        """Analyze basketball shots based on object trajectories."""
        if not objects:
            print("[BasketballAnalysis] No objects detected, skipping basketball analysis")
            return None

        print("[BasketballAnalysis] Starting basketball shot analysis")

        # 1. Extract ball trajectories
        ball_tracks = self._extract_ball_tracks(objects)
        if not ball_tracks:
            print("[BasketballAnalysis] No basketball trajectories found")
            return None

        print(f"[BasketballAnalysis] Found {len(ball_tracks)} ball trajectories")

        # 2. Estimate hoop position (if not provided in config)
        hoop_position = self._config.hoop_position
        if hoop_position is None:
            hoop_position = self._estimate_hoop_position(frames[0] if frames else None)
            if hoop_position is None:
                print("[BasketballAnalysis] Warning: Could not estimate hoop position")

        # 3. Detect shot attempts from ball trajectories
        shot_attempts = self._detect_shot_attempts(ball_tracks, objects)
        if not shot_attempts:
            print("[BasketballAnalysis] No shot attempts detected")
            return None

        print(f"[BasketballAnalysis] Detected {len(shot_attempts)} shot attempts")

        # 4. Judge shot results (make/miss)
        shot_results = self._judge_shot_results(shot_attempts, hoop_position)

        # 5. Filter by confidence
        confident_shots = [
            shot for shot in shot_results
            if shot.confidence >= self._config.basketball_confidence_threshold
        ]

        print(f"[BasketballAnalysis] {len(confident_shots)} confident shot results")

        return confident_shots

    def _extract_ball_tracks(self, objects: List[DetectedObject]) -> Dict[int, List[Dict[str, Any]]]:
        """Extract basketball trajectories from detected objects."""
        ball_tracks = {}

        for obj in objects:
            # YOLOv8 COCO class "sports ball" is ID 32
            if obj.class_name == "sports ball" and obj.confidence > 0.3:
                track_id = obj.object_id
                if track_id not in ball_tracks:
                    ball_tracks[track_id] = []

                # Calculate ball center position
                x1, y1, x2, y2 = obj.bbox
                center_x = (x1 + x2) / 2.0
                center_y = (y1 + y2) / 2.0

                ball_tracks[track_id].append({
                    "position": (center_x, center_y),
                    "timestamp": obj.timestamp,
                    "frame_index": obj.frame_index,
                    "bbox": obj.bbox,
                    "confidence": obj.confidence,
                    "size": abs(x2 - x1) * abs(y2 - y1),  # normalized area
                })

        # Sort each track by timestamp
        for track_id in ball_tracks:
            ball_tracks[track_id].sort(key=lambda x: x["timestamp"])

        return ball_tracks

    def _estimate_hoop_position(self, frame: Optional[np.ndarray]) -> Optional[Tuple[float, float]]:
        """Estimate basketball hoop position in normalized coordinates."""
        # For NBA 2K26 games, hoop is typically at top center of the frame
        # This is a simple heuristic - in practice should use a hoop detector
        if frame is None:
            # Default position: top center (0.5, 0.15)
            return (0.5, 0.15)

        # Try to detect hoop based on common game UI patterns
        # This is a placeholder - real implementation would use computer vision
        # For now, assume standard NBA 2K camera angle
        height, width = frame.shape[:2]

        # Typical hoop position in basketball game videos:
        # - Near top of frame
        # - Slightly off-center depending on camera angle
        return (0.5, 0.18)  # x=center, y=18% from top

    def _detect_shot_attempts(
        self,
        ball_tracks: Dict[int, List[Dict[str, Any]]],
        all_objects: List[DetectedObject]
    ) -> List[Dict[str, Any]]:
        """Detect basketball shot attempts from ball trajectories."""
        shot_attempts = []

        for track_id, positions in ball_tracks.items():
            if len(positions) < 3:  # Need at least 3 frames for trajectory analysis
                continue

            # Extract position arrays for analysis
            timestamps = np.array([p["timestamp"] for p in positions])
            pos_array = np.array([p["position"] for p in positions])

            # 1. Check for upward motion (shooting motion)
            vertical_positions = pos_array[:, 1]  # y-coordinates
            vertical_velocity = np.diff(vertical_positions) / np.diff(timestamps)

            # Shooting typically involves upward motion
            upward_motion = np.mean(vertical_velocity) < -0.01  # Negative = upward

            # 2. Check for parabolic trajectory
            is_parabolic = self._is_parabolic_trajectory(pos_array, timestamps)

            # 3. Check if ball is near a player (shooting action)
            near_player = self._is_ball_near_player(positions, all_objects)

            # 4. Check duration constraints
            duration = timestamps[-1] - timestamps[0]
            valid_duration = (
                self._config.min_shot_duration <= duration <= self._config.max_shot_duration
            )

            # Determine if this is a shot attempt
            if (upward_motion or is_parabolic) and valid_duration:
                # Find shooting player (closest player at start of shot)
                player_id = self._find_shooting_player(positions[0], all_objects)

                shot_attempts.append({
                    "track_id": track_id,
                    "positions": positions,
                    "start_time": timestamps[0],
                    "end_time": timestamps[-1],
                    "duration": duration,
                    "is_parabolic": is_parabolic,
                    "upward_motion": upward_motion,
                    "near_player": near_player,
                    "player_id": player_id,
                    "trajectory": pos_array,
                    "timestamps": timestamps,
                })

        return shot_attempts

    def _is_parabolic_trajectory(
        self,
        positions: np.ndarray,
        timestamps: np.ndarray
    ) -> bool:
        """Check if trajectory follows a parabolic shape (characteristic of shots)."""
        if len(positions) < 4:
            return False

        try:
            # Simple parabola detection: fit quadratic curve to y-position
            # y = a*t^2 + b*t + c
            t = timestamps - timestamps[0]  # Relative time
            y = positions[:, 1]  # Vertical positions

            # Fit quadratic polynomial
            coeffs = np.polyfit(t, y, 2)
            a, b, c = coeffs

            # For a typical shot parabola, a should be positive (concave up)
            # and the parabola should have a clear peak
            if a > 0:  # Concave upward (parabola opening upward)
                # Calculate vertex time: t_vertex = -b/(2a)
                t_vertex = -b / (2 * a)

                # Vertex should be within the trajectory time range
                if 0 < t_vertex < t[-1]:
                    # Calculate predicted y at vertex
                    y_vertex = a * t_vertex**2 + b * t_vertex + c

                    # Vertex should be higher than endpoints (ball goes up then down)
                    y_start = y[0]
                    y_end = y[-1]

                    if y_vertex < min(y_start, y_end):  # Vertex is highest point
                        return True
        except Exception as e:
            print(f"[BasketballAnalysis] Parabola detection error: {e}")

        return False

    def _is_ball_near_player(
        self,
        ball_positions: List[Dict[str, Any]],
        all_objects: List[DetectedObject]
    ) -> bool:
        """Check if basketball is near any player (potential shooting action)."""
        if not ball_positions:
            return False

        # Check first few positions (start of shot)
        check_positions = ball_positions[:min(3, len(ball_positions))]

        for ball_pos in check_positions:
            ball_x, ball_y = ball_pos["position"]
            ball_time = ball_pos["timestamp"]

            # Find players at similar timestamp
            players = [
                obj for obj in all_objects
                if obj.class_name == "person"
                and abs(obj.timestamp - ball_time) < 0.5  # Within 0.5 seconds
                and obj.confidence > 0.4
            ]

            for player in players:
                # Calculate distance between ball and player
                px1, py1, px2, py2 = player.bbox
                player_center_x = (px1 + px2) / 2.0
                player_center_y = (py1 + py2) / 2.0

                distance = np.sqrt(
                    (ball_x - player_center_x)**2 + (ball_y - player_center_y)**2
                )

                # If ball is close to player (normalized distance < 0.2)
                if distance < 0.2:
                    return True

        return False

    def _find_shooting_player(
        self,
        ball_position: Dict[str, Any],
        all_objects: List[DetectedObject]
    ) -> Optional[int]:
        """Find the player most likely shooting the ball."""
        ball_x, ball_y = ball_position["position"]
        ball_time = ball_position["timestamp"]

        closest_player = None
        min_distance = float('inf')

        for obj in all_objects:
            if obj.class_name == "person" and abs(obj.timestamp - ball_time) < 0.3:
                px1, py1, px2, py2 = obj.bbox
                player_center_x = (px1 + px2) / 2.0
                player_center_y = (py1 + py2) / 2.0

                distance = np.sqrt(
                    (ball_x - player_center_x)**2 + (ball_y - player_center_y)**2
                )

                if distance < min_distance:
                    min_distance = distance
                    closest_player = obj.object_id

        return closest_player

    def _judge_shot_results(
        self,
        shot_attempts: List[Dict[str, Any]],
        hoop_position: Optional[Tuple[float, float]]
    ) -> List[BasketballShotResult]:
        """Judge whether shots are made or missed."""
        shot_results = []

        for attempt in shot_attempts:
            positions = attempt["positions"]
            timestamps = attempt["timestamps"]
            trajectory = attempt["trajectory"]

            # Default values
            shot_result = "miss"  # Assume miss by default
            confidence = 0.5
            distance_to_hoop = None
            release_angle = None
            release_speed = None

            if hoop_position is not None:
                # Analyze trajectory relative to hoop
                hoop_x, hoop_y = hoop_position

                # Calculate release parameters (first few frames)
                if len(trajectory) >= 3:
                    # Release point (start of trajectory)
                    release_pos = trajectory[0]
                    release_time = timestamps[0]

                    # Calculate release angle and speed
                    if len(trajectory) >= 4:
                        # Use first 4 points to estimate initial velocity
                        dt = timestamps[3] - timestamps[0]
                        if dt > 0:
                            dx = trajectory[3][0] - trajectory[0][0]
                            dy = trajectory[3][1] - trajectory[0][1]
                            release_speed = np.sqrt(dx**2 + dy**2) / dt
                            release_angle = np.degrees(np.arctan2(-dy, dx))  # Negative dy for upward

                    # Calculate distance to hoop at release
                    distance_to_hoop = np.sqrt(
                        (release_pos[0] - hoop_x)**2 + (release_pos[1] - hoop_y)**2
                    )

                    # Predict trajectory endpoint
                    predicted_end = self._predict_trajectory_end(trajectory, timestamps)

                    if predicted_end is not None:
                        # Calculate if trajectory passes near hoop
                        hoop_distance = np.sqrt(
                            (predicted_end[0] - hoop_x)**2 + (predicted_end[1] - hoop_y)**2
                        )

                        # Simple heuristic: if predicted end is close to hoop, likely make
                        if hoop_distance < 0.1:  # Within 10% of frame width/height
                            shot_result = "make"
                            confidence = 0.7 + (0.3 * (1 - hoop_distance/0.1))
                        else:
                            shot_result = "miss"
                            confidence = 0.6
                    else:
                        # Can't predict trajectory, use distance-based heuristic
                        if distance_to_hoop < 0.15:  # Close to hoop
                            shot_result = "make"
                            confidence = 0.65
                        else:
                            shot_result = "miss"
                            confidence = 0.6
                else:
                    # Not enough trajectory data
                    shot_result = "miss"
                    confidence = 0.5
            else:
                # No hoop position, use trajectory shape only
                if attempt["is_parabolic"]:
                    # Good parabola suggests intentional shot
                    shot_result = "miss"  # Assume miss without hoop reference
                    confidence = 0.6
                else:
                    shot_result = "miss"
                    confidence = 0.4

            # Adjust confidence based on other factors
            if attempt["upward_motion"]:
                confidence += 0.1
            if attempt["near_player"]:
                confidence += 0.1
            if attempt["is_parabolic"]:
                confidence += 0.15

            # Cap confidence at 0.95
            confidence = min(0.95, max(0.3, confidence))

            # Create shot result
            shot_result_obj = BasketballShotResult(
                start_time=attempt["start_time"],
                end_time=attempt["end_time"],
                duration=attempt["duration"],
                shot_type=self._classify_shot_type(attempt, distance_to_hoop),
                shot_result=shot_result,
                confidence=confidence,
                ball_track_id=attempt["track_id"],
                player_track_id=attempt.get("player_id"),
                trajectory=trajectory.tolist() if trajectory is not None else None,
                distance_to_hoop=distance_to_hoop,
                release_angle=release_angle,
                release_speed=release_speed,
            )

            shot_results.append(shot_result_obj)

        return shot_results

    def _predict_trajectory_end(
        self,
        trajectory: np.ndarray,
        timestamps: np.ndarray
    ) -> Optional[Tuple[float, float]]:
        """Predict where the trajectory will end based on current motion."""
        if len(trajectory) < 4:
            return None

        try:
            # Fit polynomial to trajectory
            t = timestamps - timestamps[0]

            # Fit separate polynomials for x and y
            coeffs_x = np.polyfit(t, trajectory[:, 0], 2)
            coeffs_y = np.polyfit(t, trajectory[:, 1], 2)

            # Extrapolate to find where trajectory would end
            # For basketball, trajectory typically ends when y > 0.3 (near bottom of frame)
            # or after reasonable time

            # Find time when ball reaches bottom of frame (y > 0.9) or stops moving
            # This is simplified - real implementation would be more sophisticated
            predicted_time = t[-1] * 1.5  # Extend 50% beyond observed

            predicted_x = np.polyval(coeffs_x, predicted_time)
            predicted_y = np.polyval(coeffs_y, predicted_time)

            # Clamp to reasonable bounds
            predicted_x = max(0.0, min(1.0, predicted_x))
            predicted_y = max(0.0, min(1.0, predicted_y))

            return (predicted_x, predicted_y)
        except Exception as e:
            print(f"[BasketballAnalysis] Trajectory prediction error: {e}")
            return None

    def _classify_shot_type(
        self,
        shot_attempt: Dict[str, Any],
        distance_to_hoop: Optional[float]
    ) -> str:
        """Classify the type of basketball shot."""
        positions = shot_attempt["positions"]

        if not positions:
            return "unknown"

        # Check trajectory shape
        if shot_attempt.get("is_parabolic", False):
            # Parabolic trajectory suggests jump shot
            if distance_to_hoop is not None:
                if distance_to_hoop > 0.25:  # Far from hoop
                    return "three_point"
                elif distance_to_hoop > 0.15:
                    return "mid_range"
                else:
                    return "layup"
            else:
                return "jump_shot"
        else:
            # Non-parabolic might be layup or close shot
            return "close_shot"

    def _extract_missed_shots(
        self,
        basketball_analysis: List[BasketballShotResult]
    ) -> List[Dict[str, Any]]:
        """Extract missed shots as invalid segments for editing."""
        missed_shots = []

        for shot in basketball_analysis:
            if shot.shot_result == "miss" and shot.confidence > 0.5:
                # Extend segment slightly for better editing
                start_time = max(0, shot.start_time - 0.3)  # 0.3s before
                end_time = shot.end_time + 0.5  # 0.5s after (follow-through)

                missed_shots.append({
                    "time_range": [start_time, end_time],
                    "reason": f"missed_basketball_shot ({shot.shot_type})",
                    "clip_priority": 0,  # Low priority - should be removed
                    "confidence": shot.confidence,
                    "shot_details": {
                        "shot_type": shot.shot_type,
                        "duration": shot.duration,
                        "distance_to_hoop": shot.distance_to_hoop,
                    }
                })

                print(f"[BasketballAnalysis] Marked missed shot: {start_time:.2f}-{end_time:.2f}s")

        return missed_shots


# Example usage
if __name__ == "__main__":
    # Example configuration
    config = VideoAnalysisConfig(
        sampling_rate=2.0,
        max_frames=100,
        include_ocr_text=True,
        include_shot_boundaries=True,
    )

    # This would be called by LTX backend
    print("VideoAnalysisPipeline module loaded successfully")