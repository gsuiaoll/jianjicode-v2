import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Wrench, CheckCircle2, XCircle, Clock } from 'lucide-react';

type ToolStatus = 'pending' | 'running' | 'done' | 'error';

interface ToolCallCardLabels {
  pending: string
  running: string
  done: string
  error: string
  inputParams: string
  outputResult: string
  errorMessage: string
  executionTime: string
  doneLabel: string
  errorLabel: string
  runningLabel: string
}

const DEFAULT_LABELS: ToolCallCardLabels = {
  pending: 'Waiting...',
  running: 'Running...',
  done: 'Done',
  error: 'Failed',
  inputParams: 'Input Parameters:',
  outputResult: 'Output Result:',
  errorMessage: 'Error Message:',
  executionTime: 'Execution Time:',
  doneLabel: 'Done',
  errorLabel: 'Failed',
  runningLabel: 'Running',
}

function getToolLabels(toolName: string): ToolCallCardLabels {
  if (toolName === 'skill_manage') {
    return {
      pending: '准备编写...',
      running: '正在编写脚本...',
      done: '脚本已保存',
      error: '编写失败',
      inputParams: '输入参数:',
      outputResult: '脚本路径:',
      errorMessage: '错误信息:',
      executionTime: '耗时:',
      doneLabel: '脚本已保存',
      errorLabel: '编写失败',
      runningLabel: '编写中',
    }
  }
  if (toolName === 'execute_script') {
    return {
      pending: '等待执行...',
      running: '正在执行脚本...',
      done: '脚本执行完成',
      error: '执行失败',
      inputParams: '输入参数:',
      outputResult: '执行输出:',
      errorMessage: '错误信息:',
      executionTime: '耗时:',
      doneLabel: '执行完成',
      errorLabel: '执行失败',
      runningLabel: '执行中',
    }
  }
  return DEFAULT_LABELS
}

interface ToolCallCardProps {
  toolName: string;
  status?: ToolStatus;
  inputParams?: Record<string, unknown>;
  outputResult?: unknown;
  executionTime?: number;
  errorMessage?: string;
  onExpand?: () => void;
  className?: string;
  labels?: ToolCallCardLabels;
}

export const ToolCallCard: React.FC<ToolCallCardProps> = ({
  toolName,
  status = 'pending',
  inputParams,
  outputResult,
  executionTime,
  errorMessage,
  onExpand,
  className = '',
  labels: propLabels,
}) => {
  const labels = propLabels ?? getToolLabels(toolName)
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
    onExpand?.();
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'pending':
        return (
          <div style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#3f3f46', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Clock style={{ width: '12px', height: '12px', color: '#71717a' }} />
          </div>
        );
      case 'running':
        return (
          <div style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: 'rgba(234, 179, 8, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Loader2 style={{ width: '12px', height: '12px', color: '#facc15', animation: 'spin 1s linear infinite' }} />
          </div>
        );
      case 'done':
        return (
          <div style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: 'rgba(34, 197, 94, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CheckCircle2 style={{ width: '12px', height: '12px', color: '#4ade80' }} />
          </div>
        );
      case 'error':
        return (
          <div style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <XCircle style={{ width: '12px', height: '12px', color: '#f87171' }} />
          </div>
        );
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'pending':
        return labels.pending;
      case 'running':
        return labels.running;
      case 'done':
        return errorMessage ? labels.error : labels.done;
      case 'error':
        return labels.error;
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'pending':
        return '#a1a1aa';
      case 'running':
        return '#facc15';
      case 'done':
        return errorMessage ? '#f87171' : '#4ade80';
      case 'error':
        return '#f87171';
    }
  };

  const formatJson = (obj: unknown): string => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  const isScriptTool = toolName === 'skill_manage' || toolName === 'execute_script'
  const borderColor = isScriptTool ? 'rgba(96, 165, 250, 0.4)' : 'rgba(63, 63, 70, 0.5)'
  const bgColor = isScriptTool ? 'rgba(30, 58, 138, 0.15)' : 'rgba(39, 39, 42, 0.5)'

  return (
    <div style={{ backgroundColor: bgColor, borderRadius: '8px', border: `1px solid ${borderColor}`, overflow: 'hidden' }}>
      <button
        onClick={handleToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          backgroundColor: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left' as const,
          transition: 'background-color 0.2s',
        }}
      >
        <div style={{ flexShrink: 0 }}>
          {getStatusIcon()}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
          <Wrench style={{ width: '14px', height: '14px', color: '#71717a' }} />
          <span style={{ fontSize: '12px', fontFamily: 'ui-monospace, monospace', color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {toolName}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: getStatusColor() }}>
          <span>{getStatusText()}</span>
          {isExpanded ? (
            <ChevronDown style={{ width: '14px', height: '14px' }} />
          ) : (
            <ChevronRight style={{ width: '14px', height: '14px' }} />
          )}
        </div>
      </button>

      {isExpanded && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {inputParams && Object.keys(inputParams).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ fontSize: '10px', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: '#52525b' }}>├──</span>
{labels.inputParams}
              </div>
              <div style={{ paddingLeft: '16px', fontSize: '10px' }}>
                <pre style={{ backgroundColor: 'rgba(9, 9, 11, 0.5)', borderRadius: '4px', padding: '8px', overflow: 'auto', color: '#a1a1aa', fontFamily: 'ui-monospace, monospace', margin: 0, fontSize: '10px' }}>
                  {formatJson(inputParams)}
                </pre>
              </div>
            </div>
          )}

          {executionTime !== undefined && (
            <div style={{ fontSize: '10px', color: '#71717a', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: '#52525b' }}>├──</span>
{labels.executionTime}
              <span style={{ color: '#d4d4d8' }}>{executionTime.toFixed(2)}s</span>
            </div>
          )}

          {status === 'done' && outputResult != null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ fontSize: '10px', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: '#52525b' }}>└──</span>
{labels.outputResult}
              </div>
              <div style={{ paddingLeft: '16px', fontSize: '10px' }}>
                <pre style={{ backgroundColor: 'rgba(9, 9, 11, 0.5)', borderRadius: '4px', padding: '8px', overflow: 'auto', color: '#a1a1aa', fontFamily: 'ui-monospace, monospace', margin: 0, maxHeight: '128px', fontSize: '10px' }}>
                  {formatJson(outputResult)}
                </pre>
              </div>
            </div>
          )}

          {status === 'error' && errorMessage && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ fontSize: '10px', color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: '#52525b' }}>└──</span>
{labels.errorMessage}
              </div>
              <div style={{ paddingLeft: '16px', fontSize: '10px' }}>
                <pre style={{ backgroundColor: 'rgba(127, 29, 29, 0.2)', borderRadius: '4px', padding: '8px', overflow: 'auto', color: '#fca5a5', fontFamily: 'ui-monospace, monospace', margin: 0, fontSize: '10px' }}>
                  {errorMessage}
                </pre>
              </div>
            </div>
          )}

          <div style={{ fontSize: '10px', color: '#52525b', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>└──</span>
            <span style={{ color: status === 'done' && !errorMessage ? '#4ade80' : status === 'error' ? '#f87171' : '#facc15' }}>
              {status === 'done' && !errorMessage ? labels.doneLabel : status === 'error' ? labels.errorLabel : labels.runningLabel}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ToolCallCard;