# jianjicode AI集成架构

## 项目概述
jianjicode是一个AI驱动的视频编辑工具，基于OpenCode的AI代理架构，支持通过自然语言命令编辑视频。

## 技术架构

### 混合架构设计
- **前端**: LTX Desktop (Electron + React) - 提供聊天式用户界面
- **AI核心**: TypeScript - 复用OpenCode的AI代理系统
- **视频处理**: FFmpeg - 视频编辑后端
- **集成层**: Python - 连接LTX后端和jianjicode AI服务

### 组件架构图
```
┌─────────────────────────────────────────────────────┐
│                    LTX Desktop                       │
│  ┌──────────────────────────────────────────────┐  │
│  │  React Frontend (GenSpace改造成聊天界面)      │  │
│  └──────────────────────────────────────────────┘  │
│            │ HTTP API (localhost:8000)              │
└─────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────┐
│               Python FastAPI Backend                 │
│  ┌──────────────────────────────────────────────┐  │
│  │  Chat Handler (/api/chat)                    │  │
│  │  • 接收聊天请求                              │  │
│  │  • 调用jianjicode CLI                        │  │
│  │  • 返回AI响应                                │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                         │ subprocess调用
┌─────────────────────────────────────────────────────┐
│                jianjicode CLI                        │
│  ┌──────────────────────────────────────────────┐  │
│  │  OpenCode AI Core                          │  │
│  │  • LLM Provider (OpenAI/Anthropic)          │  │
│  │  • 工具调用系统                             │  │
│  │  • 会话管理                                 │  │
│  └──────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────┐  │
│  │  Video Editing Tools                        │  │
│  │  • trim_video                               │  │
│  │  • concat_videos                            │  │
│  │  • convert_video                            │  │
│  │  • extract_audio                            │  │
│  │  • merge_audio                              │  │
│  │  • apply_filter                             │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                         │ FFmpeg命令执行
┌─────────────────────────────────────────────────────┐
│                    FFmpeg Binary                     │
│                 (视频处理后端)                       │
└─────────────────────────────────────────────────────┘
```

## 目录结构

### jianjicode项目结构
```
jianjicode/
├── ai/                          # OpenCode AI核心代码
│   ├── provider/               # AI提供者管理系统
│   │   ├── provider.ts         # 提供者注册和配置
│   │   ├── schema.ts           # 数据模型定义
│   │   └── transform.ts        # 提供者选项转换
│   ├── session/                # 会话管理
│   │   ├── llm.ts             # LLM流式处理核心
│   │   ├── message.ts         # 消息结构
│   │   ├── message-v2.ts      # 消息结构v2
│   │   └── system.ts          # 系统提示词
│   ├── tool/                  # 工具系统
│   │   ├── registry.ts        # 工具注册表
│   │   ├── tool.ts            # 工具基础接口
│   │   └── video/             # 视频编辑专用工具
│   │       ├── trim.ts        # 剪辑工具
│   │       ├── concat.ts      # 合并工具
│   │       ├── convert.ts     # 转换工具
│   │       ├── audio.ts       # 音频工具
│   │       └── filter.ts      # 滤镜工具
│   ├── agent/                 # 代理配置
│   │   └── agent.ts           # 代理定义和管理
│   └── config/                # 配置管理
│       └── config.ts          # 配置系统
├── src/
│   ├── tool/                  # 现有工具系统
│   │   └── ffmpeg.ts          # FFmpeg基础工具
│   ├── cli/
│   │   ├── cmd/
│   │   │   └── chat.ts        # 聊天式CLI命令
│   │   └── index.ts           # CLI入口
│   └── server/                # HTTP API服务(可选)
│       └── index.ts           # Express/Fastify服务器
├── bin/
│   └── jianjicode             # CLI可执行文件
├── resources/                 # 资源文件
│   └── ffmpeg/                # FFmpeg二进制文件
├── python/                    # Python集成层
│   └── chat_integration.py    # Python包装器
├── package.json               # 项目配置
├── tsconfig.json              # TypeScript配置
└── ARCHITECTURE.md            # 本文件
```

### LTX Desktop集成结构
```
LTX-Desktop-main/
├── backend/
│   ├── _routes/
│   │   └── chat.py            # 新增聊天API端点
│   ├── handlers/
│   │   └── chat_handler.py    # 聊天处理器
│   ├── api_types.py           # 扩展API类型定义
│   └── app_handler.py         # 集成聊天处理器
├── frontend/
│   └── views/
│       └── GenSpace.tsx       # 改造为聊天界面
└── scripts/
    └── prepare-python.ps1     # Python环境准备
```

## 核心组件详细说明

### 1. OpenCode AI核心 (ai/目录)

**Provider系统** (`ai/provider/`)
- 支持多AI提供商：OpenAI、Anthropic、Azure、Google等
- 统一API接口，使用`@ai-sdk`库
- 动态模型发现和配置

**LLM处理** (`ai/session/llm.ts`)
- `LLM.stream()`: 核心流式处理函数
- 工具调用支持：function calling实现
- 系统提示词管理
- 温度控制和重试机制

**工具系统** (`ai/tool/`)
- 工具注册表：动态加载工具
- 统一工具接口：`Tool.define()`定义工具
- 权限管理：工具使用权限控制
- 视频编辑工具：基于FFmpeg的工具实现

### 2. 视频编辑工具集

每个工具都遵循OpenCode工具规范：

```typescript
// ai/tool/video/trim.ts
export const TrimVideoTool = Tool.define({
  id: "trim_video",
  description: "Trim video to specified time range",
  parameters: z.object({
    input_file: z.string().describe("Path to input video file"),
    start_time: z.string().describe("Start time in format HH:MM:SS or seconds"),
    end_time: z.string().describe("End time in format HH:MM:SS or seconds"),
    output_file: z.string().optional().describe("Path to output video file")
  }),
  execute: async (args, ctx) => {
    // 调用FFmpeg执行剪辑
    const result = await ffmpeg.trim(args.input_file, args.start_time, args.end_time, args.output_file);
    return {
      title: "Video Trimmed",
      output: `Successfully trimmed video from ${args.start_time} to ${args.end_time}`,
      metadata: { output_path: result.output_path }
    };
  }
});
```

### 3. 聊天式CLI

**命令结构**：
```bash
# 基础命令
jianjicode chat "帮我剪辑视频的前10秒"

# 指定模型
jianjicode chat --model gpt-4 "合并这两个视频文件"

# 交互式模式
jianjicode chat --interactive
```

**CLI工作流**：
1. 解析命令行参数
2. 初始化OpenCode AI系统
3. 调用LLM解析用户命令
4. 执行工具调用
5. 输出结果

### 4. Python集成层

**主要功能**：
- HTTP API端点：`POST /api/chat`
- 子进程管理：调用jianjicode CLI
- 结果解析：解析AI响应并格式化
- 错误处理：捕获和处理执行错误

**API接口**：
```python
# Python后端API
@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    # 调用jianjicode CLI
    result = await run_jianjicode_chat(request.messages)
    return ChatResponse(
        message=result.message,
        tool_calls=result.tool_calls,
        execution_result=result.execution_result
    )
```

### 5. LTX前端改造

**GenSpace改造**：
- 聊天界面：消息列表 + 输入框
- 消息类型：用户消息、AI回复、工具执行结果
- 进度显示：工具执行进度条
- 历史记录：对话历史管理

**UI组件**：
- `ChatMessageList`: 消息列表组件
- `ChatInput`: 聊天输入框
- `ToolExecutionStatus`: 工具执行状态
- `VideoPreview`: 视频预览组件

## 实施计划

### 阶段1: 复制OpenCode AI核心 ✅
- [x] 分析OpenCode AI架构
- [ ] 复制provider、llm、tool等核心模块
- [ ] 配置TypeScript依赖
- [ ] 测试AI核心功能

### 阶段2: 创建视频编辑工具集
- [ ] 基于现有FFmpeg工具创建OpenCode格式工具
- [ ] 实现trim_video、concat_videos等工具
- [ ] 添加工具参数验证和错误处理
- [ ] 测试工具调用流程

### 阶段3: 集成聊天式CLI
- [ ] 扩展jianjicode CLI支持chat命令
- [ ] 集成OpenCode AI解析器
- [ ] 实现工具调用执行流程
- [ ] 测试端到端工作流

### 阶段4: Python后端集成
- [ ] 创建`/api/chat`端点
- [ ] 实现Python调用jianjicode CLI
- [ ] 添加错误处理和日志记录
- [ ] 集成到LTX后端服务包

### 阶段5: LTX前端改造
- [ ] 修改GenSpace为聊天界面
- [ ] 实现消息历史管理
- [ ] 添加工具执行进度显示
- [ ] 集成视频预览功能

### 阶段6: 测试和优化
- [ ] 单元测试和集成测试
- [ ] 性能优化和错误处理
- [ ] 用户体验测试
- [ ] 文档完善

## 依赖管理

### TypeScript依赖
```json
{
  "dependencies": {
    "@ai-sdk/anthropic": "^2.0.0",
    "@ai-sdk/openai": "^2.0.0",
    "@ai-sdk/provider": "^2.0.0",
    "ai": "^3.0.0",
    "zod": "^3.22.0",
    "ffmpeg-static": "^5.2.0"
  }
}
```

### Python依赖
```python
# requirements.txt
fastapi>=0.104.0
pydantic>=2.5.0
uvicorn>=0.24.0
```

## 配置说明

### AI提供商配置
```json
{
  "providers": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "baseURL": "https://api.openai.com/v1"
    },
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}",
      "baseURL": "https://api.anthropic.com"
    }
  },
  "defaultModel": "gpt-4-turbo"
}
```

### 工具配置
```json
{
  "tools": {
    "trim_video": {
      "enabled": true,
      "permissions": ["video.edit"]
    },
    "concat_videos": {
      "enabled": true,
      "permissions": ["video.edit"]
    }
  }
}
```

## 测试策略

### 单元测试
- AI核心功能测试
- 工具执行测试
- API端点测试

### 集成测试
- 端到端聊天工作流测试
- Python集成测试
- 前端集成测试

### 性能测试
- LLM响应时间测试
- 视频处理性能测试
- 并发请求处理测试

## 部署指南

### 开发环境
1. 安装Node.js和Python依赖
2. 配置AI API密钥
3. 安装FFmpeg二进制文件
4. 启动开发服务器

### 生产环境
1. 构建TypeScript项目
2. 打包FFmpeg二进制文件
3. 配置环境变量
4. 部署LTX Desktop应用

## 故障排除

### 常见问题
1. **AI API连接失败**: 检查API密钥和网络连接
2. **FFmpeg执行错误**: 检查FFmpeg二进制文件和路径
3. **工具调用失败**: 检查工具参数和权限配置
4. **内存不足**: 优化视频处理参数和批处理大小

### 日志和监控
- 启用详细日志记录
- 监控AI API使用情况
- 跟踪视频处理性能
- 错误报告和警报

## 后续开发

### 功能扩展
1. **更多视频编辑工具**: 添加转场效果、字幕添加、色彩校正等
2. **批处理支持**: 批量处理多个视频文件
3. **模板系统**: 预定义编辑模板和预设
4. **插件系统**: 支持第三方工具扩展

### 性能优化
1. **缓存机制**: 缓存视频分析结果
2. **并行处理**: 支持并行视频处理
3. **硬件加速**: 利用GPU加速视频处理
4. **增量处理**: 避免重复处理相同内容

### 用户体验
1. **智能建议**: AI建议编辑操作
2. **预览系统**: 实时编辑预览
3. **协作功能**: 多人协作编辑
4. **版本控制**: 编辑历史版本管理

---

**最后更新**: 2026-03-31
**版本**: 1.0
**维护者**: jianjicode开发团队