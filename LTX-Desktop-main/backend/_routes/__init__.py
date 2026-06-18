"""
LTX Desktop API routes.
"""

from .generation import router as generation_router
from .health import router as health_router
from .ic_lora import router as ic_lora_router
from .image_gen import router as image_gen_router
from .models import router as models_router
from .retake import router as retake_router
from .runtime_policy import router as runtime_policy_router
from .settings import router as settings_router
from .suggest_gap_prompt import router as suggest_gap_prompt_router
from .editing import router as editing_router  # New video editing routes

__all__ = [
    "generation_router",
    "health_router",
    "ic_lora_router",
    "image_gen_router",
    "models_router",
    "retake_router",
    "runtime_policy_router",
    "settings_router",
    "suggest_gap_prompt_router",
    "editing_router",
]
