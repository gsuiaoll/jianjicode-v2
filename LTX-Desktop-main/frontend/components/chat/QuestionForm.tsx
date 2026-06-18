import { useState } from "react"
import { X as XIcon } from "lucide-react"

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionData {
  requestId: string
  questions: Array<{
    question: string
    header?: string
    options: QuestionOption[]
    multiSelect?: boolean
  }>
}

interface QuestionFormProps {
  data: QuestionData
  onSubmit: (answers: string[][]) => Promise<void>
  onCancel: () => void
}

export function QuestionForm({ data, onSubmit, onCancel }: QuestionFormProps) {
  const [selected, setSelected] = useState<Record<number, Set<number>>>({})
  const [submitting, setSubmitting] = useState(false)

  const toggleOption = (qIdx: number, oIdx: number, multi: boolean) => {
    setSelected((prev) => {
      const next = { ...prev }
      if (!next[qIdx]) next[qIdx] = new Set()
      if (multi) {
        const s = new Set(next[qIdx])
        if (s.has(oIdx)) s.delete(oIdx)
        else s.add(oIdx)
        next[qIdx] = s
      } else {
        next[qIdx] = new Set([oIdx])
      }
      return next
    })
  }

  const allAnswered = data.questions.every(
    (_, i) => selected[i] && selected[i].size > 0,
  )

  const handleSubmit = async () => {
    if (!allAnswered || submitting) return
    setSubmitting(true)
    const answers: string[][] = data.questions.map((q, i) => {
      const sel = selected[i] || new Set()
      return [...sel].map((oIdx) => q.options[oIdx].label)
    })
    await onSubmit(answers)
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        style={{
          background: "linear-gradient(135deg, #1e1e2e 0%, #181825 100%)",
          border: "1px solid #2a2a3e",
          borderRadius: "14px",
          width: "100%",
          maxWidth: "420px",
          maxHeight: "80vh",
          overflowY: "auto",
          padding: "20px",
          boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "16px",
          }}
        >
          <span
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "#9ca3af",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Question
          </span>
          <button
            onClick={onCancel}
            style={{
              background: "none",
              border: "none",
              color: "#6b7280",
              cursor: "pointer",
              padding: "2px",
            }}
          >
            <XIcon style={{ width: "16px", height: "16px" }} />
          </button>
        </div>

        {/* Questions */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {data.questions.map((q, qIdx) => (
            <div key={qIdx}>
              {q.header && (
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "#5ec4d0",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginBottom: "8px",
                    paddingBottom: "6px",
                    borderBottom: "1px solid rgba(94,196,208,0.15)",
                  }}
                >
                  {q.header}
                </div>
              )}
              <p
                style={{
                  fontSize: "13px",
                  color: "#d4d4d4",
                  marginBottom: "10px",
                  lineHeight: 1.5,
                }}
              >
                {q.question}
              </p>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                {q.options.map((opt, oIdx) => {
                  const isSelected = selected[qIdx]?.has(oIdx)
                  const isMulti = q.multiSelect
                  return (
                    <button
                      key={oIdx}
                      onClick={() => toggleOption(qIdx, oIdx, !!isMulti)}
                      style={{
                        textAlign: "left",
                        padding: "10px 14px",
                        borderRadius: "8px",
                        background: isSelected
                          ? "rgba(59,130,246,0.12)"
                          : "rgba(42,42,62,0.4)",
                        border: isSelected
                          ? "1px solid rgba(59,130,246,0.4)"
                          : "1px solid transparent",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        {isMulti && (
                          <div
                            style={{
                              width: "16px",
                              height: "16px",
                              borderRadius: "3px",
                              border: isSelected
                                ? "1px solid #3b82f6"
                                : "1px solid #4b5563",
                              background: isSelected
                                ? "#3b82f6"
                                : "transparent",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            {isSelected && (
                              <svg
                                width="10"
                                height="10"
                                viewBox="0 0 10 10"
                                fill="none"
                                stroke="white"
                                strokeWidth="2"
                              >
                                <path d="M2 5l2 2 4-4" />
                              </svg>
                            )}
                          </div>
                        )}
                        <div>
                          <div
                            style={{
                              fontSize: "13px",
                              fontWeight: 500,
                              color: isSelected ? "#e5e5e5" : "#d4d4d4",
                            }}
                          >
                            {opt.label}
                          </div>
                          {opt.description && (
                            <div
                              style={{
                                fontSize: "11px",
                                color: "#6b7280",
                                marginTop: "2px",
                              }}
                            >
                              {opt.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Submit */}
        <div style={{ marginTop: "20px" }}>
          <button
            onClick={handleSubmit}
            disabled={!allAnswered || submitting}
            style={{
              width: "100%",
              padding: "10px 0",
              borderRadius: "10px",
              background: allAnswered
                ? "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"
                : "rgba(42,42,62,0.5)",
              border: "none",
              color: allAnswered ? "white" : "#6b7280",
              fontSize: "13px",
              fontWeight: 500,
              cursor: allAnswered ? "pointer" : "default",
              transition: "all 0.2s ease",
            }}
          >
            {submitting ? "提交中..." : "提交"}
          </button>
        </div>
      </div>
    </div>
  )
}
