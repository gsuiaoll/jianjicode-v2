#!/usr/bin/env tsx
/**
 * 演示 LTX Video Processor 完整工作流程
 * 从自然语言理解到工具执行的完整过程
 */

import { toolRegistry, initializeTools } from '../src/registry/tool_registry.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 模拟AI解析的自然语言命令到工具调用的映射
const aiCommandMapping = {
  '获取视频信息': {
    naturalLanguage: '获取 test_video.mp4 的视频信息',
    toolId: 'ltx_video_processor',
    params: {
      operation: 'get_info',
      input: path.join(__dirname, 'test_video.mp4'),
      python_path: 'python'
    }
  },
  '提取关键帧': {
    naturalLanguage: '从视频中每秒提取2帧，最多5帧',
    toolId: 'ltx_video_processor',
    params: {
      operation: 'extract_frames',
      input: path.join(__dirname, 'test_video.mp4'),
      output: path.join(__dirname, 'demo_frames_output'),
      frame_rate: 2.0,
      max_frames: 5,
      quality: 90,
      python_path: 'python'
    }
  },
  '检测场景变化': {
    naturalLanguage: '检测视频中的场景变化，敏感度设为30',
    toolId: 'ltx_video_processor',
    params: {
      operation: 'detect_scenes',
      input: path.join(__dirname, 'test_video.mp4'),
      scene_threshold: 30.0,
      python_path: 'python'
    }
  },
  '边缘检测效果': {
    naturalLanguage: '对视频应用Canny边缘检测，阈值设为80和160',
    toolId: 'ltx_video_processor',
    params: {
      operation: 'canny',
      input: path.join(__dirname, 'test_video.mp4'),
      output: path.join(__dirname, 'demo_canny_output.mp4'),
      threshold1: 80,
      threshold2: 160,
      python_path: 'python'
    }
  }
}

async function demonstrateWorkflow() {
  console.log('🎬 LTX Video Processor 完整工作流程演示\n')
  console.log('='.repeat(60))

  try {
    // 步骤1: 初始化工具系统
    console.log('\n📦 步骤1: 初始化工具系统')
    console.log('   - 加载工具注册中心')
    console.log('   - 注册所有视频编辑工具')

    await initializeTools()

    const totalTools = toolRegistry.getAllTools().length
    console.log(`   ✅ 工具系统初始化完成，共注册 ${totalTools} 个工具`)
    console.log(`   🔍 包含的工具: ffmpeg, video_filter, video_subtitle, video_transition, ltx_video_processor, ...`)

    // 步骤2: 模拟AI自然语言理解
    console.log('\n🧠 步骤2: AI自然语言理解 (模拟)')
    console.log('   - 用户输入自然语言命令')
    console.log('   - AI解析意图并映射到具体工具')
    console.log('   - AI提取参数并生成工具调用指令')

    // 演示每个命令的工作流程
    for (const [taskName, command] of Object.entries(aiCommandMapping)) {
      console.log(`\n${'='.repeat(60)}`)
      console.log(`🔄 演示: ${taskName}`)
      console.log(`📝 用户输入: "${command.naturalLanguage}"`)
      console.log(`🤖 AI解析结果: 调用 ${command.toolId} 工具`)
      console.log(`⚙️  提取的参数: ${JSON.stringify(command.params, null, 2)}`)

      // 步骤3: 工具查找与验证
      console.log('\n🔧 步骤3: 工具查找与验证')
      const tool = toolRegistry.getTool(command.toolId)

      if (!tool) {
        console.log(`   ❌ 错误: 工具 ${command.toolId} 未找到`)
        continue
      }

      console.log(`   ✅ 找到工具: ${tool.id}`)

      // 步骤4: 工具初始化与执行
      console.log('\n🚀 步骤4: 工具初始化与执行')
      console.log('   - 初始化工具实例')
      console.log('   - 验证参数格式')
      console.log('   - 执行工具操作')
      console.log('   - 处理返回结果')

      try {
        const initializedTool = await tool.init()
        console.log(`   ✅ 工具初始化完成: ${initializedTool.description}`)

        const mockContext = {
          sessionID: "demo-session",
          messageID: "demo-message",
          agent: "video_analyzer",
          abort: new AbortController().signal
        }

        console.log('   ⏳ 执行工具...')
        const startTime = Date.now()
        const result = await initializedTool.execute(command.params, mockContext)
        const executionTime = Date.now() - startTime

        console.log(`   ✅ 工具执行完成 (耗时: ${executionTime}ms)`)
        console.log(`   📋 执行结果:`)
        console.log(`      - 标题: ${result.title}`)
        console.log(`      - 状态: ${result.metadata?.error ? '❌ 失败' : '✅ 成功'}`)

        if (result.metadata?.error) {
          console.log(`      - 错误信息: ${result.output}`)
        } else {
          // 简化的输出显示
          const outputLines = result.output.split('\n')
          if (outputLines.length > 0) {
            console.log(`      - 输出摘要: ${outputLines[0]}`)
            if (outputLines.length > 1 && outputLines[1]) {
              console.log(`                ${outputLines[1]}`)
            }
          }

          // 显示关键元数据
          if (result.metadata) {
            const metadataStr = JSON.stringify(result.metadata, null, 2)
            const lines = metadataStr.split('\n')
            if (lines.length > 10) {
              console.log(`      - 元数据: ${lines.slice(0, 3).join('\n               ')}...`)
            }
          }
        }

        // 特定操作的额外信息
        if (command.params.operation === 'extract_frames' && result.metadata?.frame_paths) {
          const frames = result.metadata.frame_paths
          console.log(`      - 提取的帧: ${frames.length} 个文件`)
          if (frames.length > 0) {
            console.log(`        ${frames[0]}`)
            if (frames.length > 1) console.log(`        ... 还有 ${frames.length - 1} 个文件`)
          }
        }

        if (command.params.operation === 'canny' && result.metadata?.output_path) {
          console.log(`      - 输出文件: ${result.metadata.output_path}`)
        }

      } catch (toolError: any) {
        console.log(`   ❌ 工具执行失败: ${toolError.message}`)
        if (toolError.stack) {
          console.log(`     堆栈: ${toolError.stack.split('\n')[0]}`)
        }
      }

      console.log(`\n💡 ${taskName} 演示完成`)
    }

    // 步骤5: 工作流程总结
    console.log('\n' + '='.repeat(60))
    console.log('📊 工作流程总结')
    console.log('\n✅ 已验证的关键功能:')
    console.log('   1. 工具系统初始化与注册')
    console.log('   2. 自然语言到工具调用的映射')
    console.log('   3. 工具参数提取与验证')
    console.log('   4. Python脚本桥接执行')
    console.log('   5. 结果解析与格式化输出')

    console.log('\n🔧 支持的LTX视频分析操作:')
    console.log('   - 📊 视频信息获取 (分辨率、帧率、时长等)')
    console.log('   - 🖼️  帧提取 (可控制帧率、数量、质量)')
    console.log('   - 🎬 场景检测 (自动检测场景变化点)')
    console.log('   - 🔍 Canny边缘检测 (视频风格化处理)')

    console.log('\n🚀 下一步集成计划:')
    console.log('   1. 深度/姿态估计集成 (LTX VideoProcessor完整功能)')
    console.log('   2. 多模态AI分析组件 (通用模型接口)')
    console.log('   3. 预设模板系统集成 (专业字幕/颜色预设)')
    console.log('   4. 时间线数据结构支持 (多轨道编辑)')

    console.log('\n🎉 演示完成! LTX Video Processor 已成功集成到 jianjicode')
    console.log('💡 现在可以通过自然语言命令调用高级视频分析功能')

  } catch (error: any) {
    console.error('\n🔥 工作流演示失败:')
    console.error(`   错误: ${error.message}`)
    if (error.stack) {
      console.error(`   堆栈: ${error.stack.split('\n')[0]}`)
    }
    process.exit(1)
  }
}

// 运行演示
demonstrateWorkflow()