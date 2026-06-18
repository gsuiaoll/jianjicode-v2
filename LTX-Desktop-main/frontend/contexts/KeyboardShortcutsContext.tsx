import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import {
  KeyboardLayout,
  KeyboardPreset,
  BUILT_IN_PRESETS,
  LTX_DEFAULT_LAYOUT,
  cloneLayout,
  ActionId,
} from '../lib/keyboard-shortcuts'

interface KeyboardShortcutsState {
  // Current active layout
  activeLayout: KeyboardLayout
  activePresetId: string
  // All presets (built-in + user)
  presets: KeyboardPreset[]
  // Actions
  switchPreset: (presetId: string) => void
  updateBinding: (actionId: ActionId, combos: KeyboardLayout[ActionId]) => void
  resetToPreset: (presetId: string) => void
  saveAsCustomPreset: (name: string) => void
  deleteCustomPreset: (presetId: string) => void
  // Import/Export
  exportLayout: () => void
  importLayout: (file: File) => Promise<boolean>
  // Whether the shortcuts editor modal is open
  isEditorOpen: boolean
  setEditorOpen: (open: boolean) => void
}

const KeyboardShortcutsContext = createContext<KeyboardShortcutsState | null>(null)

const STORAGE_KEY = 'ltx-keyboard-shortcuts'

// Bump this when making breaking changes to the keyboard shortcut system
// (preset IDs change, layout format changes, etc.)
const SCHEMA_VERSION = 2

interface PersistedState {
  version?: number
  activePresetId: string
  customLayout?: KeyboardLayout
  customPresets?: KeyboardPreset[]
}

function loadFromStorage(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Discard data from older incompatible schema versions
    if (parsed.version !== SCHEMA_VERSION) return null
    return parsed
  } catch { /* ignore */ }
  return null
}

function saveToStorage(state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: SCHEMA_VERSION }))
  } catch { /* ignore */ }
}

export function KeyboardShortcutsProvider({ children }: { children: React.ReactNode }) {
  const stored = useRef(loadFromStorage())

  const [activePresetId, setActivePresetId] = useState<string>(stored.current?.activePresetId || 'ltx-default')
  const [customLayout, setCustomLayout] = useState<KeyboardLayout | null>(stored.current?.customLayout || null)
  const [customPresets, setCustomPresets] = useState<KeyboardPreset[]>(stored.current?.customPresets || [])
  const [isEditorOpen, setEditorOpen] = useState(false)

  // Resolve active layout: if customLayout is set, use it; otherwise use the preset's layout
  const activeLayout: KeyboardLayout = customLayout
    || [...BUILT_IN_PRESETS, ...customPresets].find(p => p.id === activePresetId)?.layout
    || LTX_DEFAULT_LAYOUT

  // Keep a ref to the active layout so updateBinding always reads the latest
  const activeLayoutRef = useRef(activeLayout)
  activeLayoutRef.current = activeLayout

  const allPresets = [...BUILT_IN_PRESETS, ...customPresets]

  // Persist whenever state changes
  useEffect(() => {
    saveToStorage({
      activePresetId,
      customLayout: customLayout || undefined,
      customPresets: customPresets.length > 0 ? customPresets : undefined,
    })
  }, [activePresetId, customLayout, customPresets])

  const switchPreset = useCallback((presetId: string) => {
    setActivePresetId(presetId)
    setCustomLayout(null) // Clear any custom modifications — use the preset directly
  }, [])

  const updateBinding = useCallback((actionId: ActionId, combos: KeyboardLayout[ActionId]) => {
    // Always read the LATEST layout from the ref to avoid stale closure issues
    setCustomLayout(prev => {
      const base = prev || cloneLayout(activeLayoutRef.current)
      const updated = { ...base, [actionId]: combos }
      return updated
    })
  }, []) // No deps needed — reads from ref

  const resetToPreset = useCallback((presetId: string) => {
    setActivePresetId(presetId)
    setCustomLayout(null)
  }, [])

  const saveAsCustomPreset = useCallback((name: string) => {
    const preset: KeyboardPreset = {
      id: `custom-${Date.now()}`,
      name,
      description: 'Custom keyboard layout',
      layout: cloneLayout(activeLayoutRef.current),
      builtIn: false,
    }
    setCustomPresets(prev => [...prev, preset])
    setActivePresetId(preset.id)
    setCustomLayout(null)
  }, [])

  const exportLayout = useCallback(() => {
    const data = {
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      activePresetId,
      layout: activeLayout,
      customPresets: customPresets.length > 0 ? customPresets : undefined,
    }
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `jianjicode-keyboard-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [activeLayout, activePresetId, customPresets])

  const importLayout = useCallback(async (file: File): Promise<boolean> => {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!data.layout || typeof data.layout !== 'object') return false
      // Accept older versions too, just warn
      if (data.version && data.version !== SCHEMA_VERSION) {
        console.warn(`Importing keyboard layout from schema v${data.version} (current: v${SCHEMA_VERSION})`)
      }
      // Import custom presets if present
      if (data.customPresets && Array.isArray(data.customPresets)) {
        setCustomPresets(prev => {
          const existingIds = new Set(prev.map(p => p.id))
          const newPresets = (data.customPresets as KeyboardPreset[]).filter(p => !existingIds.has(p.id))
          return [...prev, ...newPresets]
        })
      }
      // Set the imported layout as custom
      setCustomLayout(data.layout as KeyboardLayout)
      if (data.activePresetId) setActivePresetId(data.activePresetId)
      return true
    } catch {
      return false
    }
  }, [])

  const deleteCustomPreset = useCallback((presetId: string) => {
    setCustomPresets(prev => prev.filter(p => p.id !== presetId))
    if (activePresetId === presetId) {
      setActivePresetId('ltx-default')
      setCustomLayout(null)
    }
  }, [activePresetId])

  return (
    <KeyboardShortcutsContext.Provider value={{
      activeLayout,
      activePresetId,
      presets: allPresets,
      switchPreset,
      updateBinding,
      resetToPreset,
      saveAsCustomPreset,
      deleteCustomPreset,
      exportLayout,
      importLayout,
      isEditorOpen,
      setEditorOpen,
    }}>
      {children}
    </KeyboardShortcutsContext.Provider>
  )
}

export function useKeyboardShortcuts() {
  const ctx = useContext(KeyboardShortcutsContext)
  if (!ctx) throw new Error('useKeyboardShortcuts must be used inside KeyboardShortcutsProvider')
  return ctx
}
