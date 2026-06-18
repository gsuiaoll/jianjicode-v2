#!/usr/bin/env tsx
/**
 * jianjicode 快剪管道 — 直接调工具，不靠 AI
 */

const BASE = 'D:/code/jianjicode-5/jianjicode/tests/outputs'
const SRC = 'D:/code/jianjicode-5/tests/13421377767745425.mp4'
const OUT = 'D:/code/jianjicode-5/tests/outputs/fast_cut_v2.mp4'

const C1 = `${BASE}/c1.mp4`
const C2 = `${BASE}/c2.mp4`
const C3 = `${BASE}/c3.mp4`
const S1 = `${BASE}/s1.mp4`
const S2 = `${BASE}/s2.mp4`
const S3 = `${BASE}/s3.mp4`
const M1 = `${BASE}/m1.mp4`

async function main() {
  const { toolRegistry, initializeTools } = await import('./src/registry/tool_registry.js')
  await initializeTools()

  const getTool = async (name: string) => {
    const t = await toolRegistry.getInitializedTool(name)
    if (!t) throw new Error(`${name} not found`)
    return t
  }

  const ctx = {} as any

  // ==========================================
  // Step 1: 裁 c3 (44-51s)
  // ==========================================
  console.log('[1/4] 裁剪 c3 (44-51s)...')
  const ffmpegTool = await getTool('ffmpeg')
  let r = await ffmpegTool.execute({
    command: '裁剪结尾片段',
    operation: 'trim',
    input: SRC,
    output: C3,
    start_time: '44',
    end_time: '51',
    allow_overwrite: true,
  }, ctx)
  console.log(r.metadata?.error ? `  ❌ ${r.output}` : '  ✅ c3 裁剪成功')

  // ==========================================
  // Step 2: 变速
  // ==========================================
  console.log('[2/4] 变速处理...')
  const speedTool = await getTool('video_speed')

  r = await speedTool.execute({
    input: C1, output: S1,
    speed: 1.5, adjust_audio: true, preserve_pitch: true, allow_overwrite: true,
  }, ctx)
  console.log(r.metadata?.error ? `  ❌ c1→s1` : '  ✅ c1→s1 (1.5x)')

  r = await speedTool.execute({
    input: C2, output: S2,
    speed: 0.6, adjust_audio: true, preserve_pitch: true, allow_overwrite: true,
  }, ctx)
  console.log(r.metadata?.error ? `  ❌ c2→s2` : '  ✅ c2→s2 (0.6x)')

  r = await speedTool.execute({
    input: C3, output: S3,
    speed: 1.3, adjust_audio: true, preserve_pitch: true, allow_overwrite: true,
  }, ctx)
  console.log(r.metadata?.error ? `  ❌ c3→s3` : '  ✅ c3→s3 (1.3x)')

  // ==========================================
  // Step 3: 转场拼接
  // ==========================================
  console.log('[3/4] 转场拼接...')
  const transTool = await getTool('video_transition')

  r = await transTool.execute({
    input1: S1, input2: S2, output: M1,
    transition_type: 'slide_left', duration: 0.6,
    audio_transition: 'crossfade', allow_overwrite: true,
  }, ctx)
  console.log(r.metadata?.error ? `  ❌ s1+s2 → m1` : '  ✅ s1+s2 → m1 (slide_left)')

  r = await transTool.execute({
    input1: M1, input2: S3, output: OUT,
    transition_type: 'fade_black', duration: 0.5,
    audio_transition: 'crossfade', allow_overwrite: true,
  }, ctx)
  console.log(r.metadata?.error ? `  ❌ m1+s3 → final` : '  ✅ m1+s3 → final (fade_black)')

  // ==========================================
  // Step 4: 验证
  // ==========================================
  console.log('[4/4] 验证输出...')
  const fs = await import('fs')
  if (fs.existsSync(OUT)) {
    const stat = fs.statSync(OUT)
    console.log(`  📁 ${OUT}`)
    console.log(`  📏 ${(stat.size / 1024).toFixed(0)} KB`)
  } else {
    console.log(`  ❌ 文件不存在: ${OUT}`)
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
