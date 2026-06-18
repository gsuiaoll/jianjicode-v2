"""Pydantic request/response models and TypedDicts for ltx2_server."""

from __future__ import annotations

from typing import Any, Literal, NamedTuple, TypedDict, Union, Optional, List, Dict, Set
from typing import Annotated
from typing_extensions import TypeAlias

from pydantic import BaseModel, Field, StringConstraints

NonEmptyPrompt = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
ModelFileType = Literal[
    "checkpoint",
    "upsampler",
    "distilled_lora",
    "ic_lora",
    "depth_processor",
    "person_detector",
    "pose_processor",
    "text_encoder",
    "zit",
    "object_detector",
    "scene_processor",
    "ocr_processor",
]


class ImageConditioningInput(NamedTuple):
    """Image conditioning triplet used by all video pipelines."""

    path: str
    frame_idx: int
    strength: float


# ============================================================
# TypedDicts for module-level state globals
# ============================================================


class GenerationState(TypedDict):
    id: Optional[str]
    cancelled: bool
    result: Optional[Union[str, List[str]]]
    error: Optional[str]
    status: str  # "idle" | "running" | "complete" | "cancelled" | "error"
    phase: str
    progress: int
    current_step: int
    total_steps: int


JsonObject: TypeAlias = dict[str, object]
VideoCameraMotion = Literal[
    "none",
    "dolly_in",
    "dolly_out",
    "dolly_left",
    "dolly_right",
    "jib_up",
    "jib_down",
    "static",
    "focus_shift",
]


# ============================================================
# Response Models
# ============================================================


class ModelStatusItem(BaseModel):
    id: str
    name: str
    loaded: bool
    downloaded: bool


class GpuTelemetry(BaseModel):
    name: str
    vram: int
    vramUsed: int


class HealthResponse(BaseModel):
    status: str
    models_loaded: bool
    active_model: Optional[str]
    gpu_info: GpuTelemetry
    sage_attention: bool
    models_status: List[ModelStatusItem]


class GpuInfoResponse(BaseModel):
    cuda_available: bool
    mps_available: bool = False
    gpu_available: bool = False
    gpu_name: Optional[str]
    vram_gb: Optional[int]
    gpu_info: GpuTelemetry


class RuntimePolicyResponse(BaseModel):
    force_api_generations: bool


class GenerationProgressResponse(BaseModel):
    status: str
    phase: str
    progress: int
    currentStep: Optional[int]
    totalSteps: Optional[int]


class ModelInfo(BaseModel):
    id: str
    name: str
    description: str


class ModelFileStatus(BaseModel):
    id: ModelFileType
    name: str
    description: str
    downloaded: bool
    size: int
    expected_size: int
    required: bool = True
    is_folder: bool = False
    optional_reason: Optional[str] = None


class TextEncoderStatus(BaseModel):
    downloaded: bool
    size_bytes: int
    size_gb: float
    expected_size_gb: float


class ModelsStatusResponse(BaseModel):
    models: list[ModelFileStatus]
    all_downloaded: bool
    total_size: int
    downloaded_size: int
    total_size_gb: float
    downloaded_size_gb: float
    models_path: str
    has_api_key: bool
    text_encoder_status: TextEncoderStatus
    use_local_text_encoder: bool


class DownloadProgressResponse(BaseModel):
    status: str
    current_downloading_file: Optional[ModelFileType]
    current_file_progress: float
    total_progress: float
    total_downloaded_bytes: int
    expected_total_bytes: int
    completed_files: Set[ModelFileType]
    all_files: Set[ModelFileType]
    error: Optional[str]
    speed_bytes_per_sec: float


class SuggestGapPromptResponse(BaseModel):
    status: str = "success"
    suggested_prompt: str


class GenerateVideoResponse(BaseModel):
    status: str
    video_path: str | None = None


class GenerateImageResponse(BaseModel):
    status: str
    image_paths: list[str] | None = None


class CancelResponse(BaseModel):
    status: str
    id: str | None = None


class RetakeResponse(BaseModel):
    status: str
    video_path: str | None = None
    result: JsonObject | None = None


class IcLoraExtractResponse(BaseModel):
    conditioning: str
    original: str
    conditioning_type: Literal["canny", "depth"]
    frame_time: float


class IcLoraGenerateResponse(BaseModel):
    status: str
    video_path: str | None = None


class ModelDownloadStartResponse(BaseModel):
    status: str
    message: str | None = None
    sessionId: str | None = None


class TextEncoderDownloadResponse(BaseModel):
    status: str
    message: str | None = None
    sessionId: str | None = None


class StatusResponse(BaseModel):
    status: str


class ErrorResponse(BaseModel):
    error: str
    message: str | None = None


# ============================================================
# Request Models
# ============================================================


class GenerateVideoRequest(BaseModel):
    prompt: NonEmptyPrompt
    resolution: str = "512p"
    model: str = "fast"
    cameraMotion: VideoCameraMotion = "none"
    negativePrompt: str = ""
    duration: str = "2"
    fps: str = "24"
    audio: str = "false"
    imagePath: str | None = None
    audioPath: str | None = None
    aspectRatio: Literal["16:9", "9:16"] = "16:9"


class GenerateImageRequest(BaseModel):
    prompt: NonEmptyPrompt
    width: int = 1024
    height: int = 1024
    numSteps: int = 4
    numImages: int = 1


def _default_model_types() -> set[ModelFileType]:
    return set()


class ModelDownloadRequest(BaseModel):
    modelTypes: set[ModelFileType] = Field(default_factory=_default_model_types)


class RequiredModelsResponse(BaseModel):
    modelTypes: list[ModelFileType]


class SuggestGapPromptRequest(BaseModel):
    beforePrompt: str = ""
    afterPrompt: str = ""
    beforeFrame: str | None = None
    afterFrame: str | None = None
    gapDuration: float = 5
    mode: str = "t2v"
    inputImage: str | None = None


class RetakeRequest(BaseModel):
    video_path: str
    start_time: float
    duration: float
    prompt: str = ""
    mode: str = "replace_audio_and_video"


class IcLoraExtractRequest(BaseModel):
    video_path: str
    conditioning_type: Literal["canny", "depth"] = "canny"
    frame_time: float = 0


class IcLoraImageInput(BaseModel):
    path: str
    frame: int = 0
    strength: float = 1.0


def _default_ic_lora_images() -> list[IcLoraImageInput]:
    return []


class IcLoraGenerateRequest(BaseModel):
    video_path: str
    conditioning_type: Literal["canny", "depth"]
    prompt: NonEmptyPrompt
    conditioning_strength: float = 1.0
    num_inference_steps: int = 30
    cfg_guidance_scale: float = 1.0
    negative_prompt: str = ""
    images: list[IcLoraImageInput] = Field(default_factory=_default_ic_lora_images)


# ============================================================
# Video Analysis Models
# ============================================================


class VideoAnalysisRequest(BaseModel):
    """Request for video analysis."""
    video_path: str
    sampling_rate: float = 2.0  # frames per second
    max_frames: int | None = None  # limit total frames analyzed
    include_bounding_boxes: bool = True
    include_scene_labels: bool = True
    include_ocr_text: bool = True
    include_shot_boundaries: bool = True
    object_confidence_threshold: float = 0.25
    scene_threshold: float = 0.5
    shot_change_threshold: float = 0.3
    ocr_language: str = "ch"  # Chinese by default


class VideoAnalysisResponse(BaseModel):
    """Response from video analysis."""
    status: str
    result: dict[str, Any] | None = None
    error: str | None = None
    analysis_time: float | None = None
