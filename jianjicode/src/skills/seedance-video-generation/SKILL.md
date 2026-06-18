---
name: seedance-video-generation
description: AI 视频生成/编辑工具选择与使用指南（Seedance 2.0 系列）。涵盖工具选择决策、Prompt 编写、参数配置、失败恢复和验证。
category: effect
tags: [seedance, ai-video, style-transfer, video-generation, video-editing]
created: 2026-05-30
toolCount: 1
toolVersion: "1.0.0"
inputSchema:
  type: object
  required: []
  properties: {}
---

# Seedance 视频生成/编辑 — 工具选择与使用指南

## 1. 用户目标是什么？

| 用户目标 | 示例 |
|---------|------|
| 从文本生成视频 | "生成一段日出海滩的视频" |
| 基于图片生成视频 | "让这张图片动起来" |
| 改变视频视觉风格 | "做成动漫风格"、"变成像素风"、"改成油画" |
| 替换视频中元素 | "把汽车改成坦克"、"把红衣服改成蓝的" |
| 删除视频中元素 | "去掉画面中的人" |
| 给视频加内容 | "在台面上加一杯咖啡" |
| 延长视频 | "向后延长3秒，汽车继续往前开" |
| 多段视频拼接 | "视频1转场到视频2" |
| 生成有声视频 | 自动带音效/配音 |

## 2. 哪些能力能完成？

- **文生视频**：仅文本 prompt → 生成视频
- **图生视频-首帧**：文本 + 首帧图 → 生成后续内容
- **图生视频-首尾帧**：文本 + 首帧图 + 尾帧图 → 生成中间过渡
- **多模态参考**：文本 + 图片/视频/音频参考 → 继承风格/主体/运镜/音色
- **编辑视频**：输入视频 + 文本修改指令 → 增删改画面元素
- **延长视频**：输入视频 + 延长方向描述 → 向前或向后延长
- **有声视频**：`generate_audio=true` → 模型自动生成匹配音频

## 3. 哪些工具拥有能力？

### 决策树

```
用户请求是视频相关的吗？
├─ 否 → 不调 Seedance
└─ 是
   ├─ 能用传统工具完成吗？
   │  ├─ 裁剪/拼接/转场/水印/字幕等 → 对应 FFmpeg 工具
   │  ├─ 调色/滤镜（复古/暖色/冷色/黑白） → video_filter
   │  └─ 不能 → 走 AI 路线
   └─ AI 路线
      ├─ 局部修改已有内容（删物体/替换局部/改一个元素） → edit_video
      ├─ 整体重绘/风格重构/场景重构 → seedance_v2
      └─ 纯生成（文本/图片→视频） → seedance_v2
```

### 优先级规则
1. 能用确定性工具完成的操作，绝不调用 Seedance
2. 局部修改优先 edit_video（对原视频破坏更小）
3. 不确定的中间地带优先 edit_video

## 4. 哪些行为绝对禁止？

- ❌ 不可回退到 FFmpeg / html_frame_render 模拟 AI 生成能力
- ❌ 不可替代已有确定性工具（裁剪、调速、滤镜、水印、字幕、转场、遮罩）
- ❌ 编辑/延长视频时不可用"参考<视频N>"，必须用"将<视频N>"直接指代
- ❌ 不要臆造用户未指定的主体特征（如用户只说"动漫风格"，不要自动编造主角长相）

## 5. 参数空间有哪些约束？

### 模型选择

| 场景 | 推荐模型 | 说明 |
|------|---------|------|
| 追求最高品质，有参考视频 | doubao-seedance-2-0-260128 | 支持1080p，质量更高 |
| 追求速度/成本，或纯文生视频 | doubao-seedance-2-0-fast-260128 | 更快更便宜；R2V最大720p |
| 不确定 | doubao-seedance-2-0-260128 | 标准版更稳定 |

### 参数速查

| 参数 | 类型 | 允许值 | 默认 | 说明 |
|------|------|--------|------|------|
| prompt | string | 必填 | — | 自然语言描述 |
| model | string | 见上表 | doubao-seedance-2-0-260128 | 模型版本 |
| reference_images | string[] | ≤9张，<30MB/张 | — | 参考图片 URL |
| reference_image_paths | string[] | ≤9张 | — | 参考图片本地路径 |
| reference_image_roles | enum[] | reference_image/first_frame/last_frame | reference_image | 每张图片角色，需与图片一一对应 |
| reference_videos | string[] | ≤3个，2-15s，<50MB | — | 参考视频 URL |
| reference_video_paths | string[] | ≤3个 | — | 参考视频本地路径 |
| reference_audio | string[] | ≤3个，MP3，<15MB | — | 参考音频 URL |
| reference_audio_paths | string[] | ≤3个 | — | 参考音频本地路径 |
| duration | number | 4-15 | 5 | 视频时长（秒） |
| ratio | string | 21:9/16:9/4:3/1:1/3:4/9:16/adaptive | 16:9 | 宽高比 |
| resolution | string | 480p/720p/1080p | 720p | 分辨率；Fast R2V最大720p |
| generate_audio | boolean | true/false | true | 是否生成音频 |
| seed | number | 任意整数 | — | 随机种子，复现用 |
| camera_fixed | boolean | true/false | false | 固定镜头 |
| return_last_frame | boolean | true/false | false | 返回尾帧图 |
| watermark | boolean | true/false | — | 是否加水印 |

### Prompt 编写公式
```
精准主体 + 动作细节 + 场景环境 + 光影色调 + 镜头运镜 + 视觉风格 + 画质 + 约束条件
```

### 宽高比选择

| 平台 | ratio |
|------|-------|
| 抖音/TikTok/Reels/Shorts | 9:16 |
| 微信朋友圈视频 | 9:16 或 1:1 |
| Instagram Feed | 1:1 |
| Instagram Story | 9:16 |
| YouTube/电影 | 16:9 |
| 影院宽银幕 | 21:9 |
| 未指定且有输入素材 | adaptive |
| 纯文本无指定 | 16:9 |

## 6. 失败如何恢复？

| 失败场景 | 恢复策略 |
|---------|---------|
| Invalid video_url | 工具自动重试2次（重新上传参考文件） |
| 分辨率不支持（如Fast用1080p） | 自动降级到最大支持分辨率 |
| 任务超时 | 后端可能仍在处理，可稍后查询 |
| 图片角色数量超出图片数 | 工具返回校验错误，修正后重试 |

## 7. 成功如何验证？

- ✅ 输出文件存在（.mp4）
- ✅ 包含视频轨（ffprobe 验证）
- ✅ 时长 > 0
- ✅ 输出规格符合请求参数
- ⚠️ 音频轨可能存在，不强制要求
