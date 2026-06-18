let serverUrl = "http://localhost:3001"
let currentVideoPath = null
let isPlaying = false
let eventSource = null
let currentThoughtStartTime = null
let isStreaming = false
let currentStreamingMessage = null

const MESSAGE_TYPES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
  TOOL: 'tool'
}

async function init() {
  if (window.electronAPI) {
    serverUrl = await window.electronAPI.getServerUrl()
    window.electronAPI.onFileOpened((filePath) => {
      loadVideo(filePath)
    })
  }

  checkServerConnection()
  setupEventListeners()
  loadChatHistory()
}

async function checkServerConnection() {
  try {
    const response = await fetch(`${serverUrl}/health`)
    if (response.ok) {
      updateServerStatus(true)
    } else {
      updateServerStatus(false)
    }
  } catch {
    updateServerStatus(false)
  }
}

function updateServerStatus(connected) {
  const dot = document.getElementById("serverStatus")
  const text = document.getElementById("serverStatusText")
  if (connected) {
    dot.className = "status-dot"
    text.textContent = "已连接"
  } else {
    dot.className = "status-dot error"
    text.textContent = "未连接"
  }
}

function setupEventListeners() {
  document.getElementById("openFileBtn").addEventListener("click", openFile)
  document.getElementById("aiAssistantBtn").addEventListener("click", () => {
    document.querySelector('[data-tab="chat"]').click()
    document.getElementById("chatInput").focus()
  })

  document.querySelectorAll(".sidebar-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".sidebar-tab").forEach(t => t.classList.remove("active"))
      tab.classList.add("active")

      const tabName = tab.dataset.tab
      document.getElementById("chatContainer").style.display = tabName === "chat" ? "flex" : "none"
      document.getElementById("toolsPanel").classList.toggle("active", tabName === "tools")
    })
  })

  document.querySelectorAll(".tool-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tool = btn.dataset.tool
      document.getElementById("chatInput").value = `/tool ${tool}`
      document.getElementById("chatInput").focus()
    })
  })

  const chatInput = document.getElementById("chatInput")
  chatInput.addEventListener("input", autoResize)
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  })

  document.getElementById("sendBtn").addEventListener("click", sendMessage)
  chatInput.addEventListener("input", () => {
    document.getElementById("sendBtn").disabled = !chatInput.value.trim()
  })

  const videoContainer = document.getElementById("videoContainer")
  videoContainer.addEventListener("dragover", (e) => {
    e.preventDefault()
    videoContainer.style.opacity = "0.7"
  })
  videoContainer.addEventListener("dragleave", () => {
    videoContainer.style.opacity = "1"
  })
  videoContainer.addEventListener("drop", (e) => {
    e.preventDefault()
    videoContainer.style.opacity = "1"
    const files = e.dataTransfer.files
    if (files.length > 0) {
      loadVideo(files[0].path)
    }
  })

  setupVideoControls()
}

function setupVideoControls() {
  const video = document.getElementById("videoPlayer")
  const playPauseBtn = document.getElementById("playPauseBtn")
  const stopBtn = document.getElementById("stopBtn")
  const skipBackBtn = document.getElementById("skipBackBtn")
  const skipForwardBtn = document.getElementById("skipForwardBtn")
  const muteBtn = document.getElementById("muteBtn")
  const timelineTrack = document.getElementById("timelineTrack")

  playPauseBtn.addEventListener("click", togglePlayPause)
  stopBtn.addEventListener("click", () => {
    video.currentTime = 0
    video.pause()
    updatePlayState(false)
  })
  skipBackBtn.addEventListener("click", () => {
    video.currentTime = Math.max(0, video.currentTime - 5)
  })
  skipForwardBtn.addEventListener("click", () => {
    video.currentTime = Math.min(video.duration, video.currentTime + 5)
  })
  muteBtn.addEventListener("click", () => {
    video.muted = !video.muted
    updateVolumeIcon(video.muted)
  })
  timelineTrack.addEventListener("click", (e) => {
    const rect = timelineTrack.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    video.currentTime = percent * video.duration
  })

  video.addEventListener("timeupdate", updateTimeline)
  video.addEventListener("play", () => updatePlayState(true))
  video.addEventListener("pause", () => updatePlayState(false))
  video.addEventListener("ended", () => updatePlayState(false))
  video.addEventListener("loadedmetadata", () => {
    document.getElementById("duration").textContent = formatTime(video.duration)
  })
}

function togglePlayPause() {
  const video = document.getElementById("videoPlayer")
  if (video.paused) {
    video.play()
  } else {
    video.pause()
  }
}

function updatePlayState(playing) {
  isPlaying = playing
  const icon = document.getElementById("playIcon")
  if (playing) {
    icon.innerHTML = '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>'
  } else {
    icon.innerHTML = '<path d="M8 5v14l11-7z"/>'
  }
}

function updateVolumeIcon(muted) {
  const icon = document.getElementById("volumeIcon")
  if (muted) {
    icon.innerHTML = '<path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
  } else {
    icon.innerHTML = '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/>'
  }
}

function updateTimeline() {
  const video = document.getElementById("videoPlayer")
  const progress = document.getElementById("timelineProgress")
  const playhead = document.getElementById("timelinePlayhead")

  if (video.duration) {
    const percent = (video.currentTime / video.duration) * 100
    progress.style.width = `${percent}%`
    playhead.style.left = `${percent}%`
    document.getElementById("currentTime").textContent = formatTime(video.currentTime)
  }
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
}

async function openFile() {
  if (window.electronAPI) {
    const filePath = await window.electronAPI.selectVideoFile()
    if (filePath) {
      loadVideo(filePath)
    }
  }
}

function loadVideo(filePath) {
  currentVideoPath = filePath
  const video = document.getElementById("videoPlayer")
  const placeholder = document.getElementById("videoPlaceholder")
  const controls = document.getElementById("videoControls")
  const timeline = document.getElementById("timeline")

  video.src = `file://${filePath}`
  video.style.display = "block"
  placeholder.style.display = "none"
  controls.style.display = "flex"
  timeline.style.display = "flex"

  const fileName = filePath.split(/[/\\]/).pop()
  document.getElementById("fileName").textContent = fileName
  document.getElementById("fileInfo").style.display = "flex"

  video.onloadedmetadata = () => {
    document.getElementById("videoInfo").textContent =
      `${video.videoWidth}x${video.videoHeight} | ${formatTime(video.duration)}`
  }
}

function autoResize() {
  const textarea = event.target
  textarea.style.height = "auto"
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px"
}

async function sendMessage() {
  const input = document.getElementById("chatInput")
  const message = input.value.trim()
  if (!message) return

  addMessage(MESSAGE_TYPES.USER, message)
  input.value = ""
  input.style.height = "auto"
  document.getElementById("sendBtn").disabled = true

  currentThoughtStartTime = Date.now()
  addTypingIndicator()

  try {
    const response = await fetch(`${serverUrl}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        args: currentVideoPath ? { videoPath: currentVideoPath } : {}
      })
    })

    removeTypingIndicator()

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let thinkingTime = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (line.startsWith("data:")) {
          try {
            const data = JSON.parse(line.slice(5))
            handleStreamData(data)
          } catch (e) {
            console.log("Skipping malformed JSON")
          }
        }
      }
    }

    if (currentStreamingMessage) {
      const cursor = currentStreamingMessage.querySelector(".streaming-cursor")
      if (cursor) cursor.remove()
      isStreaming = false
      currentStreamingMessage = null
    }

    saveChatHistory()
  } catch (error) {
    removeTypingIndicator()
    if (currentStreamingMessage) {
      const cursor = currentStreamingMessage.querySelector(".streaming-cursor")
      if (cursor) cursor.remove()
    }
    isStreaming = false
    currentStreamingMessage = null
    addSystemMessage(`连接失败: ${error.message}`)
    updateServerStatus(false)
  }
}

function handleStreamData(data) {
  if (data.event === "stream") {
    const event = typeof data.data === "string" ? JSON.parse(data.data) : data.data
    
    if (event.type === "text_delta" || event.type === "content_block_delta") {
      const thinkingTime = currentThoughtStartTime ? Math.round((Date.now() - currentThoughtStartTime) / 1000) : 0
      
      if (!currentStreamingMessage) {
        currentStreamingMessage = addAssistantMessage("", thinkingTime)
        isStreaming = true
      }
      
      const text = event.text || (event.content_block?.content || "")
      appendToStreamingMessage(text)
      
    } else if (event.type === "tool_call") {
      addToolCall(event.tool_call)
    } else if (event.type === "tool_result") {
      updateToolCall(event.tool_call.id, event.result)
    } else if (event.type === "nudge") {
      showNudge(event.nudge)
    } else if (event.type === "clarification") {
      showClarificationModal(event.clarification)
    }
  } else if (data.event === "progress") {
    const progressData = typeof data.data === "string" ? JSON.parse(data.data) : data.data
    showProgress(progressData.step, progressData.detail)
  } else if (data.event === "result") {
    const result = typeof data.data === "string" ? JSON.parse(data.data) : data.data
    if (result.success && currentVideoPath) {
      addSystemMessage("视频编辑完成！")
    } else if (!result.success) {
      addSystemMessage(`错误: ${result.error}`)
    }
  }
}

function addMessage(role, content) {
  const container = document.getElementById("chatMessages")
  clearEmptyState(container)

  const messageElement = document.createElement("div")
  messageElement.className = `chat-message ${role}`
  
  const markerClass = role === MESSAGE_TYPES.USER ? 'user' : 
                      role === MESSAGE_TYPES.ASSISTANT ? 'assistant' : 
                      role === MESSAGE_TYPES.SYSTEM ? 'system' : 'tool'

  messageElement.innerHTML = `
    <div class="message-marker ${markerClass}"></div>
    <div class="avatar">${getAvatarLabel(role)}</div>
    <div class="content">
      <div class="message-content">${formatMessageContent(content)}</div>
    </div>
  `
  container.appendChild(messageElement)
  scrollToBottom()
  return messageElement
}

function addAssistantMessage(content, thoughtTime) {
  const container = document.getElementById("chatMessages")
  clearEmptyState(container)

  const messageElement = document.createElement("div")
  messageElement.className = `chat-message ${MESSAGE_TYPES.ASSISTANT}`

  const thoughtTimeHtml = thoughtTime > 0 ? `
    <div class="thought-time">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
      Thought for ${thoughtTime}s
    </div>
  ` : ''

  messageElement.innerHTML = `
    <div class="message-marker assistant"></div>
    <div class="avatar">AI</div>
    <div class="content">
      ${thoughtTimeHtml}
      <div class="message-content streaming-content">${formatMessageContent(content)}<span class="streaming-cursor"></span></div>
    </div>
  `
  container.appendChild(messageElement)
  scrollToBottom()
  return messageElement
}

function appendToStreamingMessage(text) {
  if (!currentStreamingMessage) return

  const contentElement = currentStreamingMessage.querySelector(".streaming-content")
  if (contentElement) {
    const cursor = contentElement.querySelector(".streaming-cursor")
    contentElement.innerHTML = formatMessageContent(contentElement.textContent + text) + '<span class="streaming-cursor"></span>'
    scrollToBottom()
  }
}

function addSystemMessage(content) {
  const container = document.getElementById("chatMessages")
  clearEmptyState(container)

  const messageElement = document.createElement("div")
  messageElement.className = `chat-message ${MESSAGE_TYPES.SYSTEM}`

  messageElement.innerHTML = `
    <div class="message-marker system"></div>
    <div class="avatar">SYSTEM</div>
    <div class="content" style="background: var(--bg-input); border-left: 3px solid var(--warning);">
      <div class="message-content">${formatMessageContent(content)}</div>
    </div>
  `
  container.appendChild(messageElement)
  scrollToBottom()
}

function formatMessageContent(content) {
  if (!content) return ''
  
  let formatted = escapeHtml(content)
  
  formatted = formatted.replace(/`([^`]+)`/g, '<code class="code-path">$1</code>')
  formatted = formatted.replace(/\b(Read|Write|Edit|Execute|Check|Verify)\b/g, '<span class="tool-action">$1</span>')
  formatted = formatted.replace(/\n/g, '<br>')
  
  return formatted
}

function clearEmptyState(container) {
  const emptyState = container.querySelector(".empty-state")
  if (emptyState) emptyState.remove()
}

function getAvatarLabel(role) {
  switch (role) {
    case MESSAGE_TYPES.USER: return "U"
    case MESSAGE_TYPES.ASSISTANT: return "AI"
    case MESSAGE_TYPES.SYSTEM: return "SYS"
    case MESSAGE_TYPES.TOOL: return "TOOL"
    default: return "AI"
  }
}

function addToolCall(toolCall) {
  const container = document.getElementById("chatMessages")
  const lastMessage = container.lastElementChild
  if (!lastMessage || !lastMessage.classList.contains(MESSAGE_TYPES.ASSISTANT)) {
    return
  }

  let toolCalls = lastMessage.querySelector(".tool-calls")
  if (!toolCalls) {
    toolCalls = document.createElement("div")
    toolCalls.className = "tool-calls"
    lastMessage.appendChild(toolCalls)
  }

  const div = document.createElement("div")
  div.className = "tool-call executing"
  div.id = `tool-${toolCall.id || Date.now()}`
  
  const argsHtml = toolCall.arguments ? 
    `<span style="color: var(--text-secondary); font-size: 11px; margin-left: 4px;">
      ${JSON.stringify(toolCall.arguments)}
    </span>` : ''

  div.innerHTML = `
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 6v6l4 2"/>
    </svg>
    <span><span class="tool-action">${toolCall.name}</span>${argsHtml}</span>
  `
  toolCalls.appendChild(div)
  scrollToBottom()
}

function updateToolCall(toolId, result) {
  const div = document.getElementById(`tool-${toolId}`)
  if (div) {
    div.classList.remove("executing")
    div.classList.add(result.success ? "success" : "error")
    
    const resultText = result.success ? 
      (result.output?.title || result.output?.message || "完成") : 
      (result.error || "失败")

    div.innerHTML = `
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        ${result.success ? 
          '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/>' : 
          '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'}
      </svg>
      <span>${resultText}</span>
    `
  }
}

function addTypingIndicator() {
  const container = document.getElementById("chatMessages")
  clearEmptyState(container)

  const div = document.createElement("div")
  div.className = `chat-message ${MESSAGE_TYPES.ASSISTANT}`
  div.id = "typing-indicator"
  div.innerHTML = `
    <div class="message-marker assistant"></div>
    <div class="avatar">AI</div>
    <div class="content">
      <div class="typing-indicator-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `
  container.appendChild(div)
  scrollToBottom()
}

function removeTypingIndicator() {
  const indicator = document.getElementById("typing-indicator")
  if (indicator) indicator.remove()
}

function showProgress(step, detail) {
  const container = document.getElementById("chatMessages")
  const lastMessage = container.lastElementChild
  if (lastMessage) {
    const content = lastMessage.querySelector(".content")
    if (content) {
      content.innerHTML = `<em style="color: var(--text-secondary);">${escapeHtml(step)}: ${escapeHtml(detail || "")}</em>`
    }
  }
}

function showNudge(nudge) {
  addSystemMessage(`💡 建议: ${nudge.message}`)
}

function showClarificationModal(clarification) {
  const overlay = document.createElement("div")
  overlay.className = "option-modal-overlay"
  overlay.id = "clarification-modal"

  const modal = document.createElement("div")
  modal.className = "option-modal"

  const optionsHtml = clarification.options.map((option, index) => {
    const letter = String.fromCharCode(65 + index)
    return `
      <div class="option-item" data-option="${option}">
        <span class="option-letter">${letter}</span>
        <span class="option-text">${escapeHtml(option)}</span>
      </div>
    `
  }).join('')

  modal.innerHTML = `
    <div class="option-modal-title">需要进一步确认</div>
    <div class="option-modal-question">${escapeHtml(clarification.question)}</div>
    <div class="option-list">${optionsHtml}</div>
    <div class="option-modal-actions">
      <button class="option-modal-btn secondary" id="clarification-continue">都不是，我继续描述</button>
      <button class="option-modal-btn primary" id="clarification-confirm" disabled>确认选择</button>
    </div>
  `

  overlay.appendChild(modal)
  document.body.appendChild(overlay)

  let selectedOption = null

  modal.querySelectorAll(".option-item").forEach(item => {
    item.addEventListener("click", () => {
      modal.querySelectorAll(".option-item").forEach(i => i.classList.remove("selected"))
      item.classList.add("selected")
      selectedOption = item.dataset.option
      document.getElementById("clarification-confirm").disabled = false
    })
  })

  document.getElementById("clarification-confirm").addEventListener("click", () => {
    if (selectedOption) {
      sendClarificationResponse(selectedOption)
      overlay.remove()
    }
  })

  document.getElementById("clarification-continue").addEventListener("click", () => {
    overlay.remove()
    document.getElementById("chatInput").focus()
  })

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.remove()
    }
  })
}

function sendClarificationResponse(option) {
  addMessage(MESSAGE_TYPES.USER, option)
  
  fetch(`${serverUrl}/chat/clarify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response: option })
  }).then(() => {
    addTypingIndicator()
  }).catch(() => {
    addSystemMessage("发送确认失败")
  })
}

function scrollToBottom() {
  const container = document.getElementById("chatMessages")
  setTimeout(() => {
    container.scrollTop = container.scrollHeight
  }, 50)
}

function escapeHtml(text) {
  const div = document.createElement("div")
  div.textContent = text
  return div.innerHTML
}

function saveChatHistory() {
  const messages = document.getElementById("chatMessages")
  const history = []
  messages.querySelectorAll(".chat-message").forEach(msg => {
    const role = msg.classList.contains(MESSAGE_TYPES.USER) ? MESSAGE_TYPES.USER : MESSAGE_TYPES.ASSISTANT
    const content = msg.querySelector(".message-content")?.textContent || ""
    history.push({ role, content })
  })
  try {
    localStorage.setItem("jianjicode-chat-history", JSON.stringify(history.slice(-50)))
  } catch {}
}

function loadChatHistory() {
  try {
    const history = JSON.parse(localStorage.getItem("jianjicode-chat-history") || "[]")
    const container = document.getElementById("chatMessages")
    if (history.length === 0) return

    container.innerHTML = ""
    history.forEach(msg => {
      addMessage(msg.role, msg.content)
    })
  } catch {}
}

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "o") {
    e.preventDefault()
    openFile()
  }
})

document.addEventListener("DOMContentLoaded", init)