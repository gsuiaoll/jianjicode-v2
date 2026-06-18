import { Select } from './ui/select'
import type { GenerationMode } from './ModeTabs'
import { useI18n } from '../contexts/I18nContext'
import {
  FORCED_API_VIDEO_FPS,
  FORCED_API_VIDEO_RESOLUTIONS,
  getAllowedForcedApiDurations,
  sanitizeForcedApiVideoSettings,
} from '../lib/api-video-options'

export interface GenerationSettings {
  model: 'fast' | 'pro'
  duration: number
  videoResolution: string
  fps: number
  audio: boolean
  cameraMotion: string
  aspectRatio?: string
  // Image-specific settings
  imageResolution: string
  imageAspectRatio: string
  imageSteps: number
  variations?: number  // Number of image variations to generate
}

interface SettingsPanelProps {
  settings: GenerationSettings
  onSettingsChange: (settings: GenerationSettings) => void
  disabled?: boolean
  mode?: GenerationMode
  forceApiGenerations?: boolean
  hasAudio?: boolean
}

export function SettingsPanel({
  settings,
  onSettingsChange,
  disabled,
  mode = 'text-to-video',
  forceApiGenerations = false,
  hasAudio = false,
}: SettingsPanelProps) {
  const { t } = useI18n()
  const isImageMode = mode === 'text-to-image'
  const LOCAL_MAX_DURATION: Record<string, number> = { '540p': 20, '720p': 10, '1080p': 5 }

  const handleChange = (key: keyof GenerationSettings, value: string | number | boolean) => {
    const nextSettings = { ...settings, [key]: value } as GenerationSettings
    if (forceApiGenerations && !isImageMode) {
      onSettingsChange(sanitizeForcedApiVideoSettings(nextSettings, { hasAudio }))
      return
    }

    // Clamp duration when resolution changes for local generation
    if (key === 'videoResolution' && !forceApiGenerations) {
      const maxDur = LOCAL_MAX_DURATION[value as string] ?? 20
      if (nextSettings.duration > maxDur) {
        nextSettings.duration = maxDur
      }
    }

    onSettingsChange(nextSettings)
  }

  const localMaxDuration = LOCAL_MAX_DURATION[settings.videoResolution] ?? 20
  const durationOptions = forceApiGenerations
    ? [...getAllowedForcedApiDurations(settings.model, settings.videoResolution, settings.fps)]
    : [5, 6, 8, 10, 20].filter(d => d <= localMaxDuration)
  const resolutionOptions = forceApiGenerations
    ? (hasAudio ? ['1080p'] : [...FORCED_API_VIDEO_RESOLUTIONS])
    : ['1080p', '720p', '540p']
  const fpsOptions = forceApiGenerations ? [...FORCED_API_VIDEO_FPS] : [24, 25, 50]

  // Image mode settings
  if (isImageMode) {
    return (
      <div className="space-y-4">
        {/* Aspect Ratio and Quality side by side */}
        <div className="grid grid-cols-2 gap-3">
          <Select
            label={t('settingsPanel.aspectRatio')}
            value={settings.imageAspectRatio || '16:9'}
            onChange={(e) => handleChange('imageAspectRatio', e.target.value)}
            disabled={disabled}
          >
            <option value="1:1">{t('settingsPanel.aspectSquare')}</option>
            <option value="16:9">{t('settingsPanel.aspectLandscape')}</option>
            <option value="9:16">{t('settingsPanel.aspectPortrait')}</option>
            <option value="4:3">{t('settingsPanel.aspectStandard')}</option>
            <option value="3:4">{t('settingsPanel.aspectPortraitStandard')}</option>
            <option value="21:9">{t('settingsPanel.aspectCinematic')}</option>
          </Select>

          <Select
            label={t('settingsPanel.quality')}
            value={settings.imageSteps || 4}
            onChange={(e) => handleChange('imageSteps', parseInt(e.target.value))}
            disabled={disabled}
          >
            <option value={4}>{t('settingsPanel.fast')}</option>
            <option value={8}>{t('settingsPanel.balanced')}</option>
            <option value={12}>{t('settingsPanel.high')}</option>
          </Select>
        </div>
      </div>
    )
  }

  // Video mode settings
  return (
    <div className="space-y-4">
      {/* Model Selection */}
      {!forceApiGenerations ? (
        <Select
          label={t('settingsPanel.model')}
          value={settings.model}
          onChange={(e) => handleChange('model', e.target.value)}
          disabled={disabled}
        >
          <option value="fast">{t('settingsPanel.modelFast')}</option>
        </Select>
      ) : (
        <Select
          label={t('settingsPanel.model')}
          value={settings.model}
          onChange={(e) => handleChange('model', e.target.value)}
          disabled={disabled}
        >
          <option value="fast" disabled={hasAudio}>{t('settingsPanel.modelFastApi')}</option>
          <option value="pro">{t('settingsPanel.modelProApi')}</option>
        </Select>
      )}

      {/* Duration, Resolution, FPS Row */}
      <div className="grid grid-cols-3 gap-3">
        <Select
          label={t('settingsPanel.duration')}
          value={settings.duration}
          onChange={(e) => handleChange('duration', parseInt(e.target.value))}
          disabled={disabled}
        >
          {durationOptions.map((duration) => (
            <option key={duration} value={duration}>
              {duration} {t('settingsPanel.sec')}
            </option>
          ))}
        </Select>

        <Select
          label={t('settingsPanel.resolution')}
          value={settings.videoResolution}
          onChange={(e) => handleChange('videoResolution', e.target.value)}
          disabled={disabled}
        >
          {resolutionOptions.map((resolution) => (
            <option key={resolution} value={resolution}>
              {resolution}
            </option>
          ))}
        </Select>

        <Select
          label={t('settingsPanel.fps')}
          value={settings.fps}
          onChange={(e) => handleChange('fps', parseInt(e.target.value))}
          disabled={disabled}
        >
          {fpsOptions.map((fps) => (
            <option key={fps} value={fps}>
              {fps}
            </option>
          ))}
        </Select>
      </div>

      {/* Aspect Ratio */}
      <Select
        label={t('settingsPanel.aspectRatio')}
        value={settings.aspectRatio || '16:9'}
        onChange={(e) => handleChange('aspectRatio', e.target.value)}
        disabled={disabled}
      >
        {hasAudio ? (
          <option value="16:9">{t('settingsPanel.landscape169')}</option>
        ) : (
          <>
            <option value="16:9">{t('settingsPanel.landscape169')}</option>
            <option value="9:16">{t('settingsPanel.portrait916')}</option>
          </>
        )}
      </Select>

      {/* Audio and Camera Motion Row */}
      <div className="flex gap-3">
        <div className="w-[140px] flex-shrink-0">
          <Select
            label={t('settingsPanel.audio')}
            badge={t('settingsPanel.preview')}
            value={settings.audio ? 'on' : 'off'}
            onChange={(e) => handleChange('audio', e.target.value === 'on')}
            disabled={disabled}
          >
            <option value="on">{t('settingsPanel.on')}</option>
            <option value="off">{t('settingsPanel.off')}</option>
          </Select>
        </div>

        <div className="flex-1">
          <Select
            label={t('settingsPanel.cameraMotion')}
            value={settings.cameraMotion}
            onChange={(e) => handleChange('cameraMotion', e.target.value)}
            disabled={disabled}
          >
            <option value="none">{t('settingsPanel.cameraNone')}</option>
            <option value="static">{t('settingsPanel.cameraStatic')}</option>
            <option value="focus_shift">{t('settingsPanel.cameraFocusShift')}</option>
            <option value="dolly_in">{t('settingsPanel.cameraDollyIn')}</option>
            <option value="dolly_out">{t('settingsPanel.cameraDollyOut')}</option>
            <option value="dolly_left">{t('settingsPanel.cameraDollyLeft')}</option>
            <option value="dolly_right">{t('settingsPanel.cameraDollyRight')}</option>
            <option value="jib_up">{t('settingsPanel.cameraJibUp')}</option>
            <option value="jib_down">{t('settingsPanel.cameraJibDown')}</option>
          </Select>
        </div>
      </div>
    </div>
  )
}
