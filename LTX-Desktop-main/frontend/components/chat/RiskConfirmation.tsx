import React, { useState } from 'react';
import { AlertTriangle, Shield, ShieldAlert, ShieldCheck, X, Check, ChevronDown, ChevronUp, Clock, FileWarning, Trash2, Edit3 } from 'lucide-react';

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface RiskItem {
  id: string;
  description: string;
  level: RiskLevel;
  affectedScope?: string[];
  recoverable?: boolean;
  estimatedImpact?: string;
}

interface RiskConfirmationProps {
  risks: RiskItem[];
  title?: string;
  description?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
  requireSecondConfirm?: boolean;
  className?: string;
}

export function RiskConfirmation({
  risks,
  title = '风险确认',
  description = '此操作存在以下风险，请确认是否继续：',
  onConfirm,
  onCancel,
  confirmText = '确认执行',
  cancelText = '取消',
  requireSecondConfirm = false,
  className = '',
}: RiskConfirmationProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [secondConfirm, setSecondConfirm] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const getRiskLevel = (level: RiskLevel) => {
    switch (level) {
      case 'low':
        return { color: '#22c55e', bgColor: 'rgba(34, 197, 94, 0.1)', borderColor: 'rgba(34, 197, 94, 0.3)', label: '低风险', icon: ShieldCheck };
      case 'medium':
        return { color: '#eab308', bgColor: 'rgba(234, 179, 8, 0.1)', borderColor: 'rgba(234, 179, 8, 0.3)', label: '中风险', icon: Shield };
      case 'high':
        return { color: '#f97316', bgColor: 'rgba(249, 115, 22, 0.1)', borderColor: 'rgba(249, 115, 22, 0.3)', label: '高风险', icon: ShieldAlert };
      case 'critical':
        return { color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)', label: '严重风险', icon: AlertTriangle };
    }
  };

  const getRiskIcon = (type?: string) => {
    switch (type) {
      case 'delete':
        return <Trash2 style={{ width: '12px', height: '12px' }} />;
      case 'modify':
        return <Edit3 style={{ width: '12px', height: '12px' }} />;
      case 'file':
        return <FileWarning style={{ width: '12px', height: '12px' }} />;
      default:
        return <AlertTriangle style={{ width: '12px', height: '12px' }} />;
    }
  };

  const overallRisk = risks.reduce((max, risk) => {
    const order = { low: 1, medium: 2, high: 3, critical: 4 };
    return order[risk.level] > order[max] ? risk.level : max;
  }, 'low' as RiskLevel);

  const overallRiskConfig = getRiskLevel(overallRisk);
  const hasCritical = risks.some(r => r.level === 'critical');
  const hasHigh = risks.some(r => r.level === 'high');

  const handleConfirm = () => {
    if (requireSecondConfirm && !secondConfirm) {
      setSecondConfirm(true);
      return;
    }
    setConfirmed(true);
    onConfirm?.();
  };

  return (
    <div style={{
      backgroundColor: 'rgba(24, 24, 27, 0.95)',
      borderRadius: '12px',
      border: `1px solid ${overallRiskConfig.borderColor}`,
      overflow: 'hidden',
      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
      maxHeight: '400px',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        backgroundColor: overallRiskConfig.bgColor,
        borderBottom: `1px solid ${overallRiskConfig.borderColor}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            backgroundColor: overallRiskConfig.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {React.createElement(overallRiskConfig.icon, { style: { width: '18px', height: '18px', color: '#fff' } })}
          </div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: overallRiskConfig.color }}>
              {title}
            </div>
            <div style={{ fontSize: '11px', color: '#71717a' }}>
              共 {risks.length} 项风险 · {overallRiskConfig.label}
            </div>
          </div>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            padding: '4px',
            backgroundColor: 'transparent',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {isExpanded ? (
            <ChevronUp style={{ width: '16px', height: '16px', color: '#71717a' }} />
          ) : (
            <ChevronDown style={{ width: '16px', height: '16px', color: '#71717a' }} />
          )}
        </button>
      </div>

      {/* Description */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #3f3f46' }}>
        <p style={{ fontSize: '12px', color: '#a1a1aa', margin: 0 }}>{description}</p>
      </div>

      {/* Risk List */}
      {isExpanded && (
        <div style={{ padding: '8px', overflowY: 'auto', flex: 1 }}>
          {risks.map((risk, idx) => {
            const config = getRiskLevel(risk.level);
            return (
              <div
                key={risk.id}
                style={{
                  padding: '10px 12px',
                  backgroundColor: config.bgColor,
                  borderRadius: '8px',
                  border: `1px solid ${config.borderColor}`,
                  marginBottom: idx < risks.length - 1 ? '8px' : 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    backgroundColor: config.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {React.createElement(config.icon, { style: { width: '12px', height: '12px', color: '#fff' } })}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 500, color: '#e4e4e7' }}>
                        {risk.description}
                      </span>
                      <span style={{
                        fontSize: '9px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        backgroundColor: config.color,
                        color: '#fff',
                        fontWeight: 500,
                      }}>
                        {config.label}
                      </span>
                    </div>

                    {risk.affectedScope && risk.affectedScope.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                        {risk.affectedScope.map((scope, sIdx) => (
                          <span
                            key={sIdx}
                            style={{
                              fontSize: '10px',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(0, 0, 0, 0.3)',
                              color: '#a1a1aa',
                            }}
                          >
                            {scope}
                          </span>
                        ))}
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px', fontSize: '10px', color: '#71717a' }}>
                      {risk.estimatedImpact && (
                        <span>影响: {risk.estimatedImpact}</span>
                      )}
                      {risk.recoverable !== undefined && (
                        <span style={{ color: risk.recoverable ? '#4ade80' : '#f87171' }}>
                          {risk.recoverable ? '✓ 可恢复' : '✗ 不可恢复'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Warning Banner for Critical/High */}
      {(hasCritical || hasHigh) && (
        <div style={{
          margin: '0 8px 8px',
          padding: '10px 12px',
          borderRadius: '8px',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          <AlertTriangle style={{ width: '16px', height: '16px', color: '#ef4444', flexShrink: 0 }} />
          <span style={{ fontSize: '11px', color: '#fca5a5' }}>
            {hasCritical ? '此操作包含严重风险，可能会导致数据丢失！' : '此操作包含高风险，请谨慎确认。'}
          </span>
        </div>
      )}

      {/* Second Confirmation */}
      {secondConfirm && !confirmed && (
        <div style={{
          margin: '0 8px 8px',
          padding: '10px 12px',
          borderRadius: '8px',
          backgroundColor: 'rgba(234, 179, 8, 0.1)',
          border: '1px solid rgba(234, 179, 8, 0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          <Clock style={{ width: '16px', height: '16px', color: '#facc15', flexShrink: 0 }} />
          <span style={{ fontSize: '11px', color: '#fde68a' }}>
            这是最后一次确认机会，点击确认后将立即执行此操作。
          </span>
        </div>
      )}

      {/* Actions */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '8px',
        padding: '12px 16px',
        borderTop: '1px solid #3f3f46',
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
      }}>
        <button
          onClick={onCancel}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 16px',
            borderRadius: '8px',
            backgroundColor: '#27272a',
            border: '1px solid #3f3f46',
            cursor: 'pointer',
            color: '#a1a1aa',
            fontSize: '12px',
            transition: 'all 0.2s',
          }}
        >
          <X style={{ width: '14px', height: '14px' }} />
          {cancelText}
        </button>
        <button
          onClick={handleConfirm}
          disabled={confirmed}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 16px',
            borderRadius: '8px',
            backgroundColor: secondConfirm ? '#ef4444' : overallRiskConfig.color,
            border: 'none',
            cursor: confirmed ? 'default' : 'pointer',
            color: '#fff',
            fontSize: '12px',
            fontWeight: 500,
            opacity: confirmed ? 0.6 : 1,
            transition: 'all 0.2s',
          }}
        >
          {confirmed ? (
            <>
              <Check style={{ width: '14px', height: '14px' }} />
              已确认
            </>
          ) : (
            <>
              <Check style={{ width: '14px', height: '14px' }} />
              {secondConfirm ? '确认执行' : confirmText}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default RiskConfirmation;