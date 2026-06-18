import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { stream } from '../../utils/markdown-stream'
import { usePacedMarkdown } from '../../hooks/usePacedMarkdown'
import type { Block } from '../../utils/markdown-stream'

interface MarkdownMessageProps {
  content: string
  isStreaming: boolean
}

const rawCodeBlockStyle: React.CSSProperties = {
  background: 'rgb(9, 9, 11)',
  borderRadius: '6px',
  border: '1px solid rgba(63, 63, 70, 0.5)',
  overflowX: 'auto',
  padding: '10px 12px',
  margin: '8px 0',
}

const rawCodeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: '11px',
  color: '#d4d4d8',
}

function PacedBlock({ block, isLast, isStreaming }: { block: Block; isLast: boolean; isStreaming: boolean }) {
  const pacedSrc = usePacedMarkdown(block.src, isStreaming)
  const pacedRaw = usePacedMarkdown(block.raw, isStreaming)

  const isRawCode = isLast && isStreaming && (block.raw.startsWith('```') || block.raw.startsWith('~~~'))

  if (isRawCode) {
    return (
      <pre style={rawCodeBlockStyle}>
        <code style={rawCodeStyle}>{pacedRaw}</code>
      </pre>
    )
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre: ({ children, ...props }: any) => (
          <pre className="bg-zinc-950 rounded-lg border border-zinc-700/50 overflow-x-auto my-2" {...props}>
            {children}
          </pre>
        ),
        code: ({ className, children, ...props }: any) => {
          const isInline = !className
          if (isInline) {
            return (
              <code className="bg-zinc-700/50 text-zinc-200 px-1 py-0.5 rounded text-[11px] font-mono" {...props}>
                {children}
              </code>
            )
          }
          return (
            <code className={`${className || ''} text-[11px] font-mono`} {...props}>
              {children}
            </code>
          )
        },
        p: ({ children, ...props }: any) => (
          <p className="mb-1.5 last:mb-0 text-zinc-200" {...props}>{children}</p>
        ),
        ul: ({ children, ...props }: any) => (
          <ul className="list-disc pl-4 mb-1.5 space-y-0.5 text-zinc-200" {...props}>{children}</ul>
        ),
        ol: ({ children, ...props }: any) => (
          <ol className="list-decimal pl-4 mb-1.5 space-y-0.5 text-zinc-200" {...props}>{children}</ol>
        ),
        blockquote: ({ children, ...props }: any) => (
          <blockquote className="border-l-2 border-zinc-600 pl-3 my-1.5 text-zinc-400 italic" {...props}>{children}</blockquote>
        ),
        a: ({ children, href, ...props }: any) => (
          <a className="text-blue-400 hover:text-blue-300 underline" href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
        ),
        table: ({ children, ...props }: any) => (
          <div className="overflow-x-auto my-2">
            <table className="w-full text-[11px] border-collapse" {...props}>{children}</table>
          </div>
        ),
        th: ({ children, ...props }: any) => (
          <th className="border border-zinc-700 px-2 py-1 text-left bg-zinc-800 font-medium text-zinc-300" {...props}>{children}</th>
        ),
        td: ({ children, ...props }: any) => (
          <td className="border border-zinc-700 px-2 py-1 text-zinc-300" {...props}>{children}</td>
        ),
        hr: ({ ...props }: any) => (
          <hr className="border-zinc-700 my-2" {...props} />
        ),
      }}
    >
      {pacedSrc}
    </ReactMarkdown>
  )
}

export const MarkdownMessage = memo(function MarkdownMessage({ content, isStreaming }: MarkdownMessageProps) {
  const blocks = useMemo(() => stream(content, isStreaming), [content, isStreaming])

  if (!content.trim()) return null

  return (
    <div className="markdown-body text-xs leading-relaxed">
      {blocks.map((block, i) => (
        <PacedBlock
          key={i}
          block={block}
          isLast={i === blocks.length - 1}
          isStreaming={isStreaming}
        />
      ))}
    </div>
  )
})
