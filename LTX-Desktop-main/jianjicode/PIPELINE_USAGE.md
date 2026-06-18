# LTX风格管道架构使用指南

## 概述

基于从LTX项目借鉴的经验，我们创建了一个统一的视频处理管道架构。该系统提供了：

1. **硬件加速自动检测** - 自动选择最佳GPU编码器 (NVIDIA NVENC, Intel QSV, AMD AMF等)
2. **统一管道接口** - 类似LTX的Pipeline模式，但专注于视频编辑
3. **跨领域视频分析** - 通用视频分析器，适用于任何视频类型
4. **TypeScript优先集成** - 完全TypeScript实现，类型安全

## 已实现的管道

### 1. FFmpeg编辑管道 (`FfmpegEditPipeline`)
- **功能**: trim、concat、convert、analyze等基础编辑操作
- **硬件加速**: 支持CUDA、QSV、VA-API等硬件编码器
- **位置**: `src/video/pipelines/ffmpeg-edit-pipeline.ts`

### 2. LTX分析管道 (`LtxAnalyzePipeline`)
- **功能**: 集成LTX的分析功能 (姿态检测、物体识别、场景分析等)
- **借鉴LTX**: DWPosePipeline、ObjectDetectionPipeline、SceneAnalysisPipeline
- **位置**: `src/video/pipelines/ltx-analyze-pipeline.ts`

### 3. FFmpeg导出管道 (`FfmpegExportPipeline`)
- **功能**: 专业视频导出和编码，优化硬件加速参数
- **优化**: NVIDIA NVENC参数优化 (-preset、-cq、-rc等)
- **位置**: `src/video/pipelines/ffmpeg-export-pipeline.ts`

## 快速开始

### 1. 使用管道工厂

```typescript
import { PipelineFactory } from './src/video/pipeline.js'
import { pipelineToolIntegrator } from './src/video/pipelines/pipeline-registry.js'

// 初始化所有管道
await pipelineToolIntegrator.initializeAllPipelines()

// 获取FFmpeg编辑管道工具
const ffmpegTool = pipelineToolIntegrator.getPipelineTool('ffmpeg-edit')

// 执行trim操作
const result = await ffmpegTool.process({
  operation: 'trim',
  inputPath: 'input.mp4',
  outputPath: 'output.mp4',
  parameters: {
    start_time: '00:00:10',
    end_time: '00:00:20',
    hardware_acceleration: true
  }
})
```

### 2. 使用通用视频分析器

```typescript
import { UniversalVideoAnalyzerTool } from './src/tool/universal_video_analyzer.js'

// 分析篮球视频
const analysis = await UniversalVideoAnalyzerTool.handler({
  input: 'basketball.mp4',
  domain: 'sports',
  analysis_mode: 'comprehensive',
  extract_frames: true,
  frame_rate: 10,
  include_editing_suggestions: true
})

// 分析结果包含：
// - 视觉特征提取
// - 结构化描述生成  
// - AI分析建议
// - 自动剪辑建议
```

### 3. 硬件加速检测

```typescript
import { detectBestHardwareAcceleration } from './src/tool/ffmpeg-utils.js'

// 自动检测最佳硬件加速
const hwAccel = detectBestHardwareAcceleration()
console.log(`最佳硬件加速: ${hwAccel.hwaccel || '无'}`)
console.log(`最佳编码器: ${hwAccel.encoder || '无'}`)

// 可用硬件加速方法
const hwaccels = detectHardwareAcceleration()
console.log(`可用硬件加速: ${hwaccels.join(', ')}`)
```

## LTX集成

### 1. LTX导出处理器更新

我们已经更新了LTX的导出处理器 (`LTX-Desktop-main/electron/export/export-handler.ts`)，添加了：

1. **管道适配器** (`LtxExportPipelineAdapter`) - 包装现有导出逻辑为管道接口
2. **管道工厂** (`LtxPipelineFactory`) - 管理管道实例生命周期
3. **新IPC处理程序** (`export-pipeline`) - 支持管道架构的导出

### 2. 使用LTX管道导出

```javascript
// 在LTX渲染进程中
const result = await window.electronAPI.invoke('export-pipeline', {
  task: {
    operation: 'export',
    inputPath: ['clip1.mp4', 'clip2.mp4'],
    outputPath: 'output.mp4',
    parameters: {
      codec: 'h264',
      width: 1920,
      height: 1080,
      fps: 30,
      quality: 23,
      hardware_acceleration: true
    }
  },
  config: {
    type: 'export',
    hardwareAcceleration: true,
    device: 'cuda',
    maxConcurrent: 1,
    logLevel: 'info'
  }
})
```

### 3. 硬件加速参数优化

LTX导出处理器现在自动优化硬件编码参数：

- **NVIDIA NVENC**: `-preset slow -cq 23 -rc constqp`
- **Intel QSV**: `-preset medium -global_quality 23`
- **AMD AMF**: `-quality quality -qp_i 23 -qp_p 23`
- **软件编码**: `-preset medium -crf 23`

## 硬件加速支持

### 支持的平台和编码器

| 平台 | 硬件加速方法 | 编码器 | 备注 |
|------|-------------|--------|------|
| NVIDIA GPU | CUDA | h264_nvenc, hevc_nvenc | 需要NVIDIA驱动 |
| Intel GPU | QSV | h264_qsv, hevc_qsv | 需要Intel Media SDK |
| AMD GPU | D3D11VA | h264_amf, hevc_amf | 需要AMD驱动 |
| macOS | VideoToolbox | h264_videotoolbox | 原生支持 |
| Linux | VA-API | h264_vaapi, hevc_vaapi | 需要Mesa驱动 |

### 自动检测优先级

1. **CUDA** (NVIDIA) - 最高性能
2. **QSV** (Intel) - 良好性能，低功耗  
3. **AMF** (AMD) - AMD显卡专用
4. **VA-API** (Linux) - 开源驱动
5. **VideoToolbox** (macOS) - Apple芯片
6. **软件编码** - 备用方案

## 通用视频分析器架构

### 三层分析架构

```
1. 视觉特征提取层
   ↓ 提取帧、检测物体、分析场景
2. 结构化描述生成层  
   ↓ 生成JSON描述、统计信息
3. 领域特定分析层
   ↓ 应用领域知识、生成建议
```

### 支持的领域

- **体育** (sports) - 篮球、足球、田径等动作分析
- **演讲** (speech) - 演讲者检测、表情分析
- **宠物** (pets) - 宠物行为分析
- **车辆** (vehicles) - 交通流量、车辆识别
- **自然** (nature) - 风景、动物识别
- **教育** (education) - 教学视频分析
- **娱乐** (entertainment) - 电影、综艺分析
- **监控** (surveillance) - 安防视频分析
- **医疗** (medical) - 医疗影像分析（基础）

## 开发指南

### 1. 添加新管道

```typescript
// 1. 实现管道接口
export class MyCustomPipeline implements VideoEditPipeline {
  readonly pipelineType = 'my-custom'
  
  async create(config: PipelineConfig): Promise<VideoEditPipeline> {
    // 初始化
    return this
  }
  
  async process(task: VideoEditTask, progressCallback?: ProgressCallback): Promise<PipelineResult> {
    // 处理逻辑
  }
}

// 2. 注册管道
import { PipelineFactory } from './src/video/pipeline.js'
PipelineFactory.registerPipeline('my-custom', MyCustomPipeline)

// 3. 添加到工具集成器
import { pipelineToolIntegrator } from './src/video/pipelines/pipeline-registry.js'
// 自动注册
```

### 2. 扩展硬件加速支持

```typescript
// 在ffmpeg-utils.ts中添加新的硬件加速检测
function detectCustomHardwareAcceleration(): string[] {
  // 检测自定义硬件加速
  return ['custom-hwaccel']
}

function getCustomHardwareEncoders(codec: string): string[] {
  // 返回自定义编码器
  return ['custom_encoder']
}
```

## 故障排除

### 1. 硬件加速未检测到

```bash
# 检查FFmpeg硬件加速支持
ffmpeg -hwaccels

# 检查编码器列表
ffmpeg -encoders | grep -E "nvenc|qsv|amf|vaapi"

# 测试编码
ffmpeg -i input.mp4 -c:v h264_nvenc -preset fast output.mp4
```

### 2. 管道初始化失败

- 检查FFmpeg路径是否正确设置
- 验证临时目录权限
- 检查TypeScript编译错误（设置strict: false）

### 3. LTX集成问题

- 确保LTX的ffmpeg-utils.ts已更新（包含硬件加速函数）
- 检查export-handler.ts中的新管道处理程序
- 验证IPC通道名称匹配

## 性能优化建议

1. **GPU内存管理**: 大视频文件可能需要更多GPU内存
2. **并发控制**: 限制同时运行的管道实例数量
3. **临时文件清理**: 定期清理临时帧提取文件
4. **编码预设选择**: 
   - 质量优先: `-preset slow -cq 18`
   - 平衡: `-preset medium -cq 23` 
   - 速度优先: `-preset fast -cq 28`

## 后续开发方向

1. **实时管道**: 添加实时视频处理管道
2. **分布式处理**: 支持多机分布式视频处理
3. **AI模型集成**: 集成更多LTX AI模型
4. **插件系统**: 支持第三方管道插件
5. **WebGPU支持**: 下一代GPU加速

---

*基于LTX项目架构经验开发，遵循"集成而不重复造轮子"原则*