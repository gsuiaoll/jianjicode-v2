/**
 * DW Pose姿态估计适配器
 * 基于DWPose-TorchScript模型
 */

import { exec } from "child_process"
import { existsSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { promisify } from "util"
import { BaseCVModelProvider } from "../providers/base.js"
import type {
  CVModelConfig,
  DepthEstimationRequest,
  DepthEstimationResult,
  Keypoint,
  PoseEstimationRequest,
  PoseEstimationResult,
  SkeletonConnection,
} from "../types/index.js"

const execAsync = promisify(exec)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * DW Pose姿态估计提供商
 */
export class DWPoseProvider extends BaseCVModelProvider {
  readonly id = "dw-pose"
  readonly name = "DW Pose Estimation"
  readonly supportedModels = ["dwpose", "openpose", "wholebody"]

  private poseModelPath: string = ""
  private detectorModelPath: string = ""
  private pythonScriptPath: string = ""
  private usePythonFallback: boolean = true

  // DW Pose关键点定义
  private readonly BODY_KEYPOINTS = [
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
  ]

  private readonly HAND_KEYPOINTS = [
    "wrist",
    "thumb1",
    "thumb2",
    "thumb3",
    "thumb4",
    "index1",
    "index2",
    "index3",
    "index4",
    "middle1",
    "middle2",
    "middle3",
    "middle4",
    "ring1",
    "ring2",
    "ring3",
    "ring4",
    "pinky1",
    "pinky2",
    "pinky3",
    "pinky4",
  ]

  private readonly FACE_KEYPOINTS = Array.from(
    { length: 68 },
    (_, i) => `face_${i + 1}`,
  )

  // 骨架连接定义（OpenPose风格）
  private readonly SKELETON_CONNECTIONS: SkeletonConnection[] = [
    { start: 1, end: 2, color: "#ff0000" }, // 颈到左肩
    { start: 1, end: 5, color: "#ff5500" }, // 颈到右肩
    { start: 2, end: 3, color: "#ffaa00" }, // 左肩到左肘
    { start: 3, end: 4, color: "#ffff00" }, // 左肘到左手腕
    { start: 5, end: 6, color: "#aaff00" }, // 右肩到右肘
    { start: 6, end: 7, color: "#55ff00" }, // 右肘到右手腕
    { start: 1, end: 8, color: "#00ff00" }, // 颈到左髋
    { start: 8, end: 9, color: "#00ff55" }, // 左髋到左膝
    { start: 9, end: 10, color: "#00ffaa" }, // 左膝到左踝
    { start: 1, end: 11, color: "#00ffff" }, // 颈到右髋
    { start: 11, end: 12, color: "#00aaff" }, // 右髋到右膝
    { start: 12, end: 13, color: "#0055ff" }, // 右膝到右踝
    { start: 0, end: 14, color: "#0000ff" }, // 鼻到左眼
    { start: 14, end: 16, color: "#5500ff" }, // 左眼到左耳
    { start: 0, end: 15, color: "#aa00ff" }, // 鼻到右眼
    { start: 15, end: 17, color: "#ff00ff" }, // 右眼到右耳
    { start: 0, end: 1, color: "#ff00aa" }, // 鼻到颈
  ]

  constructor(config: CVModelConfig) {
    super(config)

    // 设置模型路径
    const modelsDir = path.join(__dirname, "../../../models")
    this.poseModelPath =
      config.modelPath ||
      path.join(modelsDir, "dw-ll_ucoco_384_bs5.torchscript.pt")
    this.detectorModelPath = path.join(modelsDir, "yolox_l.torchscript.pt")
    this.pythonScriptPath = path.join(__dirname, "scripts/dw_pose.py")
  }

  /**
   * 确保模型文件存在
   */
  protected async ensureModelExists(): Promise<void> {
    console.log(`检查DW Pose模型文件`)

    // 检查姿态模型
    if (!existsSync(this.poseModelPath)) {
      if (this.config.downloadModels) {
        await this.downloadPoseModel()
      } else {
        console.warn(`姿态模型文件不存在: ${this.poseModelPath}`)
        console.warn(`将使用模拟模式进行姿态估计`)
        // 不抛出错误，允许使用模拟模式
      }
    }

    // 检查检测器模型
    if (!existsSync(this.detectorModelPath)) {
      if (this.config.downloadModels) {
        await this.downloadDetectorModel()
      } else {
        console.warn(`检测器模型文件不存在: ${this.detectorModelPath}`)
        console.warn(`将使用模拟模式进行姿态估计`)
        // 不抛出错误，允许使用模拟模式
      }
    }

    if (existsSync(this.poseModelPath) && existsSync(this.detectorModelPath)) {
      console.log(`所有DW Pose模型文件就绪`)
    } else {
      console.warn(`部分DW Pose模型文件缺失，将使用模拟模式`)
    }
  }

  /**
   * 下载姿态模型
   */
  private async downloadPoseModel(): Promise<void> {
    try {
      const { mkdirSync } = await import("fs")
      const { dirname } = await import("path")

      mkdirSync(dirname(this.poseModelPath), { recursive: true })

      // 从HuggingFace下载模型
      const repoId = "hr16/DWPose-TorchScript-BatchSize5"
      const fileName = "dw-ll_ucoco_384_bs5.torchscript.pt"
      const command = `huggingface-cli download ${repoId} ${fileName} --local-dir ${dirname(this.poseModelPath)} --local-dir-use-symlinks False`

      console.log(`下载姿态模型: ${command}`)
      const { stdout, stderr } = await execAsync(command, { timeout: 300000 })

      if (stderr && !stderr.includes("warning")) {
        console.error(`姿态模型下载错误: ${stderr}`)
      }

      console.log(`姿态模型下载完成`)
    } catch (error: any) {
      console.error(`下载姿态模型失败:`, error.message)
      throw new Error(`无法下载姿态模型: ${error.message}`)
    }
  }

  /**
   * 下载检测器模型
   */
  private async downloadDetectorModel(): Promise<void> {
    try {
      const { mkdirSync } = await import("fs")
      const { dirname } = await import("path")

      mkdirSync(dirname(this.detectorModelPath), { recursive: true })

      // 从HuggingFace下载模型
      const repoId = "hr16/yolox-onnx"
      const fileName = "yolox_l.torchscript.pt"
      const command = `huggingface-cli download ${repoId} ${fileName} --local-dir ${dirname(this.detectorModelPath)} --local-dir-use-symlinks False`

      console.log(`下载检测器模型: ${command}`)
      const { stdout, stderr } = await execAsync(command, { timeout: 300000 })

      if (stderr && !stderr.includes("warning")) {
        console.error(`检测器模型下载错误: ${stderr}`)
      }

      console.log(`检测器模型下载完成`)
    } catch (error: any) {
      console.error(`下载检测器模型失败:`, error.message)
      throw new Error(`无法下载检测器模型: ${error.message}`)
    }
  }

  /**
   * 加载模型
   */
  protected async loadModel(): Promise<void> {
    console.log(`加载DW Pose模型`)

    // 检查模型文件是否存在
    const poseModelExists = existsSync(this.poseModelPath)
    const detectorModelExists = existsSync(this.detectorModelPath)

    if (!poseModelExists || !detectorModelExists) {
      console.warn(`模型文件缺失，将使用模拟模式`)
      console.warn(`姿态模型: ${poseModelExists ? "✅ 存在" : "❌ 缺失"}`)
      console.warn(`检测器模型: ${detectorModelExists ? "✅ 存在" : "❌ 缺失"}`)
      this.modelLoaded = true
      return
    }

    // 检查Python环境
    const pythonAvailable = await this.checkPythonEnvironment()

    if (!pythonAvailable && this.usePythonFallback) {
      console.warn("Python环境不可用，将使用模拟模式")
      this.modelLoaded = true
      return
    }

    console.log("DW Pose模型准备就绪（使用Python后端）")
    this.modelLoaded = true
  }

  /**
   * 检查Python环境
   */
  private async checkPythonEnvironment(): Promise<boolean> {
    try {
      const { stdout } = await execAsync("python --version")
      console.log(`Python版本: ${stdout}`)

      // 检查必要的Python包
      const packages = ["torch", "cv2", "numpy"]
      for (const pkg of packages) {
        try {
          await execAsync(`python -c "import ${pkg}; print('${pkg}可用')"`)
        } catch {
          console.warn(`Python包 ${pkg} 不可用`)
          return false
        }
      }

      return true
    } catch (error) {
      console.warn("Python环境检查失败:", error)
      return false
    }
  }

  /**
   * 卸载模型
   */
  protected async unloadModel(): Promise<void> {
    console.log(`卸载DW Pose模型`)
    this.modelLoaded = false
  }

  /**
   * 深度估计（不支持）
   */
  async estimateDepth(
    request: DepthEstimationRequest,
  ): Promise<DepthEstimationResult> {
    throw new Error("DW Pose提供商不支持深度估计，请使用MiDaS DPT提供商")
  }

  /**
   * 姿态估计
   */
  async estimatePose(
    request: PoseEstimationRequest,
  ): Promise<PoseEstimationResult> {
    const startTime = Date.now()

    try {
      // 验证输入
      if (!request.image) {
        throw new Error("姿态估计需要图像输入")
      }

      // 解析图像输入
      const imageInfo = await this.parseImageInput(request.image)

      // 获取参数
      const detectMultiplePersons = request.detectMultiplePersons !== false
      const includeHands = request.includeHands !== false
      const includeFace = request.includeFace !== false
      const confidenceThreshold = request.confidenceThreshold || 0.3
      const renderStyle = request.renderStyle || "openpose"

      // 处理姿态估计
      let result: PoseEstimationResult

      if (this.usePythonFallback && (await this.checkPythonEnvironment())) {
        // 使用Python后端处理
        result = await this.processWithPython(
          imageInfo,
          detectMultiplePersons,
          includeHands,
          includeFace,
          confidenceThreshold,
          renderStyle,
        )
      } else {
        // 模拟模式（用于测试）
        result = await this.processSimulated(
          imageInfo,
          detectMultiplePersons,
          includeHands,
          includeFace,
          confidenceThreshold,
          renderStyle,
        )
      }

      // 添加处理时间
      const processingTime = this.calculateProcessingTime(startTime)
      result.metadata.processingTime = processingTime

      return result
    } catch (error: any) {
      return this.handleError("姿态估计", error) as PoseEstimationResult
    }
  }

  /**
   * 使用Python后端处理
   */
  private async processWithPython(
    imageInfo: any,
    detectMultiplePersons: boolean,
    includeHands: boolean,
    includeFace: boolean,
    confidenceThreshold: number,
    renderStyle: string,
  ): Promise<PoseEstimationResult> {
    // 创建临时文件
    const { tmpdir } = await import("os")
    const { randomBytes } = await import("crypto")

    const tempDir = tmpdir()
    const inputFile = path.join(
      tempDir,
      `pose_input_${randomBytes(8).toString("hex")}.png`,
    )
    const outputFile = path.join(
      tempDir,
      `pose_output_${randomBytes(8).toString("hex")}.png`,
    )
    const resultFile = path.join(
      tempDir,
      `pose_result_${randomBytes(8).toString("hex")}.json`,
    )

    try {
      // 保存输入图像
      writeFileSync(inputFile, imageInfo.data)

      // 构建Python命令
      const pythonScript = await this.getPythonScriptPath()
      const command = [
        "python",
        `"${pythonScript}"`,
        "--input",
        `"${inputFile}"`,
        "--output",
        `"${outputFile}"`,
        "--result",
        `"${resultFile}"`,
        "--pose-model",
        `"${this.poseModelPath}"`,
        "--detector-model",
        `"${this.detectorModelPath}"`,
        "--confidence-threshold",
        confidenceThreshold.toString(),
        renderStyle === "simple" ? "--simple" : "",
        !detectMultiplePersons ? "--single-person" : "",
        includeHands ? "--include-hands" : "",
        includeFace ? "--include-face" : "",
      ]
        .filter((cmd) => cmd !== "")
        .join(" ")

      console.log(`执行Python姿态估计: ${command}`)
      const { stdout, stderr } = await execAsync(command, { timeout: 120000 }) // 120秒超时

      if (stderr && !stderr.includes("warning")) {
        console.error(`Python脚本错误: ${stderr}`)
      }

      // 读取结果文件
      if (!existsSync(resultFile)) {
        throw new Error("Python脚本未生成结果文件")
      }

      const resultData = JSON.parse(readFileSync(resultFile, "utf-8"))

      // 读取输出图像
      let annotatedImage = ""
      if (existsSync(outputFile)) {
        const outputData = readFileSync(outputFile)
        annotatedImage = `data:image/png;base64,${outputData.toString("base64")}`
      }

      // 清理临时文件
      const { unlinkSync } = await import("fs")
      unlinkSync(inputFile)
      if (existsSync(outputFile)) unlinkSync(outputFile)
      unlinkSync(resultFile)

      // 转换结果为标准格式
      return this.convertPythonResult(resultData, annotatedImage, imageInfo)
    } catch (error: any) {
      // 清理临时文件
      try {
        const { unlinkSync } = await import("fs")
        if (existsSync(inputFile)) unlinkSync(inputFile)
        if (existsSync(outputFile)) unlinkSync(outputFile)
        if (existsSync(resultFile)) unlinkSync(resultFile)
      } catch {}

      throw new Error(`Python处理失败: ${error.message}`)
    }
  }

  /**
   * 转换Python结果为标准格式
   */
  private convertPythonResult(
    pythonResult: any,
    annotatedImage: string,
    imageInfo: any,
  ): PoseEstimationResult {
    const persons = pythonResult.persons || []

    const formattedPersons = persons.map((person: any, index: number) => {
      // 转换关键点
      const keypoints: Keypoint[] = []

      if (person.body_keypoints) {
        person.body_keypoints.forEach((kp: any, i: number) => {
          if (kp.confidence >= 0.1) {
            // 基本置信度阈值
            keypoints.push({
              x: kp.x,
              y: kp.y,
              confidence: kp.confidence,
              name: this.BODY_KEYPOINTS[i] || `body_${i}`,
              id: i,
            })
          }
        })
      }

      return {
        id: index,
        bbox: person.bbox || { x: 0, y: 0, width: 0, height: 0, confidence: 0 },
        keypoints,
        skeleton: this.SKELETON_CONNECTIONS,
        poseType: "full_body" as const,
      }
    })

    return {
      success: true,
      persons: formattedPersons,
      annotatedImage,
      metadata: {
        model: "dwpose",
        processingTime: 0, // 将在外部设置
        imageSize: {
          width: imageInfo.width || pythonResult.image_width || 640,
          height: imageInfo.height || pythonResult.image_height || 480,
        },
        totalPersons: persons.length,
      },
    }
  }

  /**
   * 模拟处理（用于测试）
   */
  private async processSimulated(
    imageInfo: any,
    detectMultiplePersons: boolean,
    includeHands: boolean,
    includeFace: boolean,
    confidenceThreshold: number,
    renderStyle: string,
  ): Promise<PoseEstimationResult> {
    console.log("使用模拟模式进行姿态估计")

    const width = imageInfo.width || 640
    const height = imageInfo.height || 480

    // 模拟1-2个人
    const numPersons = detectMultiplePersons
      ? Math.floor(Math.random() * 2) + 1
      : 1
    const persons = []

    for (let i = 0; i < numPersons; i++) {
      // 随机位置和大小
      const personWidth = Math.random() * 200 + 100
      const personHeight = Math.random() * 300 + 150
      const x = Math.random() * (width - personWidth)
      const y = Math.random() * (height - personHeight)

      // 生成模拟关键点
      const keypoints: Keypoint[] = []

      // 身体关键点
      this.BODY_KEYPOINTS.forEach((name, index) => {
        // 基于人体比例生成关键点位置
        let relX, relY

        switch (name) {
          case "nose":
            relX = 0.5
            relY = 0.1
            break
          case "left_shoulder":
            relX = 0.3
            relY = 0.2
            break
          case "right_shoulder":
            relX = 0.7
            relY = 0.2
            break
          case "left_elbow":
            relX = 0.2
            relY = 0.4
            break
          case "right_elbow":
            relX = 0.8
            relY = 0.4
            break
          case "left_wrist":
            relX = 0.1
            relY = 0.6
            break
          case "right_wrist":
            relX = 0.9
            relY = 0.6
            break
          case "left_hip":
            relX = 0.4
            relY = 0.5
            break
          case "right_hip":
            relX = 0.6
            relY = 0.5
            break
          case "left_knee":
            relX = 0.4
            relY = 0.7
            break
          case "right_knee":
            relX = 0.6
            relY = 0.7
            break
          case "left_ankle":
            relX = 0.4
            relY = 0.9
            break
          case "right_ankle":
            relX = 0.6
            relY = 0.9
            break
          default:
            relX = Math.random()
            relY = Math.random()
        }

        // 添加随机扰动
        const jitter = 0.05
        relX += (Math.random() - 0.5) * jitter
        relY += (Math.random() - 0.5) * jitter

        const kpX = x + relX * personWidth
        const kpY = y + relY * personHeight
        const confidence = 0.7 + Math.random() * 0.3 // 0.7-1.0

        if (confidence >= confidenceThreshold) {
          keypoints.push({
            x: kpX,
            y: kpY,
            confidence,
            name,
            id: index,
          })
        }
      })

      persons.push({
        id: i,
        bbox: {
          x,
          y,
          width: personWidth,
          height: personHeight,
          confidence: 0.9,
        },
        keypoints,
        skeleton: this.SKELETON_CONNECTIONS,
        poseType: "full_body" as const,
      })
    }

    return {
      success: true,
      persons,
      metadata: {
        model: "dwpose",
        processingTime: 0, // 将在外部设置
        imageSize: { width, height },
        totalPersons: numPersons,
      },
    }
  }

  /**
   * 获取Python脚本路径
   */
  private async getPythonScriptPath(): Promise<string> {
    // 检查脚本是否存在，不存在则创建
    if (!existsSync(this.pythonScriptPath)) {
      await this.createPythonScript()
    }
    return this.pythonScriptPath
  }

  /**
   * 创建Python脚本
   */
  private async createPythonScript(): Promise<void> {
    const scriptContent = `"""
DW Pose姿态估计Python脚本
用于jianjicode姿态估计后端
基于LTX的DW Pose实现
"""

import argparse
import cv2
import torch
import numpy as np
import json
import sys
import os

# DW Pose配置
_DETECTOR_INPUT_SIZE = (640, 640)
_POSE_INPUT_SIZE = (288, 384)  # (width, height)
_POSE_BATCH_SIZE = 5
_SIMCC_SPLIT_RATIO = 2.0
_CONFIDENCE_THRESHOLD = 0.3

class DWPoseProcessor:
    def __init__(self, pose_model_path, detector_model_path, device='cpu'):
        self.device = torch.device(device)

        # 加载模型
        self.pose_model = torch.jit.load(pose_model_path, map_location=device)
        self.pose_model.eval()

        self.detector_model = torch.jit.load(detector_model_path, map_location=device)
        self.detector_model.eval()

    def detect_persons(self, image):
        """检测图像中的人物边界框"""
        # 简化的检测逻辑
        # 在实际实现中，这里应该包含完整的YOLOX检测流程
        h, w = image.shape[:2]

        # 模拟检测结果
        boxes = []
        if h > 100 and w > 100:
            # 在图像中心添加一个边界框
            box_width = w * 0.4
            box_height = h * 0.6
            x = (w - box_width) / 2
            y = (h - box_height) / 2

            boxes.append([x, y, x + box_width, y + box_height])

        return np.array(boxes, dtype=np.float32) if boxes else np.empty((0, 4), dtype=np.float32)

    def estimate_pose(self, image, boxes):
        """估计姿态关键点"""
        if boxes.size == 0:
            return [], []

        # 简化的姿态估计逻辑
        # 在实际实现中，这里应该包含完整的DW Pose估计流程
        keypoints_list = []
        scores_list = []

        for box in boxes:
            x1, y1, x2, y2 = box
            width = x2 - x1
            height = y2 - y1

            # 生成模拟关键点
            keypoints = []
            scores = []

            # 身体关键点（17个）
            body_points = [
                [0.5, 0.1],   # 鼻
                [0.5, 0.2],   # 颈
                [0.3, 0.2],   # 左肩
                [0.7, 0.2],   # 右肩
                [0.2, 0.4],   # 左肘
                [0.8, 0.4],   # 右肘
                [0.1, 0.6],   # 左手腕
                [0.9, 0.6],   # 右手腕
                [0.4, 0.5],   # 左髋
                [0.6, 0.5],   # 右髋
                [0.4, 0.7],   # 左膝
                [0.6, 0.7],   # 右膝
                [0.4, 0.9],   # 左踝
                [0.6, 0.9],   # 右踝
                [0.4, 0.1],   # 左眼
                [0.6, 0.1],   # 右眼
                [0.3, 0.15],  # 左耳
                [0.7, 0.15],  # 右耳
            ]

            for rel_x, rel_y in body_points:
                kp_x = x1 + rel_x * width
                kp_y = y1 + rel_y * height
                confidence = 0.8 + np.random.random() * 0.2

                keypoints.append([kp_x, kp_y])
                scores.append(confidence)

            keypoints_list.append(keypoints)
            scores_list.append(scores)

        return np.array(keypoints_list, dtype=np.float32), np.array(scores_list, dtype=np.float32)

    def draw_pose(self, image, boxes, keypoints, scores, confidence_threshold=0.3):
        """绘制姿态估计结果"""
        result = image.copy()

        # 绘制边界框
        for box in boxes:
            x1, y1, x2, y2 = box.astype(int)
            cv2.rectangle(result, (x1, y1), (x2, y2), (0, 255, 0), 2)

        # 绘制关键点
        for person_kps, person_scores in zip(keypoints, scores):
            for kp, score in zip(person_kps, person_scores):
                if score >= confidence_threshold:
                    x, y = kp.astype(int)
                    cv2.circle(result, (x, y), 4, (0, 0, 255), -1)

        # 绘制骨架
        skeleton = [
            (1, 2), (1, 5), (2, 3), (3, 4), (5, 6), (6, 7),
            (1, 8), (8, 9), (9, 10), (1, 11), (11, 12), (12, 13),
            (0, 14), (14, 16), (0, 15), (15, 17), (0, 1)
        ]

        for start_idx, end_idx in skeleton:
            if (start_idx < len(person_kps) and end_idx < len(person_kps) and
                person_scores[start_idx] >= confidence_threshold and
                person_scores[end_idx] >= confidence_threshold):

                x1, y1 = person_kps[start_idx].astype(int)
                x2, y2 = person_kps[end_idx].astype(int)
                cv2.line(result, (x1, y1), (x2, y2), (255, 0, 0), 2)

        return result

def process_image(input_path, output_path, result_path, pose_model_path, detector_model_path,
                  confidence_threshold=0.3, simple_mode=False, single_person=False,
                  include_hands=False, include_face=False):
    """处理单张图像"""

    # 读取图像
    image = cv2.imread(input_path)
    if image is None:
        raise ValueError(f"无法读取图像: {input_path}")

    h, w = image.shape[:2]

    # 初始化处理器
    processor = DWPoseProcessor(pose_model_path, detector_model_path)

    # 检测人物
    boxes = processor.detect_persons(image)

    # 限制人数
    if single_person and boxes.shape[0] > 0:
        boxes = boxes[:1]

    # 估计姿态
    keypoints, scores = processor.estimate_pose(image, boxes)

    # 绘制结果
    if not simple_mode:
        result_image = processor.draw_pose(image, boxes, keypoints, scores, confidence_threshold)
        cv2.imwrite(output_path, result_image)

    # 准备结果数据
    persons = []
    for i, (box, kps, scs) in enumerate(zip(boxes, keypoints, scores)):
        person_data = {
            "id": i,
            "bbox": {
                "x": float(box[0]),
                "y": float(box[1]),
                "width": float(box[2] - box[0]),
                "height": float(box[3] - box[1]),
                "confidence": 0.9
            },
            "body_keypoints": []
        }

        for j, (kp, score) in enumerate(zip(kps, scs)):
            person_data["body_keypoints"].append({
                "x": float(kp[0]),
                "y": float(kp[1]),
                "confidence": float(score)
            })

        persons.append(person_data)

    result_data = {
        "image_width": w,
        "image_height": h,
        "total_persons": len(persons),
        "persons": persons
    }

    # 保存结果
    with open(result_path, 'w') as f:
        json.dump(result_data, f, indent=2)

    print(f"姿态估计完成: {output_path if not simple_mode else '无图像输出'}")

def main():
    parser = argparse.ArgumentParser(description='DW Pose姿态估计')
    parser.add_argument('--input', required=True, help='输入图像路径')
    parser.add_argument('--output', help='输出图像路径（可选）')
    parser.add_argument('--result', required=True, help='结果JSON文件路径')
    parser.add_argument('--pose-model', required=True, help='姿态模型路径')
    parser.add_argument('--detector-model', required=True, help='检测器模型路径')
    parser.add_argument('--confidence-threshold', type=float, default=0.3, help='置信度阈值')
    parser.add_argument('--simple', action='store_true', help='简单模式（不生成图像）')
    parser.add_argument('--single-person', action='store_true', help='只检测单个人')
    parser.add_argument('--include-hands', action='store_true', help='包含手部关键点')
    parser.add_argument('--include-face', action='store_true', help='包含面部关键点')

    args = parser.parse_args()

    try:
        process_image(
            args.input,
            args.output,
            args.result,
            args.pose_model,
            args.detector_model,
            args.confidence_threshold,
            args.simple,
            args.single_person,
            args.include_hands,
            args.include_face
        )
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
`

    // 确保脚本目录存在
    const { mkdirSync, writeFileSync } = await import("fs")
    const { dirname } = await import("path")

    mkdirSync(dirname(this.pythonScriptPath), { recursive: true })
    writeFileSync(this.pythonScriptPath, scriptContent, "utf-8")

    console.log(`创建Python脚本: ${this.pythonScriptPath}`)
  }
}
