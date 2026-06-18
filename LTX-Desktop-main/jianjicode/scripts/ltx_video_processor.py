#!/usr/bin/env python3
"""
LTX Video Processor Python Bridge
调用 LTX 的 VideoProcessor 服务功能
"""

import sys
import json
import argparse
import traceback
from pathlib import Path
from typing import Optional, Dict, Any

def get_video_info(video_path: str) -> Dict[str, Any]:
    """使用 OpenCV 获取视频基本信息"""
    try:
        import cv2

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return {"error": f"无法打开视频文件: {video_path}"}

        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = frame_count / fps if fps > 0 else 0

        cap.release()

        return {
            "success": True,
            "fps": float(fps),
            "frame_count": frame_count,
            "width": width,
            "height": height,
            "duration": float(duration),
            "resolution": f"{width}x{height}",
            "aspect_ratio": f"{width}:{height}" if width > 0 and height > 0 else "unknown"
        }
    except ImportError:
        return {"error": "OpenCV 未安装，请运行: pip install opencv-python"}
    except Exception as e:
        return {"error": f"获取视频信息时出错: {str(e)}"}

def apply_canny_edge_detection(video_path: str, output_path: str,
                               threshold1: int = 100, threshold2: int = 200) -> Dict[str, Any]:
    """应用 Canny 边缘检测到视频"""
    try:
        import cv2
        import numpy as np

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return {"error": f"无法打开视频文件: {video_path}"}

        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # 创建视频写入器
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # 转换为灰度图
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

            # 应用 Canny 边缘检测
            edges = cv2.Canny(gray, threshold1, threshold2)

            # 将单通道转换为三通道（为了输出视频）
            edges_3ch = np.stack([edges] * 3, axis=2)

            out.write(edges_3ch)
            frame_idx += 1

        cap.release()
        out.release()

        return {
            "success": True,
            "output_path": output_path,
            "frame_count": frame_idx,
            "threshold1": threshold1,
            "threshold2": threshold2
        }
    except Exception as e:
        return {"error": f"Canny 边缘检测时出错: {str(e)}"}

def extract_frames(video_path: str, output_dir: str,
                  frame_rate: float = 1.0, max_frames: int = 10,
                  quality: int = 85) -> Dict[str, Any]:
    """从视频中提取帧"""
    try:
        import cv2

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return {"error": f"无法打开视频文件: {video_path}"}

        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_interval = int(fps / frame_rate) if fps > 0 else 1

        Path(output_dir).mkdir(parents=True, exist_ok=True)

        frame_idx = 0
        saved_frames = 0
        frame_paths = []

        while saved_frames < max_frames:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % frame_interval == 0:
                frame_filename = f"frame_{saved_frames:04d}.jpg"
                frame_path = Path(output_dir) / frame_filename

                cv2.imwrite(str(frame_path), frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
                frame_paths.append(str(frame_path))
                saved_frames += 1

            frame_idx += 1

        cap.release()

        return {
            "success": True,
            "frame_count": saved_frames,
            "frame_paths": frame_paths,
            "output_dir": output_dir,
            "frame_rate": frame_rate,
            "max_frames": max_frames
        }
    except Exception as e:
        return {"error": f"提取帧时出错: {str(e)}"}

def detect_scene_changes(video_path: str, threshold: float = 30.0) -> Dict[str, Any]:
    """检测场景变化"""
    try:
        import cv2
        import numpy as np

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return {"error": f"无法打开视频文件: {video_path}"}

        fps = cap.get(cv2.CAP_PROP_FPS)

        prev_frame = None
        scene_changes = []
        frame_idx = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # 转换为灰度图
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

            if prev_frame is not None:
                # 计算帧差异
                diff = cv2.absdiff(prev_frame, gray)
                mean_diff = np.mean(diff)

                if mean_diff > threshold:
                    scene_changes.append({
                        "frame": frame_idx,
                        "time": frame_idx / fps if fps > 0 else 0,
                        "diff_score": float(mean_diff)
                    })

            prev_frame = gray
            frame_idx += 1

        cap.release()

        return {
            "success": True,
            "scene_changes": scene_changes,
            "total_frames": frame_idx,
            "threshold": threshold,
            "change_count": len(scene_changes)
        }
    except Exception as e:
        return {"error": f"检测场景变化时出错: {str(e)}"}

def main():
    parser = argparse.ArgumentParser(description="LTX Video Processor Python Bridge")
    parser.add_argument("--operation", required=True,
                       choices=["get_info", "canny", "extract_frames", "detect_scenes"],
                       help="要执行的操作")
    parser.add_argument("--input", required=True, help="输入视频文件路径")
    parser.add_argument("--output", help="输出文件或目录路径")
    parser.add_argument("--threshold1", type=int, default=100, help="Canny阈值1")
    parser.add_argument("--threshold2", type=int, default=200, help="Canny阈值2")
    parser.add_argument("--frame_rate", type=float, default=1.0, help="帧提取率（帧/秒）")
    parser.add_argument("--max_frames", type=int, default=10, help="最大提取帧数")
    parser.add_argument("--scene_threshold", type=float, default=30.0, help="场景检测阈值")
    parser.add_argument("--quality", type=int, default=85, help="JPEG质量（1-100）")

    args = parser.parse_args()

    try:
        if args.operation == "get_info":
            result = get_video_info(args.input)

        elif args.operation == "canny":
            if not args.output:
                print(json.dumps({"error": "Canny操作需要输出路径"}))
                sys.exit(1)
            result = apply_canny_edge_detection(
                args.input, args.output,
                args.threshold1, args.threshold2
            )

        elif args.operation == "extract_frames":
            if not args.output:
                print(json.dumps({"error": "提取帧操作需要输出目录"}))
                sys.exit(1)
            result = extract_frames(
                args.input, args.output,
                args.frame_rate, args.max_frames,
                args.quality
            )

        elif args.operation == "detect_scenes":
            result = detect_scene_changes(args.input, args.scene_threshold)

        else:
            result = {"error": f"未知操作: {args.operation}"}

        print(json.dumps(result, indent=2))

    except Exception as e:
        error_result = {
            "error": f"处理过程中出错: {str(e)}",
            "traceback": traceback.format_exc()
        }
        print(json.dumps(error_result, indent=2))
        sys.exit(1)

if __name__ == "__main__":
    main()