# jianjicode 开发进度记录

## 项目状态
**最后更新**: 2026-04-24
**开发分支**: LTX-Desktop-main

## 已完成功能 ✅

### AI分析系统 (阶段2 - 已完成90%)
- ✅ **抽象接口**: `src/ai/types/index.ts`
- ✅ **提供商适配器**:
  - OpenAI/DeepSeek/Azure适配器 (`openai.ts`)
  - Claude适配器 (`anthropic.ts`)
  - Gemini适配器 (`google.ts`)
  - 阿里通义、百度文心、智谱AI适配器
- ✅ **AI视频分析工具**: `src/tool/ai_video_analysis.ts`
  - 场景过渡建议
  - 视觉风格分析
  - 视频帧分析
  - 视频内容总结

### 基础工具 (阶段1 - 部分完成)
- ✅ **TypeScript工具类**: `src/tool/ltx_video_processor.ts`
- ✅ **Python脚本桥接**: `scripts/ltx_video_processor.py`
- ⚠️ **Python桥接包**: `jianjicode-python/` (仅CLI包装，未封装LTX服务)

### LTX后端集成
- ✅ **视频编辑服务**: `backend/services/video_editor/`
- ✅ **API路由**: `backend/_routes/editing.py`
- ✅ **预设管理器**: `backend/services/video_editor/preset_manager.py`

### 高级功能集成 (阶段3 - 已完成核心工具)
- ✅ **专业字幕模板系统**: `src/tool/professional_subtitle_template.ts`
  - 14种预设模板（电影、社交媒体、新闻、企业、创意、极简、动画）
  - 模板管理、应用、创建、导出功能
- ✅ **颜色分级预设系统**: `src/tool/color_grading_preset.ts`
  - 12种颜色分级预设（电影感、青橙色调、复古、现代、冷暖、戏剧、柔色、单色）
  - 预设管理、强度控制、自定义创建
- ✅ **特效模板系统**: `src/tool/effect_template.ts`
  - 12种特效组合模板（电影感、复古、现代、艺术、社交媒体、实验）
  - 多特效序列管理、强度控制
- ✅ **时间线编辑器工具**: `src/tool/timeline_editor.ts`
  - 多轨道时间线管理（视频、音频、字幕、特效轨道）
  - 剪辑操作（添加、移动、修剪、分割）
  - 项目管理（创建、加载、保存、导出）
- ✅ **时间线类型系统**: `src/types/timeline-types.ts`
  - 完整的时间线数据结构（项目、轨道、剪辑、过渡、特效、滤镜）
  - 类型安全的时间线操作工具函数

## 待完成功能 🔴

### 高优先级 (阻塞生产使用) ✅ 已完成
1. ✅ **Python LTX桥接层** - 封装`VideoProcessor`服务 (`jianjicode-python/jianjicode/ltx_bridge.py`)
2. ✅ **TypeScript直接调用工具** - 调用LTX后端API (`jianjicode/src/tool/ltx_direct_tool.ts`)
3. ✅ **LTX后端集成** - 将现有工具与LTX video_editor服务连接 (通过Python桥接层直调)
4. ✅ **预设应用工具** - 实际应用预设到视频 (`apply_preset`) (字幕、颜色、特效模板均已集成)

### 中优先级
5. ✅ **批量处理系统** - 已集成LTX直接桥接（扫描、队列、报告工具）
6. ✅ **项目文件格式持久化** - 基本保存/加载功能已实现 (`timeline_editor.ts`)，支持JSON格式，需完善路径转换和版本控制
7. ✅ **时间线编辑器实际渲染集成** - TypeScript原生渲染器已实现并集成 (`timeline_renderer.ts`)

### 低优先级
8. 错误恢复机制
9. 进度报告完善

## 四个阶段计划修正

### 阶段1：基础工具封装 (已完成) ✅
**目标**: 创建真正的LTX服务桥接 ✅
- ✅ `jianjicode-python/ltx_bridge.py` - 封装VideoProcessor（支持直接导入和HTTP两种模式）
- ✅ `jianjicode/src/tool/ltx_direct_tool.ts` - 直接调用Python桥接层（子进程调用，无HTTP依赖）
- ✅ `jianjicode/src/tool/ltx_video_processor_v2.ts` - 直接HTTP API调用（备用方案）

### 阶段2：AI分析通用化 (已完成)
**仅需完善**: 视频特定分析功能

### 阶段3：高级功能集成 (核心工具已完成，LTX集成已完成) ✅
**已完成**: 字幕模板、颜色分级、特效模板、时间线编辑器等核心工具 ✅
**已完成**: 与LTX后端实际集成，实现预设应用到视频 ✅
- ✅ 连接预设工具到LTX video_editor服务（通过Python桥接层）
- ✅ 字幕模板工具 (`professional_subtitle_template.ts`) 已集成LTX直接桥接
- ✅ 颜色分级预设工具 (`color_grading_preset.ts`) 已集成LTX直接桥接
- ✅ 特效模板工具 (`effect_template.ts`) 已集成LTX直接桥接
- ✅ **时间线编辑器到FFmpeg渲染管道** - TypeScript原生渲染器已实现 (`timeline_renderer.ts`)
- ✅ **特效模板的实际视频处理** - 已完善，使用 TypeScript 原生视频滤镜工具 (`video_filter.ts`)，支持 blur、sharpen、glow、vignette、grain 等实际特效

### 阶段4：工作流整合 (1-2周)
- 自然语言接口增强
- ✅ **批量处理系统** - 已集成LTX直接桥接（扫描、队列、报告工具）
- 项目管理系统

## 新完成的高级视频编辑工具 ✅ (2026-04-04)

已完成用户要求的9个核心高级功能集成，采用TypeScript原生实现，参考LTX源码：

### 1. 视频滤镜增强 (video_filter.ts) - 已增强
- 新增高级特效: glow(发光)、vignette(暗角)、grain(胶片颗粒)
- 支持滤镜组合和强度控制
- 基于FFmpeg滤镜实现

### 2. 字幕工具增强 (video_subtitle.ts) - 已扩展
- 支持直接文本输入 (无需外部字幕文件)
- 使用LTX的drawtext滤镜实现
- 支持字体、大小、颜色、位置、边框、阴影控制

### 3. 帧提取工具 (video_extract_frame.ts) - 新创建
- 基于LTX的`edit_extract_frame`方法实现
- 支持单帧、多帧、时间间隔提取
- 输出格式: PNG, JPEG, WebP

### 4. LUT滤镜工具 (lut_filter.ts) - 新创建
- 基于LTX的`lutToFfmpegFilters`方法实现
- 内置7种LUT预设: cinematic, vintage, bw, cool, warm, muted, vivid
- 支持自定义.cube文件
- 强度控制和混合选项

### 5. 遮罩工具 (video_mask.ts) - 新创建
- 基于LTX的`EffectMask`接口设计
- 支持矩形和椭圆形遮罩
- 位置、大小、羽化、反转、旋转控制
- 可应用效果到遮罩区域 (模糊、亮度、对比度等)

### 6. 关键帧动画工具 (keyframe_animation.ts) - 新创建
- 支持位置、缩放、旋转、透明度动画
- 关键帧JSON数据输入
- 缓动函数: linear, ease-in, ease-out, ease-in-out
- 基于FFmpeg的zoompan和rotate滤镜

### 7. 速度调整工具 (video_speed.ts) - 新创建
- 支持0.1x到10x速度调整
- 音频同步 (atempo滤镜链)
- 音调保持选项
- 分段速度调整支持 (未来扩展)

### 8. 视频稳定工具 (video_stabilization.ts) - 新创建
- 使用FFmpeg的vidstabdetect + vidstabtransform
- 稳定性强度和平滑度控制
- 自动缩放和边界处理选项
- 虚拟三脚架模式

### 9. 音频效果工具 (audio_effects.ts) - 新创建
- 均衡器 (EQ): 低音、中音、高音调整
- 压缩器、混响、延迟/回声效果
- 音高变换、音量调整、淡入淡出
- 噪声消除、立体声增强

### 10. 硬件加速编码工具 (hardware_acceleration.ts) - 新创建
- 检测可用硬件加速编码器 (NVENC, QSV, AMF, VideoToolbox等)
- 硬件加速编码参数预设
- 性能测试和推荐配置

## 生产级AI视频编辑差距分析

**已解决的差距**:
1. ✅ 专业级特效滤镜系统 (glow, vignette, grain等)
2. ✅ 高级字幕系统 (直接文本输入，多种样式)
3. ✅ 帧精确操作 (帧提取、关键帧动画)
4. ✅ 颜色分级系统 (LUT滤镜，预设库)
5. ✅ 遮罩和局部效果系统
6. ✅ 速度控制和稳定系统
7. ✅ 专业音频处理系统
8. ✅ 硬件加速优化

**剩余差距**:
1. ⚠️ 多轨道时间线编辑 (已有基础实现，需完善)
2. ⚠️ 实时预览和播放头控制
3. ⚠️ 更复杂的过渡效果库
4. ⚠️ 音频波形可视化
5. ⚠️ 第三方插件生态系统

**当前状态**: jianjicode现已具备生产级视频编辑AI的核心功能，能够处理大多数常见视频编辑任务。

## 目录技术方案梳理 (2026-04-24 整理)

> **目的**: 记录各个目录的技术方案和作用，避免后续混淆，方便新成员快速理解项目结构。

### 四个 LTX 变体说明

#### 1. LTX-Desktop-main（主开发目录 ⭐）
- **定位**: jianjicode 集成的**主开发目录**，所有新功能在此开发
- **状态**: 活跃开发中
- **技术方案**: 云端 API 方案（Qwen 3.6-plus via DashScope Anthropic 兼容接口）
- **后端服务** (24个):
  - `video_editor` — 视频编辑核心服务（FFmpeg包装器、预设管理器）
  - `video_analysis_pipeline` — 视频分析流水线（**2589行**，增强版）
  - `jianjicode_pipeline` — **独有**，jianjicode 集成管道（3个文件：video/audio/edit）
  - `fast_video_pipeline` — 快速视频生成管道
  - `a2v_pipeline` — 音频驱动视频管道
  - `ic_lora_pipeline` — IC-LoRA 图像生成管道
  - `pose_processor_pipeline` — 姿态处理管道
  - `retake_pipeline` — 重拍管道
  - 其他: depth_processor, image_generation, task_runner, model_downloader 等
- **API路由** (14个): generation, editing, video_analysis, retake, ic_lora, image_gen, health, models, settings, suggest_gap_prompt, runtime_policy
- **前端**: Electron + React，含 Project/Home/Playground 三视图
- **构建系统**: pnpm (前端) + Python FastAPI (后端)
- **关键文件**:
  - `backend/app_handler.py` — 服务组合根，jianjicode_pipeline 作为活跃实现
  - `backend/services/jianjicode_pipeline/` — 导入 jianjicode-python 桥接层
  - `frontend/views/GenSpace.tsx` — 视频生成空间界面
- **Python venv**: 已创建（`uv sync`，Python 3.13.12，PyTorch 2.10.0+cu128）
- **依赖链**: LTX后端 → jianjicode_pipeline → jianjicode-python (桥接层) → jianjicode CLI → FFmpeg

#### 2. LTX-Desktop-original（原始锁定版 🔒）
- **定位**: **永久锁定**的原始 LTX 代码，不修改，仅做参考
- **状态**: 只读参考，不再开发
- **技术方案**: 早期集成方案（含 chat.py 聊天端点）
- **后端服务** (23个): 与 main 基本相同，但**无 jianjicode_pipeline**
- **API路由** (13个): 比 main 多 `chat.py`（早期聊天API），无 `video_analysis.py`
- **Python venv**: 5.1GB，Python 3.13.12，保留不删除
- **关键文件**:
  - `backend/_routes/chat.py` — 早期聊天端点（简化的集成尝试）
  - `backend/_routes/editing.py` — 视频编辑路由

#### 3. LTX-Desktop-check（本地模型方案 🔬）
- **定位**: 采用**本地模型**的实验方案，保留不删除
- **状态**: 实验完成，代码保留
- **技术方案**: 本地深度学习模型（YOLOv8s + CLIP-ViT-B/32 + PaddleOCR + R3D-18 + ByteTrack）
  - 不依赖云端 API，完全本地运行
  - 使用 ultralytics (YOLO)、transformers (CLIP)、PaddleOCR 等
- **后端服务** (20个): 比 main 少 `jianjicode_pipeline`、`video_editor`、`editing` 路由
- **API路由** (12个): 标准路由，无 editing、video_analysis、chat
- **video_analysis_pipeline**: 1413行（55KB），比 main 的2589行小，功能更基础
- **独有目录**: `video_analysis_test/` — 测试脚本和实验代码
- **关键文件**:
  - `backend/services/video_analysis_pipeline/video_analysis_pipeline.py` — 1413行本地模型分析管道

#### 4. LTX-Desktop-clean（原始 LTX 分发版 🧹）
- **定位**: **原始 LTX 代码**，未经任何 jianjicode 修改
- **状态**: 只读参考，不修改
- **技术方案**: 纯 LTX 原始功能，无任何 jianjicode 集成
- **后端服务** (19个): **无 video_editor**、**无 video_analysis_pipeline**、**无 jianjicode_pipeline**
- **API路由** (12个): 标准路由
- **关键区别**: 这是 LTX 项目的"出厂状态"，用于对比集成变更
- **用途**: 当需要确认某个行为是 LTX 原本就有的还是 jianjicode 引入的时，参考此目录

### jianjicode-python（Python 桥接层）

- **定位**: jianjicode (TypeScript/Bun) 和 LTX (Python) 之间的**桥接层**
- **核心模块**:
  - `core.py` — 包装 jianjicode CLI 为 Python 函数（通过 subprocess 调用）
  - `ltx_bridge.py` — 直接 Python import 访问 LTX 服务（VideoEditorService、PresetManager）
    - 路径自动探测：先检查 `LTX_BACKEND_PATH` 环境变量，再依次探测 main → original
  - `r3d.py` — 独立的 R3D-18 动作识别模块（未集成到主流）
- **依赖关系**: LTX-Desktop-main 的 `jianjicode_pipeline` 服务 `import jianjicode` 即导入此包
- **通信方式**: 子进程调用（`subprocess.run(["jianjicode", ...])` → TypeScript CLI → FFmpeg）
- **不可删除**: 删除会导致 LTX 的视频编辑操作全部失效

### jianjicode/server/ 和 src/core/（HTTP 服务层，新增 2026-04-24）

- **定位**: jianjicode 的 HTTP 服务层，提供 REST API
- **核心文件**:
  - `server/chat-core.ts` — 聊天核心逻辑
  - `server/python_client.ts` — Python 客户端（与 LTX 后端通信）
  - `server/python_server.py` — 已删除，功能合并至 FastAPI (:8000)
  - `src/core/` — 核心模块（与 server/ 配合）

### 三套构建系统

| 系统 | 用途 | 命令 |
|------|------|------|
| **Bun** | jianjicode TypeScript CLI | `bun run build` |
| **pnpm** | LTX 前端 (Electron + React) | `pnpm build` / `pnpm dev` |
| **Python/uv** | LTX 后端 (FastAPI) | `uv run python ltx2_server.py` |

三者服务于不同生态，不需要统一。

### 技术方案对比总结

| 维度 | Cloud API (jianjicode主方案) | 本地模型 (check实验) | 混合方案 (video_analysis_test) |
|------|---------------------------|---------------------|-----------------------------|
| **AI模型** | Qwen 3.6-plus (云端) | YOLOv8s+CLIP+R3D-18 (本地) | 通用分析管道 |
| **视频理解** | Qwen omni 多模态 | 本地CV模型组合 | 可配置 |
| **部署难度** | 低（只需API密钥） | 高（需GPU+模型下载） | 中 |
| **成本** | API调用费用 | 硬件成本 | 两者皆有 |
| **离线可用** | 否 | 是 | 部分 |
| **开发目录** | LTX-Desktop-main | LTX-Desktop-check | video_analysis_test/ |
| **状态** | 主要开发方案 ✅ | 实验保留 📦 | 已归档 📦 |

### 关键决策记录

1. **main 是 check 的超集**: main 的 video_analysis_pipeline (2589行) 比 check (1413行) 更完整，无需合并
2. **original 的 .venv 不迁移**: 使用 `uv sync` 为 main 新建独立 venv，保持 original 完整
3. **所有变体全保留**: 每个变体代表不同的技术探索路径，具有参考价值
4. **jianjicode-python 必须保留**: LTX-Desktop-main 的 jianjicode_pipeline 依赖它

## 开发注意事项
1. **所有开发必须在** `LTX-Desktop-main` 进行
2. **避免重复造轮子** - 优先集成LTX现有功能
3. **保持两套系统并存**:
   - jianjicode_pipeline (AI自然语言编辑)
   - video_editor服务 (精确参数编辑)
4. **定期更新此文档** - 避免遗忘开发进度
5. **jianjicode-python 是桥接层** - LTX后端通过它调用jianjicode CLI，修改需谨慎