import React, { useState } from 'react';
import { ToolCallCard } from './ToolCallCard';
import { TextShimmer } from './TextShimmer';
import { ChevronDown, ChevronUp } from 'lucide-react';

type ToolStatus = 'pending' | 'running' | 'done' | 'error';

export interface ToolCallItem {
  id: string;
  toolName: string;
  status: ToolStatus;
  inputParams?: Record<string, unknown>;
  outputResult?: unknown;
  executionTime?: number;
  errorMessage?: string;
  timestamp?: number;
}

interface ToolCallChainProps {
  items: ToolCallItem[];
  className?: string;
}

const CONTEXT_GROUP_TOOLS = new Set(['read', 'glob', 'grep', 'list']);

type ToolGroupItem =
  | { type: 'tool'; item: ToolCallItem }
  | { type: 'context-group'; items: ToolCallItem[] };

function groupItems(items: ToolCallItem[]): ToolGroupItem[] {
  const result: ToolGroupItem[] = [];
  let i = 0;
  while (i < items.length) {
    if (CONTEXT_GROUP_TOOLS.has(items[i].toolName)) {
      const group: ToolCallItem[] = [];
      while (i < items.length && CONTEXT_GROUP_TOOLS.has(items[i].toolName)) {
        group.push(items[i]);
        i++;
      }
      result.push({ type: 'context-group', items: group });
    } else {
      result.push({ type: 'tool', item: items[i] });
      i++;
    }
  }
  return result;
}

function contextGroupSummary(items: ToolCallItem[]) {
  const read = items.filter((t) => t.toolName === 'read').length;
  const list = items.filter((t) => t.toolName === 'list').length;
  const search = items.filter((t) => t.toolName === 'glob' || t.toolName === 'grep').length;
  return { read, search, list };
}

function contextItemLabel(toolName: string): string {
  switch (toolName) {
    case 'read': return '读取';
    case 'glob': return '搜索';
    case 'grep': return '搜索';
    case 'list': return '列表';
    default: return toolName;
  }
}

function ContextToolGroupCard({ items }: { items: ToolCallItem[] }) {
  const [open, setOpen] = useState(false);
  const pending = items.some((t) => t.status === 'pending' || t.status === 'running');
  const summary = contextGroupSummary(items);

  const parts: string[] = [];
  if (summary.read > 0) parts.push(`${summary.read} 次读取`);
  if (summary.search > 0) parts.push(`${summary.search} 次搜索`);
  if (summary.list > 0) parts.push(`${summary.list} 次列表`);

  return (
    <div
      style={{
        background: '#181825',
        borderRadius: '8px',
        border: '1px solid #2a2a3e',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          padding: '8px 10px',
          fontSize: '11px',
          color: '#a1a1aa',
          cursor: 'pointer',
          border: 'none',
          background: 'transparent',
        }}
      >
        <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <TextShimmer
            text={pending ? '获取上下文中…' : '已获取上下文'}
            active={pending}
          />
          <span style={{ color: '#71717a', fontSize: '10px' }}>
            {parts.join('，')}
          </span>
        </span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div style={{ borderTop: '1px solid #2a2a3e', padding: '6px 8px' }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 6px',
                fontSize: '11px',
                color: '#71717a',
              }}
            >
              <TextShimmer
                text={contextItemLabel(item.toolName)}
                active={item.status === 'pending' || item.status === 'running'}
              />
              {item.status !== 'pending' && item.status !== 'running' && (
                <span style={{ fontSize: '10px', color: '#52525b' }}>
                  {item.status === 'done' ? '✓' : item.status === 'error' ? '✗' : ''}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const ToolCallChain: React.FC<ToolCallChainProps> = ({
  items,
  className = '',
}) => {
  if (items.length === 0) {
    return null;
  }

  const groups = groupItems(items);

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ fontSize: '10px', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
        工具调用链 ({items.length})
      </div>

      {groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && (
            <div style={{ width: '1px', height: '8px', backgroundColor: '#3f3f46', marginLeft: '20px' }} />
          )}
          {group.type === 'context-group' ? (
            <ContextToolGroupCard items={group.items} />
          ) : (
            <ToolCallCard
              toolName={group.item.toolName}
              status={group.item.status}
              inputParams={group.item.inputParams}
              outputResult={group.item.outputResult}
              executionTime={group.item.executionTime}
              errorMessage={group.item.errorMessage}
            />
          )}
        </div>
      ))}
    </div>
  );
};

export const CompactToolCallChain: React.FC<{
  items: ToolCallItem[];
  className?: string;
}> = ({
  items,
  className = '',
}) => {
  const activeItem = items.find(item => item.status === 'running');
  const completedCount = items.filter(item => item.status === 'done').length;
  const hasError = items.some(item => item.status === 'error');

  const getStatusColor = (status: ToolStatus) => {
    switch (status) {
      case 'done': return '#22c55e';
      case 'error': return '#ef4444';
      case 'running': return '#eab308';
      default: return '#3f3f46';
    }
  };

  return (
    <div className={className} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ display: 'flex' }}>
        {items.slice(0, 3).map((item, index) => (
          <div
            key={item.id}
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              border: '2px solid #09090b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: getStatusColor(item.status),
              marginLeft: index > 0 ? '-4px' : '0',
              zIndex: items.length - index,
            }}
          >
            <span style={{ fontSize: '8px', color: '#fff', fontWeight: 'bold' }}>
              {index + 1}
            </span>
          </div>
        ))}
        {items.length > 3 && (
          <div style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            backgroundColor: '#3f3f46',
            border: '2px solid #09090b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: '-4px',
            zIndex: 0,
          }}>
            <span style={{ fontSize: '8px', color: '#a1a1aa' }}>+{items.length - 3}</span>
          </div>
        )}
      </div>
      
      <div style={{ fontSize: '12px' }}>
        {hasError ? (
          <span style={{ color: '#f87171' }}>执行失败</span>
        ) : activeItem ? (
          <span style={{ color: '#facc15' }}>调用 {activeItem.toolName} 中...</span>
        ) : (
          <span style={{ color: '#4ade80' }}>已完成 {completedCount}/{items.length}</span>
        )}
      </div>
    </div>
  );
};

export default ToolCallChain;