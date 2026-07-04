import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Renderer error boundary caught an error', error, errorInfo)
  }

  override render() {
    if (!this.state.error) {
      return this.props.children
    }

    const summary = this.state.error.message.trim() || '未知界面错误'

    return (
      <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
        <section className="w-full max-w-xl rounded-md border border-border bg-card p-6 shadow-lg">
          <div className="flex items-start gap-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-sm bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-4">
              <div className="space-y-2">
                <h1 className="text-xl font-semibold leading-7">界面出错</h1>
                <p className="break-words text-sm leading-6 text-muted-foreground">{summary}</p>
              </div>
              <Button onClick={() => window.location.reload()} type="button">
                <RefreshCw className="mr-2 h-4 w-4" />
                重新加载
              </Button>
            </div>
          </div>
        </section>
      </main>
    )
  }
}
