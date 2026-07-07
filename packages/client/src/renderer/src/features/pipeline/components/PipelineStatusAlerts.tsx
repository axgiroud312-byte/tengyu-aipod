export function PipelineStatusAlerts({
  error,
  showMacPhotoshopNotice,
}: {
  error: string | null
  showMacPhotoshopNotice: boolean
}) {
  if (!error && !showMacPhotoshopNotice) {
    return null
  }

  return (
    <>
      {showMacPhotoshopNotice ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          PS 套版 v1 仅支持 Windows，当前电脑不能启动完整任务。
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
    </>
  )
}
