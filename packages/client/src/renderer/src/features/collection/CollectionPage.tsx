import { Button } from '@/components/ui/button'
import { RefreshCw, RotateCcw } from 'lucide-react'
import type { CollectionRecordRow } from '../../../../main/lib/collection-record-store'
import type { CollectionSession } from '../../../../main/lib/collection-session-manager'

interface CollectionPageProps {
  collectionSession: CollectionSession | null
  collectionRecords: CollectionRecordRow[]
  collectionError: string | null
  retryingRecordId: string | null
  onRefresh: () => void
  onRetryRecord: (recordId: string) => void
}

function collectionStatusLabel(status: CollectionRecordRow['status']) {
  switch (status) {
    case 'success':
      return '成功'
    case 'skipped':
      return '跳过'
    default:
      return '失败'
  }
}

function collectionStatusClassName(status: CollectionRecordRow['status']) {
  switch (status) {
    case 'success':
      return 'text-emerald-700'
    case 'skipped':
      return 'text-amber-700'
    default:
      return 'text-red-700'
  }
}

function fileNameFromPath(path: string | null | undefined) {
  if (!path) {
    return '未保存'
  }
  return path.split(/[\\/]/).at(-1) || path
}

export function CollectionPage({
  collectionSession,
  collectionRecords,
  collectionError,
  retryingRecordId,
  onRefresh,
  onRetryRecord,
}: CollectionPageProps) {
  return (
    <div className="rounded-md border bg-background p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-balance">当前采集记录</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {collectionSession
              ? `${collectionSession.platform} · ${collectionSession.mode === 'click' ? '点击模式' : '滚动模式'}`
              : '当前没有活动采集会话'}
          </p>
        </div>
        <Button onClick={onRefresh} type="button" variant="secondary">
          <RefreshCw className="mr-2 h-4 w-4" />
          刷新
        </Button>
      </div>

      {collectionError ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {collectionError}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-md border">
          <div className="border-b px-3 py-2 text-sm font-medium">
            最近保存（{collectionRecords.length}）
          </div>
          <div className="max-h-96 overflow-auto p-2">
            {collectionRecords.length ? (
              collectionRecords.map((record) => (
                <div
                  className="grid gap-3 rounded-md px-2 py-3 text-sm md:grid-cols-[96px_minmax(0,1fr)_auto]"
                  key={record.id}
                >
                  {record.savedPath && record.status !== 'failed' ? (
                    <img
                      alt=""
                      className="h-16 w-24 rounded-md border object-cover"
                      src={`file://${record.savedPath}`}
                    />
                  ) : (
                    <div className="flex h-16 w-24 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
                      无预览
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-medium">{fileNameFromPath(record.savedPath)}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {record.goodsLink ?? record.pageUrl}
                    </div>
                    {record.reason ? (
                      <div className="mt-1 text-xs text-red-700">{record.reason}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 md:justify-end">
                    <span
                      className={`text-xs font-medium ${collectionStatusClassName(record.status)}`}
                    >
                      {collectionStatusLabel(record.status)}
                    </span>
                    {record.status === 'failed' ? (
                      <Button
                        className="h-8 px-2"
                        disabled={retryingRecordId === record.id}
                        onClick={() => onRetryRecord(record.id)}
                        type="button"
                        variant="secondary"
                      >
                        <RotateCcw className="mr-2 h-3.5 w-3.5" />
                        重试
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="px-2 py-10 text-center text-sm text-muted-foreground">
                暂无采集记录
              </div>
            )}
          </div>
        </div>

        <div className="rounded-md border p-4">
          <h3 className="text-sm font-medium">当前会话</h3>
          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">状态</dt>
              <dd className="mt-1 font-medium">{collectionSession?.status ?? '未开始'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">输出目录</dt>
              <dd className="mt-1 break-all text-xs">{collectionSession?.output_dir ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">失败记录</dt>
              <dd className="mt-1 font-medium tabular-nums">
                {collectionRecords.filter((record) => record.status === 'failed').length}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  )
}
