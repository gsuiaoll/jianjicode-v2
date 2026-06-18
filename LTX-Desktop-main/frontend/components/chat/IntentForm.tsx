import React, { useState } from 'react';
import { Sparkles, X, Send } from 'lucide-react';

interface IntentOption {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}

interface IntentFormLabels {
  title: string
  fallbackMessage: string
  customInputPlaceholder: string
  additionalInfoLabel: string
  selectedLabel: string
  cancel: string
  confirm: string
  send: string
}

const DEFAULT_LABELS: IntentFormLabels = {
  title: 'AI Assistant',
  fallbackMessage: 'Please select your intent',
  customInputPlaceholder: 'e.g. Help me trim a 15-second product showcase...',
  additionalInfoLabel: 'Describe your specific needs:',
  selectedLabel: 'Selected:',
  cancel: 'Cancel',
  confirm: 'Confirm',
  send: 'Confirm & Send',
}

interface IntentFormProps {
  onSubmit?: (selectedIntent: string, additionalInfo?: string) => void;
  onCancel?: () => void;
  suggestions?: IntentOption[];
  allowCustomInput?: boolean;
  customInputPlaceholder?: string;
  formMessage?: string;
  labels?: IntentFormLabels;
}

const DEFAULT_SUGGESTIONS: IntentOption[] = [
  {
    id: 'quick-cut',
    label: 'Quick Cut',
    description: 'Quickly complete basic editing, keep main content',
    icon: '⚡',
    color: '#3b82f6',
  },
  {
    id: 'detail-edit',
    label: 'Detailed Edit',
    description: 'Fine-tune every detail for perfect results',
    icon: '🕐',
    color: '#8b5cf6',
  },
  {
    id: 'other',
    label: 'Other',
    description: 'Special requirements or unsure how to describe',
    icon: '💬',
    color: '#6b7280',
  },
];

export function IntentForm({
  onSubmit,
  onCancel,
  suggestions = DEFAULT_SUGGESTIONS,
  allowCustomInput = true,
  customInputPlaceholder,
  formMessage,
  labels = DEFAULT_LABELS,
}: IntentFormProps) {
  const placeholder = customInputPlaceholder || labels.customInputPlaceholder
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showTextInput, setShowTextInput] = useState(false);
  const [additionalText, setAdditionalText] = useState('');

  const handleOptionClick = (id: string) => {
    setSelectedId(id);
    if (id === 'other' || allowCustomInput) {
      setShowTextInput(true);
    } else {
      setShowTextInput(false);
    }
  };

  const handleSubmit = () => {
    if (selectedId) {
      onSubmit?.(selectedId, showTextInput ? additionalText : undefined);
    }
  };

  const handleCancel = () => {
    setSelectedId(null);
    setShowTextInput(false);
    setAdditionalText('');
    onCancel?.();
  };

  const selectedOption = suggestions.find(s => s.id === selectedId);

  return (
    <div style={{
      backgroundColor: 'rgba(24, 24, 37, 0.98)',
      borderRadius: '14px',
      border: '1px solid #2a2a3e',
      overflow: 'hidden',
      boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)',
      maxWidth: '360px',
      margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '12px 14px',
        borderBottom: '1px solid #2a2a3e',
        background: 'linear-gradient(135deg, #1e1e2e 0%, #181825 100%)',
      }}>
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '8px',
          background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
        }}>
          <Sparkles style={{ width: '16px', height: '16px', color: 'white' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#e5e5e5' }}>
{labels.title}
          </div>
          <div style={{ fontSize: '11px', color: '#9ca3af' }}>
            {formMessage || labels.fallbackMessage}
          </div>
        </div>
        <button
          onClick={handleCancel}
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '8px',
            backgroundColor: 'rgba(42, 42, 62, 0.6)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <X style={{ width: '14px', height: '14px', color: '#9ca3af' }} />
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: '14px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {suggestions.map((option) => {
            const isSelected = selectedId === option.id;
            return (
              <button
                key={option.id}
                onClick={() => handleOptionClick(option.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  backgroundColor: isSelected ? `${option.color}18` : 'rgba(30, 30, 46, 0.8)',
                  border: `2px solid ${isSelected ? option.color : 'rgba(42, 42, 62, 0.8)'}`,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s ease',
                  transform: isSelected ? 'scale(1.01)' : 'scale(1)',
                }}
              >
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '9px',
                  backgroundColor: isSelected ? option.color : 'rgba(42, 42, 62, 0.8)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: '18px',
                  transition: 'all 0.15s ease',
                  boxShadow: isSelected ? `0 2px 8px ${option.color}30` : 'none',
                }}>
                  {option.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: isSelected ? option.color : '#e5e5e5',
                    marginBottom: '2px',
                  }}>
                    {option.label}
                  </div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', lineHeight: 1.4 }}>
                    {option.description}
                  </div>
                </div>
                <div style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  border: `2px solid ${isSelected ? option.color : '#52525b'}`,
                  backgroundColor: isSelected ? option.color : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'all 0.15s ease',
                }}>
                  {isSelected && (
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: 'white',
                    }} />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Text Input */}
        {showTextInput && (
          <div style={{
            marginTop: '12px',
            animation: 'fadeInUp 0.2s ease-out',
          }}>
            <div style={{
              fontSize: '11px',
              color: '#9ca3af',
              marginBottom: '6px',
            }}>
{labels.additionalInfoLabel}
            </div>
            <textarea
              value={additionalText}
              onChange={(e) => setAdditionalText(e.target.value)}
              placeholder={placeholder}
              style={{
                width: '100%',
                minHeight: '70px',
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor: 'rgba(30, 30, 46, 0.8)',
                border: `2px solid ${selectedOption?.color || '#3b82f6'}`,
                color: '#e5e5e5',
                fontSize: '12px',
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: '1.5',
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '12px 14px',
        borderTop: '1px solid #2a2a3e',
        background: 'linear-gradient(135deg, #12121a 0%, #181825 100%)',
      }}>
        {/* Selection Summary */}
        {selectedOption && !showTextInput && (
          <div style={{
            marginBottom: '10px',
            padding: '8px 10px',
            borderRadius: '8px',
            backgroundColor: `${selectedOption.color}12`,
            border: `1px solid ${selectedOption.color}25`,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <span style={{ color: selectedOption.color, fontSize: '11px' }}>
              {labels.selectedLabel}
            </span>
            <span style={{ color: '#e5e5e5', fontSize: '11px', fontWeight: 500 }}>
              {selectedOption.label}
            </span>
          </div>
        )}

        {showTextInput && (
          <div style={{
            marginBottom: '10px',
            padding: '8px 10px',
            borderRadius: '8px',
            backgroundColor: `${selectedOption?.color}12`,
            border: `1px solid ${selectedOption?.color}25`,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <span style={{ color: selectedOption?.color, fontSize: '11px' }}>
              {labels.selectedLabel}
            </span>
            <span style={{ color: '#e5e5e5', fontSize: '11px', fontWeight: 500 }}>
              {selectedOption?.label}
            </span>
            {additionalText && (
              <>
                <span style={{ color: '#52525b' }}>|</span>
                <span style={{
                  color: '#9ca3af',
                  fontSize: '10px',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {additionalText.slice(0, 35)}{additionalText.length > 35 ? '...' : ''}
                </span>
              </>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleCancel}
            style={{
              flex: '0 0 auto',
              padding: '10px 16px',
              borderRadius: '10px',
              backgroundColor: 'rgba(42, 42, 62, 0.8)',
              border: '1px solid #2a2a3e',
              color: '#9ca3af',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
{labels.cancel}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedId || (showTextInput && !additionalText.trim())}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '10px 16px',
              borderRadius: '10px',
              background: selectedId ? (selectedOption?.color ? `linear-gradient(135deg, ${selectedOption.color} 0%, ${selectedOption.color}dd 100%)` : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)') : '#2a2a3e',
              border: 'none',
              color: 'white',
              fontSize: '12px',
              fontWeight: 600,
              cursor: selectedId ? 'pointer' : 'not-allowed',
              opacity: selectedId ? 1 : 0.5,
              transition: 'all 0.15s ease',
              boxShadow: selectedId ? `0 2px 8px ${selectedOption?.color || '#3b82f6'}30` : 'none',
            }}
          >
            {showTextInput ? labels.send : labels.confirm}
            <Send style={{ width: '13px', height: '13px' }} />
          </button>
        </div>
      </div>

      {/* CSS Animation */}
      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

export default IntentForm;
