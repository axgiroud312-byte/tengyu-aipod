import { join } from 'node:path'
import type { PhotoshopJob } from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import { generateJsx, generateTemplateBatchJsx, writePhotoshopJobJsx } from './jsx-generator'

function createJob(overrides: Partial<PhotoshopJob> = {}): PhotoshopJob {
  return {
    task_id: 'task-1',
    group_index: 2,
    mockup_path: 'C:\\Users\\niilo\\Desktop\\钥匙扣x.psd',
    so_replacements: [
      {
        layer_path: 'mockup/智能对象 1',
        input_image: 'C:\\Users\\niilo\\Desktop\\印花素材\\sku-1.png',
      },
      {
        layer_path: 'mockup/智能对象 2',
        input_image: 'C:\\Users\\niilo\\Desktop\\印花素材\\sku-2.png',
      },
    ],
    clip_areas: [
      { x: 0, y: 0, w: 500, h: 500, is_full: false },
      { x: 500, y: 0, w: 500, h: 500, is_full: false },
    ],
    output_paths: [
      'C:\\Users\\niilo\\Desktop\\新建文件夹\\sku-1\\01.jpg',
      'C:\\Users\\niilo\\Desktop\\新建文件夹\\sku-1\\02.jpg',
    ],
    format: 'jpg',
    jpg_quality: 11,
    result_file_path: 'C:\\tmp\\photoshop\\task-1\\job-2-result.json',
    ...overrides,
  }
}

describe('generateJsx', () => {
  it('renders a path A JSX job with multiple smart object replacements and crop exports', () => {
    const jsx = generateJsx(createJob())

    expect(jsx).toContain('placedLayerReplaceContents')
    expect(jsx).toContain('findLayerByPath(doc, replacement.layer_path)')
    expect(jsx).toContain('mockup.duplicate()')
    expect(jsx).toContain('duplicate.crop([area.x, area.y, area.x + area.w, area.y + area.h])')
    expect(jsx).toContain('new JPEGSaveOptions()')
    expect(jsx).toContain('jpgOptions.quality = jpgQuality || 10')
    expect(jsx).toContain('writeResult(result)')
    expect(jsx).toContain('SaveOptions.DONOTSAVECHANGES')
    expect(jsx).toContain('"layer_path":"mockup/智能对象 1"')
  })

  it('renders PNG export support without relying on JSON.stringify inside Photoshop', () => {
    const jsx = generateJsx(
      createJob({
        format: 'png',
        jpg_quality: 10,
        clip_areas: [{ x: 0, y: 0, w: 1000, h: 500, is_full: true }],
        output_paths: ['C:\\Users\\niilo\\Desktop\\新建文件夹\\sku-1\\01.png'],
      }),
    )

    expect(jsx).toContain('new PNGSaveOptions()')
    expect(jsx).toContain('function toJson(value)')
    expect(jsx).not.toContain('JSON.stringify(result)')
  })

  it('rejects mismatched crop and output counts before generating JSX', () => {
    expect(() =>
      generateJsx(
        createJob({
          output_paths: ['C:\\Users\\niilo\\Desktop\\新建文件夹\\sku-1\\01.jpg'],
        }),
      ),
    ).toThrow('output_paths 数量必须等于 clip_areas 数量')
  })
})

describe('generateTemplateBatchJsx', () => {
  it('renders a template-level JSX batch with document duplication, logs, and cancel checks', () => {
    const jsx = generateTemplateBatchJsx({
      task_id: 'task-1',
      mockup_path: 'C:\\templates\\mockup.psd',
      template_name: 'mockup',
      result_file_path: 'C:\\tmp\\result.json',
      log_file_path: 'C:\\tmp\\photoshop-task.log',
      cancel_file_path: 'C:\\tmp\\cancel.flag',
      groups: [
        {
          group_index: 0,
          sku_folder: 'sku-1',
          so_replacements: [
            {
              layer_path: 'SO 1',
              input_image: 'C:\\prints\\sku-1.png',
            },
          ],
          clip_areas: [{ x: 0, y: 0, w: 500, h: 500, is_full: true }],
          output_paths: ['C:\\outputs\\sku-1\\mockup\\01.jpg'],
          format: 'jpg',
          jpg_quality: 10,
        },
      ],
    })

    expect(jsx).toContain('baseDocument = app.open(new File(CONFIG.mockup_path))')
    expect(jsx).toContain('var workingDocument = baseDocument.duplicate()')
    expect(jsx).toContain('appendLog({')
    expect(jsx).toContain("stage: 'so_replace'")
    expect(jsx).toContain('cancelRequested()')
    expect(jsx).toContain('writeResult(result)')
    expect(jsx).toContain('SaveOptions.DONOTSAVECHANGES')
  })
})

describe('writePhotoshopJobJsx', () => {
  it('writes job JSX into .workbench tmp photoshop task directory', async () => {
    const writes: Array<{ path: string; data: string }> = []
    const taskDir = join('C:\\workbench', '.workbench', 'tmp', 'photoshop', 'task-1')
    const { result_file_path: _resultFilePath, ...jobWithoutResultPath } = createJob()

    const result = await writePhotoshopJobJsx(jobWithoutResultPath, {
      tempFiles: {
        createTaskDir: async (module, taskId) => {
          expect(module).toBe('photoshop')
          expect(taskId).toBe('task-1')
          return taskDir
        },
      },
      writeTextFile: async (path, data) => {
        writes.push({ path, data })
      },
    })

    expect(result.jsx_path).toBe(join(taskDir, 'job-2.jsx'))
    expect(result.result_file_path).toBe(join(taskDir, 'job-2-result.json'))
    expect(result.content).toContain(
      `var RESULT_FILE_PATH = ${JSON.stringify(result.result_file_path)}`,
    )
    expect(writes).toEqual([{ path: result.jsx_path, data: result.content }])
  })
})
