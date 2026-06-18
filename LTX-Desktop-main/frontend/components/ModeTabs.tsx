import { cn } from '@/lib/utils'
import { Video, ImageIcon, Scissors, Sparkles } from 'lucide-react'
import { useI18n } from '../contexts/I18nContext'

export type GenerationMode = 'text-to-video' | 'image-to-video' | 'text-to-image' | 'retake' | 'ic-lora'

// Simplified tab modes shown in the UI
type TabMode = 'video' | 'text-to-image' | 'retake' | 'ic-lora'

interface ModeTabsProps {
  mode: GenerationMode
  onModeChange: (mode: GenerationMode) => void
  disabled?: boolean
  showIcLora?: boolean
}

const TAB_KEYS: { id: TabMode; key: string; genMode: GenerationMode; icon: React.ElementType }[] = [
  { id: 'video', key: 'modeTabs.video', genMode: 'text-to-video', icon: Video },
  { id: 'text-to-image', key: 'modeTabs.image', genMode: 'text-to-image', icon: ImageIcon },
  { id: 'retake', key: 'modeTabs.retake', genMode: 'retake', icon: Scissors },
  { id: 'ic-lora', key: 'modeTabs.icLora', genMode: 'ic-lora', icon: Sparkles },
]

export function ModeTabs({ mode, onModeChange, disabled, showIcLora = true }: ModeTabsProps) {
  const { t } = useI18n()
  const activeTab: TabMode = mode === 'text-to-image'
    ? 'text-to-image'
    : mode === 'retake'
      ? 'retake'
      : mode === 'ic-lora'
        ? 'ic-lora'
        : 'video'
  const visibleTabs = showIcLora ? TAB_KEYS : TAB_KEYS.filter((tab) => tab.id !== 'ic-lora')

  return (
    <div className="flex gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl">
      {visibleTabs.map((tab) => {
        const Icon = tab.icon
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => !disabled && onModeChange(tab.genMode)}
            disabled={disabled}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              isActive
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(tab.key)}
          </button>
        )
      })}
    </div>
  )
}
