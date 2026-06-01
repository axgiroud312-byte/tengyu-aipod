import { describe, expect, it } from 'vitest'
import type { GenerationDebugLogEntry } from '../../../../main/lib/generation-service'
import { formatGenerationDebugLogLine, generationDebugLogLevelCounts } from './generation-debug-log'

describe('generation debug log formatter', () => {
  it('formats progress details into one terminal line', () => {
    const entry: GenerationDebugLogEntry = {
      id: '1',
      timestamp: new Date('2026-05-31T08:09:10.011Z').getTime(),
      level: 'debug',
      message: '正在处理提示词',
      taskId: 'gen_1',
      capability: 'txt2img',
      details: {
        operation: 'progress',
        processed: 3,
        total: 10,
        succeeded: 2,
        failed: 1,
        prompt: 'centered y2k print',
      },
    }

    expect(formatGenerationDebugLogLine(entry)).toContain('[DEBUG] [文生图] 正在处理提示词')
    expect(formatGenerationDebugLogLine(entry)).toContain('task=gen_1')
    expect(formatGenerationDebugLogLine(entry)).toContain('进度 3/10')
    expect(formatGenerationDebugLogLine(entry)).toContain('centered y2k print')
  })

  it('formats ComfyUI request details with workflow and prompt context', () => {
    const entry: GenerationDebugLogEntry = {
      id: '2',
      timestamp: new Date('2026-05-31T08:09:10.011Z').getTime(),
      level: 'debug',
      message: '发送 ComfyUI 请求',
      taskId: 'extract_1',
      capability: 'extract',
      details: {
        operation: 'request',
        provider: 'comfyui-chenyu',
        workflowName: '单张提取api1111',
        workflowVersion: '1.0.0',
        workflowId: 'extract-abc',
        sourceIndex: 3,
        total: 12,
        sourceImage: 'source.png',
        prompt: '提取产品表面清晰可见的印花',
      },
    }

    const line = formatGenerationDebugLogLine(entry)

    expect(line).toContain('[DEBUG] [提取] 发送 ComfyUI 请求')
    expect(line).toContain('workflow=单张提取api1111')
    expect(line).toContain('version=1.0.0')
    expect(line).toContain('workflowId=extract-abc')
    expect(line).toContain('第 3 项')
    expect(line).toContain('源图=source.png')
    expect(line).toContain('提取产品表面清晰可见的印花')
  })

  it('formats prompt generation skill and raw response details', () => {
    const entry: GenerationDebugLogEntry = {
      id: '3',
      timestamp: new Date('2026-05-31T08:09:10.011Z').getTime(),
      level: 'error',
      message: '提示词生成失败',
      capability: 'img2img',
      details: {
        operation: 'prompt',
        model: 'qwen3.6-flash',
        skillId: 'img2img-local-reference',
        skillVersion: '1.0.0',
        expected: 2,
        actual: 0,
        rawResponsePreview: '{"prompt":"missing array"}',
        error: '模型返回 JSON 缺少 prompts 字符串数组',
      },
    }

    const line = formatGenerationDebugLogLine(entry)

    expect(line).toContain('[ERROR] [图生图] 提示词生成失败')
    expect(line).toContain('model=qwen3.6-flash')
    expect(line).toContain('skill=img2img-local-reference')
    expect(line).toContain('skillVersion=1.0.0')
    expect(line).toContain('期望 2 / 实际 0')
    expect(line).toContain('原始返回={"prompt":"missing array"}')
  })

  it('counts warning and error logs', () => {
    expect(
      generationDebugLogLevelCounts([
        debugEntry('1', 'debug'),
        debugEntry('2', 'warn'),
        debugEntry('3', 'error'),
      ]),
    ).toEqual({ warn: 1, error: 1 })
  })
})

function debugEntry(id: string, level: GenerationDebugLogEntry['level']): GenerationDebugLogEntry {
  return {
    id,
    timestamp: 0,
    level,
    message: 'log',
  }
}
