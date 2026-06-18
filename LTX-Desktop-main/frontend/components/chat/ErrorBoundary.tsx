import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-400 mb-3" />
          <p className="text-xs text-zinc-400 mb-1">Something went wrong</p>
          <p className="text-[10px] text-zinc-600 max-w-xs truncate">
            {this.state.error?.message || 'Unknown error'}
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
