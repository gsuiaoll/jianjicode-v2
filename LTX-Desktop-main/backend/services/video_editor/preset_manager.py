"""
Preset manager for video editing templates.
Based on jianjicode's preset systems (color grading, subtitle templates, effect templates).
"""

from __future__ import annotations

import json
import os
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any, TypedDict
from dataclasses import dataclass, asdict
import uuid

logger = logging.getLogger(__name__)


# ============================================================================
# Type Definitions (compatible with LTX frontend types)
# ============================================================================


class ColorCorrection(TypedDict):
    """Color correction parameters."""
    brightness: float   # -100 to 100
    contrast: float     # -100 to 100
    saturation: float   # -100 to 100
    temperature: float  # -100 to 100 (negative = cooler/blue, positive = warmer/orange)
    tint: float         # -100 to 100 (negative = green, positive = magenta)
    exposure: float     # -100 to 100
    highlights: float   # -100 to 100
    shadows: float      # -100 to 100


DEFAULT_COLOR_CORRECTION: ColorCorrection = {
    "brightness": 0,
    "contrast": 0,
    "saturation": 0,
    "temperature": 0,
    "tint": 0,
    "exposure": 0,
    "highlights": 0,
    "shadows": 0,
}


@dataclass
class ColorGradingPreset:
    """Color grading preset definition."""
    id: str
    name: str
    description: str
    category: str  # 'film', 'cinematic', 'vintage', 'modern', 'warm', 'cool', 'dramatic', 'pastel', 'monochrome', 'custom'
    color_correction: ColorCorrection
    tags: List[str]
    author: str = "LTX"
    created: str = ""
    version: str = "1.0"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return asdict(self)


@dataclass
class SubtitleStyle:
    """Subtitle style definition."""
    font_size: int = 32
    font_family: str = "sans-serif"
    font_weight: str = "normal"  # 'normal' | 'bold'
    color: str = "#FFFFFF"
    background_color: str = "transparent"
    position: str = "bottom"  # 'bottom' | 'top' | 'center'
    italic: bool = False


@dataclass
class SubtitleTemplate:
    """Subtitle template definition."""
    id: str
    name: str
    description: str
    category: str  # 'film', 'social', 'news', 'corporate', 'creative', 'minimal', 'animated'
    style: SubtitleStyle
    tags: List[str]
    author: str = "LTX"
    created: str = ""
    version: str = "1.0"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return asdict(self)


@dataclass
class EffectDefinition:
    """Single effect definition."""
    type: str  # 'blur', 'sharpen', 'glow', 'vignette', 'grain', 'lut-cinematic', etc.
    amount: Optional[float] = None  # 0-100
    radius: Optional[float] = None  # 0-50 (for glow)
    intensity: Optional[float] = None  # 0-100 (for LUT)
    order: int = 1  # Application order


@dataclass
class EffectTemplate:
    """Effect template (multiple effects combined)."""
    id: str
    name: str
    description: str
    category: str  # 'cinematic', 'vintage', 'modern', 'artistic', 'social', 'experimental', 'custom'
    effects: List[EffectDefinition]
    tags: List[str]
    author: str = "LTX"
    created: str = ""
    version: str = "1.0"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return asdict(self)


# ============================================================================
# Preset Libraries (based on jianjicode presets)
# ============================================================================


# Color grading presets (based on jianjicode's PRESET_COLOR_GRADING)
PRESET_COLOR_GRADING: List[ColorGradingPreset] = [
    ColorGradingPreset(
        id="film_cinematic",
        name="电影感",
        description="电影感调色，增强对比度和饱和度，略微偏暖",
        category="film",
        color_correction={
            "brightness": 5,
            "contrast": 15,
            "saturation": 10,
            "temperature": 8,
            "tint": -2,
            "exposure": 3,
            "highlights": -10,
            "shadows": 5,
        },
        tags=["cinematic", "movie", "film"]
    ),
    ColorGradingPreset(
        id="film_teal_orange",
        name="青橙色调",
        description="好莱坞流行的青橙色调，增强冷暖对比",
        category="film",
        color_correction={
            "brightness": 0,
            "contrast": 20,
            "saturation": 15,
            "temperature": 10,
            "tint": -15,
            "exposure": 5,
            "highlights": -5,
            "shadows": 8,
        },
        tags=["teal-orange", "hollywood", "color-grading"]
    ),
    ColorGradingPreset(
        id="vintage_70s",
        name="70年代复古",
        description="70年代复古色调，暖黄色调，降低饱和度",
        category="vintage",
        color_correction={
            "brightness": -5,
            "contrast": 5,
            "saturation": -20,
            "temperature": 25,
            "tint": 5,
            "exposure": -3,
            "highlights": -15,
            "shadows": 10,
        },
        tags=["vintage", "retro", "70s"]
    ),
    ColorGradingPreset(
        id="modern_clean",
        name="现代清新",
        description="现代清新色调，色彩鲜明，高对比度",
        category="modern",
        color_correction={
            "brightness": 10,
            "contrast": 25,
            "saturation": 20,
            "temperature": 5,
            "tint": 0,
            "exposure": 8,
            "highlights": -8,
            "shadows": 12,
        },
        tags=["modern", "clean", "vibrant"]
    ),
    ColorGradingPreset(
        id="warm_sunset",
        name="温暖日落",
        description="温暖日落色调，橙色和金色调",
        category="warm",
        color_correction={
            "brightness": 8,
            "contrast": 15,
            "saturation": 12,
            "temperature": 35,
            "tint": 8,
            "exposure": 10,
            "highlights": -5,
            "shadows": 10,
        },
        tags=["warm", "sunset", "golden-hour"]
    ),
    ColorGradingPreset(
        id="cool_icy",
        name="冰冷色调",
        description="冰冷蓝色调，适合冬季或科技感视频",
        category="cool",
        color_correction={
            "brightness": 10,
            "contrast": 20,
            "saturation": 5,
            "temperature": -30,
            "tint": -5,
            "exposure": 5,
            "highlights": -10,
            "shadows": 5,
        },
        tags=["cool", "icy", "blue", "tech"]
    ),
    ColorGradingPreset(
        id="monochrome_bw",
        name="黑白经典",
        description="经典黑白调色，完全去色",
        category="monochrome",
        color_correction={
            "brightness": 5,
            "contrast": 25,
            "saturation": -100,
            "temperature": 0,
            "tint": 0,
            "exposure": 0,
            "highlights": -15,
            "shadows": 10,
        },
        tags=["black-white", "monochrome", "classic"]
    ),
]


# Subtitle templates (simplified version)
PRESET_SUBTITLE_TEMPLATES: List[SubtitleTemplate] = [
    SubtitleTemplate(
        id="film_classic",
        name="经典电影",
        description="传统电影字幕样式，白色字体，黑色边框，底部居中",
        category="film",
        style=SubtitleStyle(
            font_size=32,
            font_family="Arial",
            font_weight="bold",
            color="#FFFFFF",
            background_color="transparent",
            position="bottom",
            italic=False
        ),
        tags=["movie", "cinematic", "classic"]
    ),
    SubtitleTemplate(
        id="social_bold",
        name="社交媒体粗体",
        description="适合短视频平台的醒目字幕",
        category="social",
        style=SubtitleStyle(
            font_size=36,
            font_family="Impact",
            font_weight="bold",
            color="#FFFFFF",
            background_color="#00000080",
            position="bottom",
            italic=False
        ),
        tags=["social", "bold", "captions"]
    ),
    SubtitleTemplate(
        id="news_elegant",
        name="新闻优雅",
        description="新闻风格字幕，专业优雅",
        category="news",
        style=SubtitleStyle(
            font_size=30,
            font_family="Georgia",
            font_weight="normal",
            color="#FFFFFF",
            background_color="#00000060",
            position="bottom",
            italic=True
        ),
        tags=["news", "elegant", "professional"]
    ),
]


# Effect templates (simplified version)
PRESET_EFFECT_TEMPLATES: List[EffectTemplate] = [
    EffectTemplate(
        id="cinematic_film_look",
        name="电影感效果",
        description="经典电影感效果：颗粒 + 暗角 + 电影LUT",
        category="cinematic",
        effects=[
            EffectDefinition(type="grain", amount=30, order=1),
            EffectDefinition(type="vignette", amount=40, order=2),
            EffectDefinition(type="lut-cinematic", intensity=80, order=3)
        ],
        tags=["cinematic", "film", "movie", "grain", "vignette"]
    ),
    EffectTemplate(
        id="vintage_retro",
        name="复古风格",
        description="复古胶片效果：颗粒 + 复古LUT + 轻微暗角",
        category="vintage",
        effects=[
            EffectDefinition(type="grain", amount=50, order=1),
            EffectDefinition(type="lut-vintage", intensity=90, order=2),
            EffectDefinition(type="vignette", amount=30, order=3)
        ],
        tags=["vintage", "retro", "film", "grain"]
    ),
    EffectTemplate(
        id="modern_clean",
        name="现代清新",
        description="现代清新效果：轻微锐化 + 冷色调LUT",
        category="modern",
        effects=[
            EffectDefinition(type="sharpen", amount=30, order=1),
            EffectDefinition(type="lut-cool", intensity=60, order=2)
        ],
        tags=["modern", "clean", "sharp", "cool"]
    ),
]


# ============================================================================
# Preset Manager
# ============================================================================


class PresetManager:
    """Manage and apply presets for video editing."""

    def __init__(self):
        self.color_presets = {p.id: p for p in PRESET_COLOR_GRADING}
        self.subtitle_templates = {t.id: t for t in PRESET_SUBTITLE_TEMPLATES}
        self.effect_templates = {t.id: t for t in PRESET_EFFECT_TEMPLATES}

        # User custom presets storage directory
        self.preset_dir = Path.home() / ".ltx" / "presets"
        self.preset_dir.mkdir(parents=True, exist_ok=True)

    # Color grading presets
    def list_color_presets(self, category: Optional[str] = None) -> List[Dict[str, Any]]:
        """List color grading presets, optionally filtered by category."""
        presets = list(self.color_presets.values())
        if category:
            presets = [p for p in presets if p.category == category]
        return [p.to_dict() for p in presets]

    def get_color_preset(self, preset_id: str) -> Optional[ColorGradingPreset]:
        """Get color grading preset by ID."""
        return self.color_presets.get(preset_id)

    def apply_color_preset(self, preset_id: str, strength: float = 100.0) -> ColorCorrection:
        """
        Apply color preset with adjustable strength.

        Args:
            preset_id: Preset ID
            strength: Application strength (0-100%)

        Returns:
            ColorCorrection dictionary with applied strength
        """
        preset = self.get_color_preset(preset_id)
        if not preset:
            raise ValueError(f"Color preset not found: {preset_id}")

        factor = strength / 100.0
        correction = preset.color_correction.copy()

        # Apply strength factor to all parameters
        for key in correction:
            correction[key] = correction[key] * factor

        return correction

    def create_color_preset(self, name: str, description: str, category: str,
                           color_correction: ColorCorrection,
                           tags: List[str]) -> ColorGradingPreset:
        """Create custom color grading preset."""
        preset_id = f"custom_{uuid.uuid4().hex[:8]}"
        preset = ColorGradingPreset(
            id=preset_id,
            name=name,
            description=description,
            category=category,
            color_correction=color_correction,
            tags=tags,
            author="user",
            created=self._current_timestamp()
        )

        self.color_presets[preset_id] = preset
        self._save_custom_preset("color", preset_id, preset.to_dict())

        return preset

    # Subtitle templates
    def list_subtitle_templates(self, category: Optional[str] = None) -> List[Dict[str, Any]]:
        """List subtitle templates, optionally filtered by category."""
        templates = list(self.subtitle_templates.values())
        if category:
            templates = [t for t in templates if t.category == category]
        return [t.to_dict() for t in templates]

    def get_subtitle_template(self, template_id: str) -> Optional[SubtitleTemplate]:
        """Get subtitle template by ID."""
        return self.subtitle_templates.get(template_id)

    # Effect templates
    def list_effect_templates(self, category: Optional[str] = None) -> List[Dict[str, Any]]:
        """List effect templates, optionally filtered by category."""
        templates = list(self.effect_templates.values())
        if category:
            templates = [t for t in templates if t.category == category]
        return [t.to_dict() for t in templates]

    def get_effect_template(self, template_id: str) -> Optional[EffectTemplate]:
        """Get effect template by ID."""
        return self.effect_templates.get(template_id)

    # Helper methods
    def _current_timestamp(self) -> str:
        """Get current timestamp in ISO format."""
        from datetime import datetime
        return datetime.now().isoformat()

    def _save_custom_preset(self, preset_type: str, preset_id: str, data: Dict[str, Any]):
        """Save custom preset to file."""
        preset_file = self.preset_dir / f"{preset_type}_{preset_id}.json"
        with open(preset_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def _load_custom_presets(self):
        """Load custom presets from files."""
        # Implementation for loading custom presets
        pass


# Global instance
_preset_manager: Optional[PresetManager] = None


def get_preset_manager() -> PresetManager:
    """Get or create global PresetManager instance."""
    global _preset_manager
    if _preset_manager is None:
        _preset_manager = PresetManager()
    return _preset_manager