/**
 * Video-RAG 视频检索工具
 * 用于搜索视频中与查询相关的内容片段
 */

import z from "zod"
import { Tool } from "./tool.js"

export interface VideoRagSearchResult {
  query: string
  query_type: string
  enhanced_prompt: string
  retrieval_results: {
    context: string
    documents: Array<{
      id: string
      text: string
      timestamp?: number
      score: number
    }>
    scores: number[]
    timestamps: number[]
    retrieval_type: string
  }
  document_count: number
  average_score: number
  processing_time: number
}

export const VideoRagSearchTool = Tool.defineLtxTool("video_rag_search", {
  description:
    "【视频RAG检索】通过视频内容检索工具搜索视频中与查询相关的内容片段。当用户询问视频内容、事件、对象、时间点等问题时使用此工具。需要 AI 模型理解视频语义时用此工具，与 ai_video_analysis（AI语义分析）和 cv_analysis（计算机视觉：深度/姿态）功能互补",
  parameters: z.object({
    query: z.string().describe("搜索查询词，描述您想在视频中查找的内容"),
    top_k: z.number().optional().default(5).describe("返回结果数量，默认5"),
  }),

  execute: async (args, ctx) => {
    try {
      const response = await fetch('http://localhost:8001/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: args.query,
          top_k: args.top_k || 5
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const results: VideoRagSearchResult = await response.json()
      const formatted = formatResults(results)

      return {
        title: "Video-RAG 检索结果",
        metadata: { error: false, success: true, document_count: results.document_count },
        output: formatted,
        attachments: [],
      }
    } catch (error: any) {
      return {
        title: "Video-RAG 检索失败",
        metadata: { error: true },
        output: `❌ 视频检索失败: ${error instanceof Error ? error.message : '未知错误'}`,
        attachments: [],
      }
    }
  },
})

function formatResults(results: VideoRagSearchResult): string {
  if (results.document_count === 0) {
    return '未找到与查询相关的视频内容。'
  }

  let formatted = `找到 ${results.document_count} 个相关结果：\n\n`

  results.retrieval_results.documents.forEach((doc, index) => {
    const timestamp = doc.timestamp ? ` @ ${doc.timestamp.toFixed(1)}秒` : ''
    formatted += `${index + 1}. ${doc.text}${timestamp} (相似度: ${(doc.score * 100).toFixed(1)}%)\n\n`
  })

  formatted += `平均相似度: ${(results.average_score * 100).toFixed(1)}%\n处理时间: ${results.processing_time.toFixed(2)}秒`

  return formatted
}