import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { AppErrorClass, type PhotoshopJob, type PhotoshopJsxJobFile } from '@tengyu-aipod/shared'
import { type TempFileManager, tempFileManager } from '../lib/temp-file-manager'

type TextWriter = (path: string, data: string, encoding: BufferEncoding) => Promise<void>

interface WritePhotoshopJobJsxOptions {
  tempFiles?: Pick<TempFileManager, 'createTaskDir'>
  writeTextFile?: TextWriter
}

export interface PhotoshopTemplateBatchJsxGroup {
  group_index: number
  sku_folder: string
  so_replacements: PhotoshopJob['so_replacements']
  clip_areas: PhotoshopJob['clip_areas']
  output_paths: string[]
  format: PhotoshopJob['format']
  jpg_quality: number
}

export interface PhotoshopTemplateBatchJsxInput {
  task_id: string
  mockup_path: string
  template_name: string
  groups: PhotoshopTemplateBatchJsxGroup[]
  result_file_path: string
  log_file_path: string
  cancel_file_path: string
}

export interface PhotoshopTemplateBatchJsxFile {
  jsx_path: string
  result_file_path: string
  log_file_path: string
  cancel_file_path: string
  content: string
}

function jsonString(value: unknown): string {
  return JSON.stringify(value)
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new AppErrorClass('INVALID_INPUT', `Photoshop JSX job 字段无效：${label}`, false, {
      value,
    })
  }
}

function validateJob(job: PhotoshopJob): void {
  if (!job.task_id) {
    throw new AppErrorClass('INVALID_INPUT', 'Photoshop JSX job 缺少 task_id', false)
  }
  if (!job.mockup_path) {
    throw new AppErrorClass('INVALID_INPUT', 'Photoshop JSX job 缺少 mockup_path', false)
  }
  if (!job.result_file_path) {
    throw new AppErrorClass('INVALID_INPUT', 'Photoshop JSX job 缺少 result_file_path', false)
  }
  if (job.so_replacements.length === 0) {
    throw new AppErrorClass('INVALID_INPUT', 'Photoshop JSX job 至少需要一个智能对象替换', false)
  }
  if (job.clip_areas.length === 0) {
    throw new AppErrorClass('INVALID_INPUT', 'Photoshop JSX job 至少需要一个裁切区域', false)
  }
  if (job.output_paths.length !== job.clip_areas.length) {
    throw new AppErrorClass(
      'INVALID_INPUT',
      'Photoshop JSX job 的 output_paths 数量必须等于 clip_areas 数量',
      false,
      {
        output_count: job.output_paths.length,
        clip_area_count: job.clip_areas.length,
      },
    )
  }
  if (job.format !== 'jpg' && job.format !== 'png') {
    throw new AppErrorClass('INVALID_INPUT', 'Photoshop JSX job 仅支持 jpg/png 导出', false, {
      format: job.format,
    })
  }
  if (!Number.isInteger(job.jpg_quality) || job.jpg_quality < 1 || job.jpg_quality > 12) {
    throw new AppErrorClass('INVALID_INPUT', 'JPG 质量必须是 1-12 的整数', false, {
      jpg_quality: job.jpg_quality,
    })
  }

  for (const [index, area] of job.clip_areas.entries()) {
    assertFiniteNumber(area.x, `clip_areas[${index}].x`)
    assertFiniteNumber(area.y, `clip_areas[${index}].y`)
    assertFiniteNumber(area.w, `clip_areas[${index}].w`)
    assertFiniteNumber(area.h, `clip_areas[${index}].h`)
  }
}

export function generateJsx(job: PhotoshopJob): string {
  validateJob(job)

  return `var CONFIG = ${jsonString({
    mockup_path: job.mockup_path,
    so_replacements: job.so_replacements,
    clip_areas: job.clip_areas,
    output_paths: job.output_paths,
    format: job.format,
    jpg_quality: job.jpg_quality,
  })};
var RESULT_FILE_PATH = ${jsonString(job.result_file_path)};

function escapeJsonString(value) {
  return String(value)
    .replace(/\\\\/g, '\\\\\\\\')
    .replace(/"/g, '\\\\"')
    .replace(/\\r/g, '\\\\r')
    .replace(/\\n/g, '\\\\n')
    .replace(/\\t/g, '\\\\t');
}

function toJson(value) {
  if (value === null) {
    return 'null';
  }
  var type = typeof value;
  if (type === 'string') {
    return '"' + escapeJsonString(value) + '"';
  }
  if (type === 'number') {
    return isFinite(value) ? String(value) : 'null';
  }
  if (type === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value instanceof Array) {
    var items = [];
    for (var i = 0; i < value.length; i++) {
      items.push(toJson(value[i]));
    }
    return '[' + items.join(',') + ']';
  }
  if (type === 'object') {
    var props = [];
    for (var key in value) {
      if (value.hasOwnProperty(key) && typeof value[key] !== 'undefined' && typeof value[key] !== 'function') {
        props.push('"' + escapeJsonString(key) + '":' + toJson(value[key]));
      }
    }
    return '{' + props.join(',') + '}';
  }
  return 'null';
}

function ensureParentFolder(filePath) {
  var file = new File(filePath);
  var folder = file.parent;
  if (!folder.exists) {
    createFolder(folder);
  }
}

function createFolder(folder) {
  if (folder.exists) {
    return;
  }
  if (folder.parent && !folder.parent.exists) {
    createFolder(folder.parent);
  }
  folder.create();
}

function writeResult(value) {
  ensureParentFolder(RESULT_FILE_PATH);
  var file = new File(RESULT_FILE_PATH);
  file.encoding = 'UTF8';
  file.open('w');
  file.write(toJson(value));
  file.close();
}

function findLayerByPath(container, layerPath) {
  var parts = String(layerPath).split('/');
  var current = container;
  for (var i = 0; i < parts.length; i++) {
    var name = parts[i];
    if (name === '') {
      continue;
    }
    if (i === parts.length - 1) {
      try {
        return current.artLayers.getByName(name);
      } catch (e1) {}
      try {
        return current.layerSets.getByName(name);
      } catch (e2) {}
      return null;
    }
    try {
      current = current.layerSets.getByName(name);
    } catch (e3) {
      return null;
    }
  }
  return null;
}

function replaceSmartObject(doc, replacement, result) {
  var layer = findLayerByPath(doc, replacement.layer_path);
  if (!layer) {
    result.stages.push({ stage: 'find_layer', ok: false, layer: replacement.layer_path });
    throw new Error('Smart object layer not found: ' + replacement.layer_path);
  }

  doc.activeLayer = layer;
  var desc = new ActionDescriptor();
  desc.putPath(charIDToTypeID('null'), new File(replacement.input_image));
  executeAction(stringIDToTypeID('placedLayerReplaceContents'), desc, DialogModes.NO);
  result.stages.push({
    stage: 'replace_so',
    ok: true,
    layer: replacement.layer_path,
    input: replacement.input_image
  });
}

function saveAs(doc, outputPath, format, jpgQuality) {
  ensureParentFolder(outputPath);
  var outputFile = new File(outputPath);
  if (format === 'jpg') {
    var jpgOptions = new JPEGSaveOptions();
    jpgOptions.quality = jpgQuality || 10;
    doc.saveAs(outputFile, jpgOptions, true, Extension.LOWERCASE);
    return;
  }
  if (format === 'png') {
    var pngOptions = new PNGSaveOptions();
    doc.saveAs(outputFile, pngOptions, true, Extension.LOWERCASE);
    return;
  }
  throw new Error('Unsupported export format: ' + format);
}

function exportOutputs(mockup, result) {
  for (var i = 0; i < CONFIG.clip_areas.length; i++) {
    var area = CONFIG.clip_areas[i];
    var outputPath = CONFIG.output_paths[i];
    if (CONFIG.clip_areas.length === 1 && area.is_full) {
      saveAs(mockup, outputPath, CONFIG.format, CONFIG.jpg_quality);
      result.outputs.push(outputPath);
      continue;
    }

    var duplicate = mockup.duplicate();
    try {
      duplicate.crop([area.x, area.y, area.x + area.w, area.y + area.h]);
      saveAs(duplicate, outputPath, CONFIG.format, CONFIG.jpg_quality);
      result.outputs.push(outputPath);
    } finally {
      try {
        duplicate.close(SaveOptions.DONOTSAVECHANGES);
      } catch (closeDuplicateError) {}
    }
  }
  result.stages.push({ stage: 'export', ok: true, outputs: result.outputs });
}

function runJob() {
  var previousRulerUnits = app.preferences.rulerUnits;
  var mockup = null;
  var result = { ok: false, stages: [], outputs: [] };

  try {
    app.preferences.rulerUnits = Units.PIXELS;
    mockup = app.open(new File(CONFIG.mockup_path));
    result.stages.push({ stage: 'open_mockup', ok: true, path: CONFIG.mockup_path });

    for (var i = 0; i < CONFIG.so_replacements.length; i++) {
      replaceSmartObject(mockup, CONFIG.so_replacements[i], result);
    }

    exportOutputs(mockup, result);
    result.ok = true;
  } catch (error) {
    result.ok = false;
    result.error = String(error);
    result.stages.push({ stage: 'error', ok: false, error: String(error) });
  } finally {
    try {
      app.preferences.rulerUnits = previousRulerUnits;
    } catch (restoreError) {}
    try {
      if (mockup) {
        mockup.close(SaveOptions.DONOTSAVECHANGES);
      }
    } catch (closeMockupError) {}
    writeResult(result);
  }
}

runJob();
`
}

function validateTemplateBatch(input: PhotoshopTemplateBatchJsxInput): void {
  if (!input.task_id) {
    throw new AppErrorClass('INVALID_INPUT', 'Photoshop batch JSX 缺少 task_id', false)
  }
  if (!input.mockup_path) {
    throw new AppErrorClass('INVALID_INPUT', 'Photoshop batch JSX 缺少 mockup_path', false)
  }
  if (input.groups.length === 0) {
    throw new AppErrorClass('INVALID_INPUT', 'Photoshop batch JSX 至少需要一个任务组', false)
  }
  for (const group of input.groups) {
    validateJob({
      task_id: input.task_id,
      group_index: group.group_index,
      mockup_path: input.mockup_path,
      so_replacements: group.so_replacements,
      clip_areas: group.clip_areas,
      output_paths: group.output_paths,
      format: group.format,
      jpg_quality: group.jpg_quality,
      result_file_path: input.result_file_path,
    })
  }
}

export function generateTemplateBatchJsx(input: PhotoshopTemplateBatchJsxInput): string {
  validateTemplateBatch(input)

  return `var CONFIG = ${jsonString({
    task_id: input.task_id,
    mockup_path: input.mockup_path,
    template_name: input.template_name,
    groups: input.groups,
    result_file_path: input.result_file_path,
    log_file_path: input.log_file_path,
    cancel_file_path: input.cancel_file_path,
  })};
var RESULT_FILE_PATH = ${jsonString(input.result_file_path)};
var LOG_FILE_PATH = ${jsonString(input.log_file_path)};
var CANCEL_FILE_PATH = ${jsonString(input.cancel_file_path)};

function escapeJsonString(value) {
  return String(value)
    .replace(/\\\\/g, '\\\\\\\\')
    .replace(/"/g, '\\\\"')
    .replace(/\\r/g, '\\\\r')
    .replace(/\\n/g, '\\\\n')
    .replace(/\\t/g, '\\\\t');
}

function toJson(value) {
  if (value === null) {
    return 'null';
  }
  var type = typeof value;
  if (type === 'string') {
    return '"' + escapeJsonString(value) + '"';
  }
  if (type === 'number') {
    return isFinite(value) ? String(value) : 'null';
  }
  if (type === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value instanceof Array) {
    var items = [];
    for (var i = 0; i < value.length; i++) {
      items.push(toJson(value[i]));
    }
    return '[' + items.join(',') + ']';
  }
  if (type === 'object') {
    var props = [];
    for (var key in value) {
      if (value.hasOwnProperty(key) && typeof value[key] !== 'undefined' && typeof value[key] !== 'function') {
        props.push('"' + escapeJsonString(key) + '":' + toJson(value[key]));
      }
    }
    return '{' + props.join(',') + '}';
  }
  return 'null';
}

function ensureParentFolder(filePath) {
  var file = new File(filePath);
  var folder = file.parent;
  if (!folder.exists) {
    createFolder(folder);
  }
}

function createFolder(folder) {
  if (folder.exists) {
    return;
  }
  if (folder.parent && !folder.parent.exists) {
    createFolder(folder.parent);
  }
  folder.create();
}

function appendLog(entry) {
  ensureParentFolder(LOG_FILE_PATH);
  entry.ts = new Date().getTime();
  entry.task_id = CONFIG.task_id;
  entry.template_name = CONFIG.template_name;
  var file = new File(LOG_FILE_PATH);
  file.encoding = 'UTF8';
  file.open('a');
  file.writeln(toJson(entry));
  file.close();
}

function writeResult(value) {
  ensureParentFolder(RESULT_FILE_PATH);
  var file = new File(RESULT_FILE_PATH);
  file.encoding = 'UTF8';
  file.open('w');
  file.write(toJson(value));
  file.close();
}

function cancelRequested() {
  return CANCEL_FILE_PATH && new File(CANCEL_FILE_PATH).exists;
}

function findLayerByPath(container, layerPath) {
  var parts = String(layerPath).split('/');
  var current = container;
  for (var i = 0; i < parts.length; i++) {
    var name = parts[i];
    if (name === '') {
      continue;
    }
    if (i === parts.length - 1) {
      try {
        return current.artLayers.getByName(name);
      } catch (e1) {}
      try {
        return current.layerSets.getByName(name);
      } catch (e2) {}
      return null;
    }
    try {
      current = current.layerSets.getByName(name);
    } catch (e3) {
      return null;
    }
  }
  return null;
}

function replaceSmartObject(doc, group, replacement) {
  appendLog({
    level: 'debug',
    stage: 'so_find',
    message: '定位智能对象',
    group: group.group_index,
    sku_folder: group.sku_folder,
    smart_object: replacement.layer_path,
    input: replacement.input_image
  });
  var layer = findLayerByPath(doc, replacement.layer_path);
  if (!layer) {
    throw new Error('Smart object layer not found: ' + replacement.layer_path);
  }

  doc.activeLayer = layer;
  var startedAt = new Date().getTime();
  var desc = new ActionDescriptor();
  desc.putPath(charIDToTypeID('null'), new File(replacement.input_image));
  executeAction(stringIDToTypeID('placedLayerReplaceContents'), desc, DialogModes.NO);
  appendLog({
    level: 'info',
    stage: 'so_replace',
    message: '替换智能对象',
    group: group.group_index,
    sku_folder: group.sku_folder,
    smart_object: replacement.layer_path,
    input: replacement.input_image,
    duration_ms: new Date().getTime() - startedAt
  });
}

function saveAs(doc, outputPath, format, jpgQuality) {
  ensureParentFolder(outputPath);
  var outputFile = new File(outputPath);
  if (format === 'jpg') {
    var jpgOptions = new JPEGSaveOptions();
    jpgOptions.quality = jpgQuality || 10;
    doc.saveAs(outputFile, jpgOptions, true, Extension.LOWERCASE);
    return;
  }
  if (format === 'png') {
    var pngOptions = new PNGSaveOptions();
    doc.saveAs(outputFile, pngOptions, true, Extension.LOWERCASE);
    return;
  }
  throw new Error('Unsupported export format: ' + format);
}

function exportOutputs(doc, group, groupResult) {
  appendLog({
    level: 'info',
    stage: 'export_start',
    message: '开始导出成品图',
    group: group.group_index,
    sku_folder: group.sku_folder
  });
  var startedAt = new Date().getTime();
  for (var i = 0; i < group.clip_areas.length; i++) {
    var area = group.clip_areas[i];
    var outputPath = group.output_paths[i];
    if (group.clip_areas.length === 1 && area.is_full) {
      saveAs(doc, outputPath, group.format, group.jpg_quality);
      groupResult.outputs.push(outputPath);
      continue;
    }

    var duplicate = doc.duplicate();
    try {
      duplicate.crop([area.x, area.y, area.x + area.w, area.y + area.h]);
      saveAs(duplicate, outputPath, group.format, group.jpg_quality);
      groupResult.outputs.push(outputPath);
    } finally {
      try {
        duplicate.close(SaveOptions.DONOTSAVECHANGES);
      } catch (closeDuplicateError) {}
    }
  }
  appendLog({
    level: 'info',
    stage: 'export_complete',
    message: '导出成品图完成',
    group: group.group_index,
    sku_folder: group.sku_folder,
    output_file: groupResult.outputs.join(','),
    duration_ms: new Date().getTime() - startedAt
  });
}

function runBatch() {
  var previousRulerUnits = app.preferences.rulerUnits;
  var baseDocument = null;
  var result = { ok: false, cancelled: false, groups: [], outputs: [] };
  var failed = false;
  var batchStartedAt = new Date().getTime();

  try {
    app.preferences.rulerUnits = Units.PIXELS;
    appendLog({ level: 'info', stage: 'task_start', message: '开始模板批处理' });
    appendLog({ level: 'info', stage: 'template_start', message: '开始处理模板' });
    appendLog({ level: 'info', stage: 'template_open', message: '打开模板' });
    baseDocument = app.open(new File(CONFIG.mockup_path));

    for (var i = 0; i < CONFIG.groups.length; i++) {
      var group = CONFIG.groups[i];
      if (cancelRequested()) {
        result.cancelled = true;
        appendLog({
          level: 'warn',
          stage: 'cancelled',
          message: '用户取消，停止后续分组',
          group: group.group_index,
          sku_folder: group.sku_folder
        });
        break;
      }

      var workingDocument = baseDocument.duplicate();
      var groupResult = {
        ok: false,
        group_index: group.group_index,
        sku_folder: group.sku_folder,
        outputs: []
      };
      var groupStartedAt = new Date().getTime();
      try {
        appendLog({
          level: 'info',
          stage: 'group_start',
          message: '开始处理套版组',
          group: group.group_index,
          sku_folder: group.sku_folder
        });
        for (var replacementIndex = 0; replacementIndex < group.so_replacements.length; replacementIndex++) {
          replaceSmartObject(workingDocument, group, group.so_replacements[replacementIndex]);
        }
        exportOutputs(workingDocument, group, groupResult);
        groupResult.ok = true;
        result.outputs = result.outputs.concat(groupResult.outputs);
        appendLog({
          level: 'info',
          stage: 'group_complete',
          message: '套版组完成',
          group: group.group_index,
          sku_folder: group.sku_folder,
          duration_ms: new Date().getTime() - groupStartedAt
        });
      } catch (groupError) {
        failed = true;
        groupResult.error = String(groupError);
        appendLog({
          level: 'error',
          stage: 'group_complete',
          message: '套版组失败',
          group: group.group_index,
          sku_folder: group.sku_folder,
          error: String(groupError),
          duration_ms: new Date().getTime() - groupStartedAt
        });
        result.groups.push(groupResult);
        break;
      } finally {
        try {
          workingDocument.close(SaveOptions.DONOTSAVECHANGES);
        } catch (closeWorkingError) {}
      }
      result.groups.push(groupResult);
    }

    result.ok = !failed && !result.cancelled;
    if (result.cancelled) {
      appendLog({
        level: 'warn',
        stage: 'task_complete',
        message: '套版任务已取消',
        duration_ms: new Date().getTime() - batchStartedAt
      });
    } else if (!failed) {
      appendLog({
        level: 'info',
        stage: 'task_complete',
        message: '套版任务完成',
        duration_ms: new Date().getTime() - batchStartedAt
      });
    }
  } catch (error) {
    failed = true;
    result.ok = false;
    result.error = String(error);
    appendLog({
      level: 'error',
      stage: 'task_complete',
      message: '套版任务失败',
      error: String(error),
      duration_ms: new Date().getTime() - batchStartedAt
    });
  } finally {
    try {
      app.preferences.rulerUnits = previousRulerUnits;
    } catch (restoreError) {}
    try {
      if (baseDocument) {
        baseDocument.close(SaveOptions.DONOTSAVECHANGES);
      }
    } catch (closeBaseError) {}
    writeResult(result);
  }
}

runBatch();
`
}

export async function writePhotoshopJobJsx(
  job: Omit<PhotoshopJob, 'result_file_path'>,
  options: WritePhotoshopJobJsxOptions = {},
): Promise<PhotoshopJsxJobFile> {
  const tempFiles = options.tempFiles ?? tempFileManager
  const writeTextFile = options.writeTextFile ?? writeFile
  const taskDir = await tempFiles.createTaskDir('photoshop', job.task_id)
  const jsxPath = join(taskDir, `job-${job.group_index}.jsx`)
  const resultFilePath = join(taskDir, `job-${job.group_index}-result.json`)
  const content = generateJsx({
    ...job,
    mockup_path: resolve(job.mockup_path),
    output_paths: job.output_paths.map((outputPath) => resolve(outputPath)),
    so_replacements: job.so_replacements.map((replacement) => ({
      ...replacement,
      input_image: resolve(replacement.input_image),
    })),
    result_file_path: resultFilePath,
  })

  await writeTextFile(jsxPath, content, 'utf8')
  return {
    jsx_path: jsxPath,
    result_file_path: resultFilePath,
    content,
  }
}

export async function writePhotoshopTemplateBatchJsx(
  input: Omit<PhotoshopTemplateBatchJsxInput, 'result_file_path' | 'log_file_path'> & {
    result_file_path?: string
    log_file_path?: string
  },
  options: WritePhotoshopJobJsxOptions = {},
): Promise<PhotoshopTemplateBatchJsxFile> {
  const tempFiles = options.tempFiles ?? tempFileManager
  const writeTextFile = options.writeTextFile ?? writeFile
  const taskDir = await tempFiles.createTaskDir('photoshop', input.task_id)
  const jsxPath = join(taskDir, `template-${input.template_name}.jsx`)
  const resultFilePath = input.result_file_path ?? join(taskDir, `template-${input.template_name}-result.json`)
  const logFilePath = input.log_file_path ?? join(taskDir, `template-${input.template_name}.jsonl`)
  const content = generateTemplateBatchJsx({
    ...input,
    mockup_path: resolve(input.mockup_path),
    groups: input.groups.map((group) => ({
      ...group,
      output_paths: group.output_paths.map((outputPath) => resolve(outputPath)),
      so_replacements: group.so_replacements.map((replacement) => ({
        ...replacement,
        input_image: resolve(replacement.input_image),
      })),
    })),
    result_file_path: resultFilePath,
    log_file_path: logFilePath,
  })

  await writeTextFile(jsxPath, content, 'utf8')
  return {
    jsx_path: jsxPath,
    result_file_path: resultFilePath,
    log_file_path: logFilePath,
    cancel_file_path: input.cancel_file_path,
    content,
  }
}
