export type ActionId = string

export interface KeyCombo {
  key: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
}

export type KeyboardLayout = Record<ActionId, KeyCombo[]>

export interface ActionDefinition {
  id: ActionId
  label: string
  category: string
  description?: string
}

export interface KeyboardPreset {
  id: string
  name: string
  description?: string
  layout: KeyboardLayout
  builtIn?: boolean
}

export const ACTION_REGISTRY: ActionDefinition[] = [
  { id: 'tool.select', label: 'Select Tool', category: 'Tools' },
  { id: 'tool.blade', label: 'Blade Tool', category: 'Tools' },
  { id: 'tool.ripple', label: 'Ripple Trim', category: 'Tools' },
  { id: 'tool.roll', label: 'Roll Trim', category: 'Tools' },
  { id: 'tool.slide', label: 'Slide Trim', category: 'Tools' },
  { id: 'tool.slip', label: 'Slip Trim', category: 'Tools' },
  { id: 'tool.trackForward', label: 'Track Forward', category: 'Tools' },
  { id: 'transport.playPause', label: 'Play/Pause', category: 'Transport' },
  { id: 'transport.shuttleReverse', label: 'Shuttle Reverse', category: 'Transport' },
  { id: 'transport.jogForward', label: 'Jog Forward Frame', category: 'Transport' },
  { id: 'transport.jogReverse', label: 'Jog Reverse Frame', category: 'Transport' },
  { id: 'edit.undo', label: 'Undo', category: 'Edit' },
  { id: 'edit.redo', label: 'Redo', category: 'Edit' },
  { id: 'edit.cut', label: 'Cut', category: 'Edit' },
  { id: 'edit.copy', label: 'Copy', category: 'Edit' },
  { id: 'edit.paste', label: 'Paste', category: 'Edit' },
  { id: 'edit.selectAll', label: 'Select All', category: 'Edit' },
  { id: 'edit.delete', label: 'Delete', category: 'Edit' },
  { id: 'edit.deselect', label: 'Deselect', category: 'Edit' },
  { id: 'edit.split', label: 'Split', category: 'Edit' },
  { id: 'timeline.zoomIn', label: 'Zoom In', category: 'Timeline' },
  { id: 'timeline.zoomOut', label: 'Zoom Out', category: 'Timeline' },
  { id: 'timeline.zoomToFit', label: 'Zoom to Fit', category: 'Timeline' },
  { id: 'timeline.exportVideo', label: 'Export Video', category: 'Timeline' },
  { id: 'timeline.save', label: 'Save Project', category: 'Timeline' },
  { id: 'timeline.closeProject', label: 'Close Project', category: 'Timeline' },
  { id: 'timeline.toggleChat', label: 'Toggle Chat Panel', category: 'Timeline' },
]

const defaultBindings: Record<string, KeyCombo[]> = {
  'tool.select': [{ key: 'a', ctrl: false, shift: false, alt: false }],
  'tool.blade': [{ key: 'c', ctrl: false, shift: false, alt: false }],
  'tool.ripple': [{ key: 'q', ctrl: false, shift: false, alt: false }],
  'tool.roll': [{ key: 'w', ctrl: false, shift: false, alt: false }],
  'transport.playPause': [{ key: ' ', ctrl: false, shift: false, alt: false }],
  'edit.undo': [{ key: 'z', ctrl: true, shift: false, alt: false }],
  'edit.redo': [{ key: 'z', ctrl: true, shift: true, alt: false }],
  'edit.cut': [{ key: 'x', ctrl: true }],
  'edit.copy': [{ key: 'c', ctrl: true, shift: false, alt: false }],
  'edit.paste': [{ key: 'v', ctrl: true, shift: false, alt: false }],
  'edit.selectAll': [{ key: 'a', ctrl: true }],
  'edit.delete': [{ key: 'Delete', ctrl: false, shift: false, alt: false }],
  'edit.deselect': [{ key: 'd', ctrl: true, shift: true }],
  'edit.split': [{ key: 's', ctrl: false, shift: false, alt: false }],
  'timeline.zoomIn': [{ key: '=', ctrl: false, shift: false, alt: false }],
  'timeline.zoomOut': [{ key: '-', ctrl: false, shift: false, alt: false }],
  'timeline.exportVideo': [{ key: 'e', ctrl: true, shift: false, alt: false }],
  'timeline.save': [{ key: 's', ctrl: true, shift: false, alt: false }],
}

export const LTX_DEFAULT_LAYOUT: KeyboardLayout = { ...defaultBindings }

export const BUILT_IN_PRESETS: KeyboardPreset[] = [
  { id: 'default', name: 'Default', layout: { ...defaultBindings }, builtIn: true },
]

export function cloneLayout(layout: KeyboardLayout): KeyboardLayout {
  return JSON.parse(JSON.stringify(layout))
}

export function formatKeyCombo(combo: KeyCombo): string {
  const parts: string[] = []
  if (combo.ctrl || combo.meta) parts.push('Ctrl')
  if (combo.shift) parts.push('Shift')
  if (combo.alt) parts.push('Alt')
  parts.push(combo.key === ' ' ? 'Space' : combo.key.length === 1 ? combo.key.toUpperCase() : combo.key)
  return parts.join('+')
}

export function resolveAction(layout: KeyboardLayout, event: KeyboardEvent): ActionId | null {
  const pressed: KeyCombo = {
    key: event.key,
    ctrl: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
  }
  for (const [actionId, combos] of Object.entries(layout)) {
    for (const combo of combos) {
      if (
        combo.key.toLowerCase() === pressed.key.toLowerCase() &&
        (combo.ctrl || false) === (pressed.ctrl || false) &&
        (combo.shift || false) === (pressed.shift || false) &&
        (combo.alt || false) === (pressed.alt || false)
      ) {
        return actionId
      }
    }
  }
  return null
}

export function findConflicts(layout: KeyboardLayout): Array<{ combo: string; actions: ActionId[] }> {
  const map = new Map<string, ActionId[]>()
  for (const [actionId, combos] of Object.entries(layout)) {
    for (const combo of combos) {
      const key = formatKeyCombo(combo)
      const existing = map.get(key) || []
      existing.push(actionId)
      map.set(key, existing)
    }
  }
  return Array.from(map.entries())
    .filter(([, actions]) => actions.length > 1)
    .map(([combo, actions]) => ({ combo, actions }))
}
