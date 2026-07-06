import type { GenerationRunResult } from '../../../../../main/lib/generation-service'

export function GenerationFeedback({
  error,
  result,
}: {
  error: string | null
  result: GenerationRunResult | null
}) {
  if (!error && !result) {
    return null
  }

  return (
    <div className="rounded-md border bg-background p-4">
      {error ? (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}
      {result ? (
        <div className="rounded-md bg-muted px-3 py-2 text-sm">
          {result.cancelled ? '已取消' : '完成'}：成功 {result.succeeded}，失败 {result.failed}
          {result.diagnosticsLogPath ? (
            <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
              诊断日志：{result.diagnosticsLogPath}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
