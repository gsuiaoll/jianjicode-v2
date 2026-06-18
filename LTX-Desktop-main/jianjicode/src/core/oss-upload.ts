/**
 * DashScope OSS 临时文件上传模块
 *
 * 用于将大视频文件上传到阿里云 OSS 临时存储，
 * 获取 oss:// URL 后传给千问多模态模型直接分析。
 *
 * 最大文件: 2GB, 有效期: 48小时
 */

import { createReadStream } from "fs"
import { statSync } from "fs"
import { basename } from "path"

const DASHSCOPE_HOST = "https://dashscope.aliyuncs.com"

interface OssCredentials {
  oss_access_key_id: string
  signature: string
  policy: string
  upload_dir: string
  upload_host: string
  x_oss_object_acl: string
  x_oss_forbid_overwrite: string
}

interface UploadResult {
  ossUrl: string
  httpUrl: string
  fileName: string
  fileSize: number
}

export async function uploadFileToOss(
  filePath: string,
  model: string,
  apiKey: string,
): Promise<UploadResult> {
  const fileStat = statSync(filePath)
  const fileName = basename(filePath)

  // 1. 获取 OSS 上传凭证
  const policyUrl = `${DASHSCOPE_HOST}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`
  const policyResp = await fetch(policyUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!policyResp.ok) {
    const errText = await policyResp.text().catch(() => "")
    throw new Error(
      `OSS 凭证获取失败 (${policyResp.status}): ${errText.slice(0, 300)}`,
    )
  }

  const policyBody = await policyResp.json()
  const cred: OssCredentials = policyBody.data ?? policyBody

  // 2. 直传文件到 OSS
  const formData = new FormData()
  formData.append("key", `${cred.upload_dir}/${fileName}`)
  formData.append("policy", cred.policy)
  formData.append("signature", cred.signature)
  formData.append("OSSAccessKeyId", cred.oss_access_key_id)
  formData.append("success_action_status", "200")
  formData.append("x-oss-object-acl", cred.x_oss_object_acl)
  formData.append("x-oss-forbid-overwrite", cred.x_oss_forbid_overwrite)

  const ext = fileName.split(".").pop()?.toLowerCase() || "mp4"
  const mimeMap: Record<string, string> = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    webm: "video/webm",
    mkv: "video/x-matroska",
    flv: "video/x-flv",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  }
  formData.append("x-oss-content-type", mimeMap[ext] || "application/octet-stream")

  // Node.js: 直接读文件流附加到 FormData
  const { readFileSync } = await import("fs")
  const fileBuffer = readFileSync(filePath)
  formData.append("file", new Blob([fileBuffer], { type: mimeMap[ext] || "application/octet-stream" }), fileName)

  const uploadResp = await fetch(cred.upload_host, {
    method: "POST",
    body: formData,
  })

  if (!uploadResp.ok) {
    const errText = await uploadResp.text().catch(() => "")
    throw new Error(
      `OSS 上传失败 (${uploadResp.status}): ${errText.slice(0, 300)}`,
    )
  }

  const ossUrl = `oss://${cred.upload_dir}/${fileName}`
  const httpUrl = `${cred.upload_host}/${cred.upload_dir}/${fileName}`

  return {
    ossUrl,
    httpUrl,
    fileName,
    fileSize: fileStat.size,
  }
}
