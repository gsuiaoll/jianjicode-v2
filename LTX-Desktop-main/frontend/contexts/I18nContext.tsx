import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { Language } from '../i18n/types'
import { zh } from '../i18n/zh'
import { en } from '../i18n/en'

const STORAGE_KEY = 'ltx-language'

interface I18nContextValue {
  lang: Language
  setLang: (lang: Language) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

const dicts: Record<Language, Record<string, string>> = { zh, en }

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'zh' || stored === 'en') return stored
    } catch { /* localStorage unavailable */ }
    return 'en'
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch { /* localStorage unavailable */ }
  }, [lang])

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      let value: string = dicts[lang][key] ?? dicts.en[key] ?? key
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          value = value.replace(`{${k}}`, String(v))
        }
      }
      return value
    },
    [lang],
  )

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
