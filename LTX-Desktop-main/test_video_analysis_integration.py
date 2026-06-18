#!/usr/bin/env python3
"""Test video analysis integration in LTX-Desktop-main."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

def test_imports():
    """Test that all necessary components can be imported."""
    print("=== Testing Imports ===")

    try:
        from api_types import VideoAnalysisRequest, VideoAnalysisResponse
        print("[OK] api_types models imported")
    except ImportError as e:
        print(f"[ERROR] Failed to import api_types: {e}")
        return False

    try:
        from services.video_analysis_pipeline.video_analysis_pipeline import VideoAnalysisPipeline
        print("[OK] VideoAnalysisPipeline imported")
    except ImportError as e:
        print(f"[ERROR] Failed to import VideoAnalysisPipeline: {e}")
        return False

    try:
        from handlers.video_analysis_handler import VideoAnalysisHandler
        print("[OK] VideoAnalysisHandler imported")
    except ImportError as e:
        print(f"[ERROR] Failed to import VideoAnalysisHandler: {e}")
        return False

    try:
        from _routes.video_analysis import router
        print("[OK] video_analysis router imported")
    except ImportError as e:
        print(f"[ERROR] Failed to import video_analysis router: {e}")
        return False

    return True

def test_model_types():
    """Test that ModelFileType includes new video analysis models."""
    print("\n=== Testing ModelFileType ===")

    from api_types import ModelFileType
    from typing import get_args

    # Get all literal values
    model_types = get_args(ModelFileType)
    print(f"ModelFileType values: {model_types}")

    required_types = {"object_detector", "scene_processor", "ocr_processor"}
    missing = required_types - set(model_types)

    if missing:
        print(f"[ERROR] Missing ModelFileType values: {missing}")
        return False
    else:
        print("[OK] All video analysis model types present")
        return True

def test_model_specs():
    """Test that model download specs include new models."""
    print("\n=== Testing Model Download Specs ===")

    try:
        from runtime_config.model_download_specs import DEFAULT_MODEL_DOWNLOAD_SPECS

        required_keys = {"object_detector", "scene_processor", "ocr_processor"}
        missing = required_keys - set(DEFAULT_MODEL_DOWNLOAD_SPECS.keys())

        if missing:
            print(f"[ERROR] Missing model download specs: {missing}")
            return False
        else:
            print("[OK] All video analysis model specs present")

            # Print model info
            for key in required_keys:
                spec = DEFAULT_MODEL_DOWNLOAD_SPECS[key]
                print(f"  {key}: {spec.repo_id} ({spec.description})")
            return True

    except ImportError as e:
        print(f"[ERROR] Failed to import model_download_specs: {e}")
        return False

def test_pipeline_creation():
    """Test that pipeline can be created (without actual models)."""
    print("\n=== Testing Pipeline Creation ===")

    try:
        import torch
        from services.video_analysis_pipeline.video_analysis_pipeline import (
            VideoAnalysisPipeline, VideoAnalysisConfig
        )

        device = torch.device("cpu")
        config = VideoAnalysisConfig(sampling_rate=1.0, max_frames=5)

        # Try to create pipeline with dummy paths
        pipeline = VideoAnalysisPipeline.create(
            object_detector_path="dummy.pt",
            scene_processor_path="dummy",
            ocr_processor_path="dummy",
            device=device,
            config=config,
        )

        print("[OK] Pipeline created successfully")
        print(f"  Device: {device}")
        print(f"  Dependencies available: {pipeline._dependencies_available}")

        return True

    except Exception as e:
        print(f"[ERROR] Failed to create pipeline: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Run all tests."""
    print("Video Analysis Integration Test")
    print("=" * 50)

    all_passed = True

    # Run tests
    if not test_imports():
        all_passed = False

    if not test_model_types():
        all_passed = False

    if not test_model_specs():
        all_passed = False

    if not test_pipeline_creation():
        all_passed = False

    print("\n" + "=" * 50)
    if all_passed:
        print("[OK] All integration tests passed!")
        print("\nNext steps:")
        print("1. Install optional dependencies: pip install ultralytics transformers paddlepaddle paddleocr")
        print("2. Download models via LTX UI or API")
        print("3. Test with actual video: POST /api/analyze/video")
    else:
        print("[ERROR] Some tests failed. Please check the errors above.")
        sys.exit(1)

if __name__ == "__main__":
    main()