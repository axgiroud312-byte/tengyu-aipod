import type { TitleBatchConfig, TitleBatchResult } from '../../../../main/lib/title-service'

export type TitleResultStatus = '成功' | '失败' | '已有' | '重试中' | '处理中' | '待生成'

export type TitleResultRow = {
  skuCode: string
  title: string
  status: TitleResultStatus
}

type TitleResultRowsState = {
  scanResult: {
    skuCodes: string[]
    existingTitles: Record<string, string>
  } | null
  result: TitleBatchResult | null
  existingStrategy: NonNullable<TitleBatchConfig['existingStrategy']>
  isRetryingFailed: boolean
}

function titleFailureReason(error: string) {
  return error === 'NO_IMAGE' ? '货号文件夹没有可用图片' : error
}

export function titleResultRows(state: TitleResultRowsState, isRunning: boolean): TitleResultRow[] {
  const skuCodes =
    state.scanResult?.skuCodes ?? state.result?.results.map((item) => item.skuCode) ?? []
  const existingTitles = state.scanResult?.existingTitles ?? {}
  const resultBySku = new Map(state.result?.results.map((item) => [item.skuCode, item]) ?? [])

  return skuCodes.map((skuCode): TitleResultRow => {
    const result = resultBySku.get(skuCode)
    if (result?.status === 'success') {
      return { skuCode, title: result.title, status: '成功' }
    }
    if (result?.status === 'failed') {
      return {
        skuCode,
        title: `${state.isRetryingFailed ? '正在重试' : '失败'}：${titleFailureReason(result.error)}`,
        status: state.isRetryingFailed ? '重试中' : '失败',
      }
    }
    if (result?.status === 'skipped') {
      return { skuCode, title: result.title, status: '已有' }
    }

    const existingTitle = existingTitles[skuCode]
    if (existingTitle && state.existingStrategy === 'skip') {
      return { skuCode, title: existingTitle, status: '已有' }
    }
    return {
      skuCode,
      title: existingTitle || '等待生成标题',
      status: isRunning ? '处理中' : '待生成',
    }
  })
}

export function mergeTitleBatchResult(
  current: TitleBatchResult,
  retry: TitleBatchResult,
): TitleBatchResult {
  const retryResults = new Map(retry.results.map((item) => [item.skuCode, item]))
  const mergedResults = current.results.map((item) => retryResults.get(item.skuCode) ?? item)
  const knownSkuCodes = new Set(mergedResults.map((item) => item.skuCode))
  for (const item of retry.results) {
    if (!knownSkuCodes.has(item.skuCode)) {
      mergedResults.push(item)
    }
  }

  let succeeded = 0
  let failed = 0
  let skipped = 0
  for (const item of mergedResults) {
    if (item.status === 'success') succeeded += 1
    if (item.status === 'failed') failed += 1
    if (item.status === 'skipped') skipped += 1
  }

  return {
    ...retry,
    total: mergedResults.length,
    succeeded,
    failed,
    skipped,
    results: mergedResults,
  }
}
