import { describe, expect, it } from 'vitest'
import { formatIpcError } from './errors'

describe('formatIpcError', () => {
  it('strips a single Electron remote method prefix', () => {
    expect(
      formatIpcError(new Error("Error invoking remote method 'settings:save': Error: 保存失败")),
    ).toBe('保存失败')
  })

  it('strips nested Error prefixes after the Electron IPC prefix', () => {
    expect(
      formatIpcError(
        new Error("Error invoking remote method 'generation:start': Error: Error: 模型调用失败"),
      ),
    ).toBe('模型调用失败')
  })

  it('returns a Chinese fallback for non-Error objects without a usable message', () => {
    expect(formatIpcError({ code: 'HTTP_4XX' })).toBe('操作失败，请稍后重试')
  })

  it('keeps an already clean Chinese message unchanged', () => {
    expect(formatIpcError(new Error('请先在设置里选择工作区'))).toBe('请先在设置里选择工作区')
  })
})
