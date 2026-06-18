// ── 快捷键定义（移植自 LTX keyboard-shortcuts.ts）──

/**
 * @typedef {{ key: string, ctrl?: boolean, meta?: boolean, shift?: boolean, alt?: boolean }} KeyCombo
 * @typedef {Record<string, KeyCombo[]>} KeyboardLayout
 */

/** @type {Record<string, { label: string, category: string }>} */
const ACTION_REGISTRY = {
  // Transport
  "transport.playPause":      { label: "播放 / 暂停", category: "Transport" },
  "transport.shuttleReverse": { label: "倒放", category: "Transport" },
  "transport.shuttleStop":    { label: "停止", category: "Transport" },
  "transport.shuttleForward": { label: "快进", category: "Transport" },
  "transport.stepBackward":   { label: "后退一帧", category: "Transport" },
  "transport.stepForward":    { label: "前进一帧", category: "Transport" },
  "transport.jumpBackward":   { label: "后退一秒", category: "Transport" },
  "transport.jumpForward":    { label: "前进一秒", category: "Transport" },
  "transport.goToStart":      { label: "跳到开头", category: "Transport" },
  "transport.goToEnd":        { label: "跳到结尾", category: "Transport" },
  "transport.toggleMute":     { label: "切换静音", category: "Transport" },

  // Editing
  "edit.undo":      { label: "撤销", category: "Editing" },
  "edit.redo":      { label: "重做", category: "Editing" },
  "edit.cut":       { label: "剪切", category: "Editing" },
  "edit.copy":      { label: "复制", category: "Editing" },
  "edit.paste":     { label: "粘贴", category: "Editing" },
  "edit.selectAll": { label: "全选", category: "Editing" },
  "edit.delete":    { label: "删除", category: "Editing" },
  "edit.deselect":  { label: "取消选择", category: "Editing" },

  // Marking
  "mark.setIn":        { label: "设置入点", category: "Marking" },
  "mark.setOut":       { label: "设置出点", category: "Marking" },
  "mark.clearIn":      { label: "清除入点", category: "Marking" },
  "mark.clearOut":     { label: "清除出点", category: "Marking" },
  "mark.clearInOut":   { label: "清除入/出点", category: "Marking" },
  "mark.goToIn":       { label: "跳到入点", category: "Marking" },
  "mark.goToOut":      { label: "跳到出点", category: "Marking" },

  // Timeline / View
  "timeline.zoomIn":    { label: "放大", category: "Timeline" },
  "timeline.zoomOut":   { label: "缩小", category: "Timeline" },
  "timeline.fitToView": { label: "适配视图", category: "Timeline" },
  "nav.prevEdit":       { label: "上一个编辑点", category: "Navigation" },
  "nav.nextEdit":       { label: "下一个编辑点", category: "Navigation" },

  // File
  "file.open": { label: "打开文件", category: "File" },
}

/** @type {KeyboardLayout} */
const DEFAULT_LAYOUT = {
  "transport.playPause":      [{ key: " " }],
  "transport.shuttleReverse": [{ key: "j" }],
  "transport.shuttleStop":    [{ key: "k" }],
  "transport.shuttleForward": [{ key: "l" }],
  "transport.stepBackward":   [{ key: "arrowleft", ctrl: true }],
  "transport.stepForward":    [{ key: "arrowright", ctrl: true }],
  "transport.jumpBackward":   [{ key: "arrowleft", shift: true }],
  "transport.jumpForward":    [{ key: "arrowright", shift: true }],
  "transport.goToStart":      [{ key: "home" }],
  "transport.goToEnd":        [{ key: "end" }],
  "transport.toggleMute":     [{ key: "m" }],

  "edit.undo":      [{ key: "z", ctrl: true }],
  "edit.redo":      [{ key: "z", ctrl: true, shift: true }],
  "edit.cut":       [{ key: "x", ctrl: true }],
  "edit.copy":      [{ key: "c", ctrl: true }],
  "edit.paste":     [{ key: "v", ctrl: true }],
  "edit.selectAll": [{ key: "a", ctrl: true }],
  "edit.delete":    [{ key: "delete" }, { key: "backspace" }],
  "edit.deselect":  [{ key: "d", ctrl: true, shift: true }],

  "mark.setIn":      [{ key: "i" }],
  "mark.setOut":     [{ key: "o" }],
  "mark.clearIn":    [{ key: "i", ctrl: true, shift: true }],
  "mark.clearOut":   [{ key: "o", ctrl: true, shift: true }],
  "mark.clearInOut": [{ key: "x", ctrl: true, shift: true }],
  "mark.goToIn":     [{ key: "i", shift: true }],
  "mark.goToOut":    [{ key: "o", shift: true }],

  "timeline.zoomIn":    [{ key: "=" }],
  "timeline.zoomOut":   [{ key: "-" }],
  "timeline.fitToView": [{ key: "\\", shift: true }],
  "nav.prevEdit":       [{ key: "arrowup" }],
  "nav.nextEdit":       [{ key: "arrowdown" }],

  "file.open": [{ key: "o", ctrl: true }],
}

/**
 * 格式化快捷键为显示字符串
 * @param {KeyCombo} combo
 * @returns {string}
 */
function formatKeyCombo(combo) {
  const parts = []
  if (combo.ctrl || combo.meta) parts.push("Ctrl")
  if (combo.shift) parts.push("Shift")
  if (combo.alt) parts.push("Alt")

  const keyLabel = {
    " ": "Space",
    "arrowleft": "←",
    "arrowright": "→",
    "arrowup": "↑",
    "arrowdown": "↓",
    "delete": "Del",
    "backspace": "Bksp",
    "escape": "Esc",
    "enter": "Enter",
    "home": "Home",
    "end": "End",
    "tab": "Tab",
    "-": "-",
    "=": "=",
    ",": ",",
    ".": ".",
    "\\": "\\",
  }
  const key = keyLabel[combo.key] ?? combo.key.toUpperCase()
  parts.push(key)
  return parts.join("+")
}

/**
 * 检查键盘事件是否匹配快捷键组合
 * @param {KeyboardEvent} e
 * @param {KeyCombo} combo
 * @returns {boolean}
 */
function comboMatches(e, combo) {
  const comboCtrl = !!(combo.ctrl || combo.meta)
  const eCtrl = e.ctrlKey || e.metaKey

  if (comboCtrl !== eCtrl) return false
  if (!!combo.shift !== e.shiftKey) return false
  if (!!combo.alt !== e.altKey) return false

  const eKey = e.key.toLowerCase()
  return combo.key === eKey || (combo.key === " " && eKey === " ")
}

/**
 * 根据键盘事件解析出对应的操作 ID
 * @param {KeyboardLayout} layout
 * @param {KeyboardEvent} e
 * @returns {string | null}
 */
function resolveAction(layout, e) {
  for (const [actionId, combos] of Object.entries(layout)) {
    if (!combos) continue
    for (const combo of combos) {
      if (comboMatches(e, combo)) {
        return actionId
      }
    }
  }
  return null
}

// ── 导出 ──
export { DEFAULT_LAYOUT, ACTION_REGISTRY, formatKeyCombo, resolveAction }
