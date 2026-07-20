import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  AppErrorClass,
  type PhotoshopCancellationMode,
  type PhotoshopJob,
  type PhotoshopJsxJobFile,
  type PhotoshopSmartObjectReplaceMode,
  type PsdNativeSlice,
} from '@tengyu-aipod/shared'
import { type TempFileManager, tempFileManager } from '../lib/temp-file-manager'

type TextWriter = (path: string, data: string, encoding: BufferEncoding) => Promise<void>

interface WritePhotoshopJobJsxOptions {
  tempFiles?: Pick<TempFileManager, 'createTaskDir'>
  writeTextFile?: TextWriter
}

export interface PhotoshopTemplateBatchJsxGroup {
  group_index: number
  sku_folder: string
  smart_object_replace_mode?: PhotoshopSmartObjectReplaceMode
  so_replacements: PhotoshopJob['so_replacements']
  clip_areas: PhotoshopJob['clip_areas']
  output_paths: string[]
  format: PhotoshopJob['format']
  jpg_quality: number
}

/** How often batch JSX purges Photoshop history caches between groups. */
export const PHOTOSHOP_BATCH_PURGE_EVERY_GROUPS = 25

export interface PhotoshopTemplateBatchJsxInput {
  task_id: string
  mockup_path: string
  template_name: string
  smart_object_replace_mode?: PhotoshopSmartObjectReplaceMode
  native_slices?: PsdNativeSlice[]
  /** Purge history caches every N successfully finished groups. 0 disables purge. */
  purge_every_groups?: number
  groups: PhotoshopTemplateBatchJsxGroup[]
  result_file_path: string
  log_file_path: string
  cancel_file_path: string
  cancellation_mode?: PhotoshopCancellationMode
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
    smart_object_replace_mode: job.smart_object_replace_mode,
    so_replacements: job.so_replacements,
    clip_areas: job.clip_areas,
    output_paths: job.output_paths,
    format: job.format,
    jpg_quality: job.jpg_quality,
  })};
var RESULT_FILE_PATH = ${jsonString(job.result_file_path)};
var GENERATED_ARTWORK_LAYER_NAME = '__TENGYU_ARTWORK__';
var SMART_OBJECT_CANVAS_CACHE = {};
var NORMALIZED_INPUT_INDEX = 0;

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

function normalizedFsPath(filePath) {
  return String(new File(filePath).fsName).toLowerCase();
}

function assertDocumentNotOpen(filePath, label) {
  var targetPath = normalizedFsPath(filePath);
  for (var i = 0; i < app.documents.length; i++) {
    try {
      if (normalizedFsPath(app.documents[i].fullName.fsName) === targetPath) {
        throw new Error(label + ' is already open in Photoshop. Close it before starting: ' + filePath);
      }
    } catch (documentPathError) {
      if (String(documentPathError).indexOf('is already open in Photoshop') >= 0) {
        throw documentPathError;
      }
    }
  }
}

function snapshotOpenDocuments() {
  var documents = [];
  for (var i = 0; i < app.documents.length; i++) {
    documents.push(app.documents[i]);
  }
  return documents;
}

function documentWasOpen(document, documents) {
  for (var i = 0; i < documents.length; i++) {
    if (documents[i] === document) {
      return true;
    }
  }
  return false;
}

function documentIsInsidePhotoshopTemp(document) {
  try {
    var documentPath = String(document.fullName.fsName).toLowerCase();
    var tempPath = String(Folder.temp.fsName).toLowerCase();
    return (
      documentPath === tempPath ||
      documentPath.indexOf(tempPath + '\\\\') === 0 ||
      documentPath.indexOf(tempPath + '/') === 0
    );
  } catch (documentPathError) {
    return false;
  }
}

function saveSmartObjectDocument(document) {
  var smartObjectFile = new File(document.fullName.fsName);
  var fileName = String(smartObjectFile.name).toLowerCase();
  var dotIndex = fileName.lastIndexOf('.');
  var extension = dotIndex >= 0 ? fileName.substring(dotIndex + 1) : '';
  var previousDialogs = app.displayDialogs;
  app.displayDialogs = DialogModes.NO;
  try {
    if (extension === 'png') {
      document.saveAs(smartObjectFile, new PNGSaveOptions(), false, Extension.LOWERCASE);
      return;
    }
    if (extension === 'jpg' || extension === 'jpeg') {
      var jpgOptions = new JPEGSaveOptions();
      jpgOptions.quality = 12;
      document.saveAs(smartObjectFile, jpgOptions, false, Extension.LOWERCASE);
      return;
    }
    if (extension === 'psd') {
      var psdOptions = new PhotoshopSaveOptions();
      psdOptions.layers = true;
      document.saveAs(smartObjectFile, psdOptions, false, Extension.LOWERCASE);
      return;
    }
    if (extension === 'psb') {
      var psbOptions = new LargeDocumentFormatSaveOptions();
      psbOptions.layers = true;
      document.saveAs(smartObjectFile, psbOptions, false, Extension.LOWERCASE);
      return;
    }
    if (extension === 'tif' || extension === 'tiff') {
      var tiffOptions = new TiffSaveOptions();
      tiffOptions.layers = true;
      document.saveAs(smartObjectFile, tiffOptions, false, Extension.LOWERCASE);
      return;
    }
    throw new Error('Unsupported smart object temporary format: ' + smartObjectFile.name);
  } finally {
    app.displayDialogs = previousDialogs;
  }
}

function positiveFiniteNumber(value, label) {
  var number = Number(value);
  if (!isFinite(number) || number <= 0) {
    throw new Error(label + ' must be a positive finite number');
  }
  return number;
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

function findLayerByNameRecursive(container, layerName) {
  for (var i = 0; i < container.artLayers.length; i++) {
    if (container.artLayers[i].name === layerName) {
      return container.artLayers[i];
    }
  }
  for (var j = 0; j < container.layerSets.length; j++) {
    var layerSet = container.layerSets[j];
    if (layerSet.name === layerName) {
      return layerSet;
    }
    var nested = findLayerByNameRecursive(layerSet, layerName);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function removeGeneratedArtwork(container) {
  var removed = 0;
  for (var i = container.artLayers.length - 1; i >= 0; i--) {
    if (container.artLayers[i].name === GENERATED_ARTWORK_LAYER_NAME) {
      container.artLayers[i].remove();
      removed++;
    }
  }
  for (var j = container.layerSets.length - 1; j >= 0; j--) {
    removed += removeGeneratedArtwork(container.layerSets[j]);
  }
  return removed;
}

function getLayerBoundsPx(layer) {
  var bounds = layer.bounds;
  var left = Number(bounds[0].value);
  var top = Number(bounds[1].value);
  var right = Number(bounds[2].value);
  var bottom = Number(bounds[3].value);
  return {
    left: left,
    top: top,
    right: right,
    bottom: bottom,
    width: right - left,
    height: bottom - top
  };
}

function getDocumentBoundsPx(doc) {
  return {
    left: 0,
    top: 0,
    right: Number(doc.width.value),
    bottom: Number(doc.height.value),
    width: Number(doc.width.value),
    height: Number(doc.height.value)
  };
}

function placeImage(filePath) {
  var inputFile = new File(filePath);
  if (!inputFile.exists) {
    throw new Error('Smart object input image not found: ' + filePath);
  }
  var desc = new ActionDescriptor();
  desc.putPath(charIDToTypeID('null'), inputFile);
  executeAction(charIDToTypeID('Plc '), desc, DialogModes.NO);
  return app.activeDocument.activeLayer;
}

function fitLayerToBounds(layer, targetBounds, mode) {
  var layerBounds = getLayerBoundsPx(layer);
  if (layerBounds.width <= 0 || layerBounds.height <= 0) {
    throw new Error('Placed artwork has empty bounds');
  }
  if (targetBounds.width <= 0 || targetBounds.height <= 0) {
    throw new Error('Smart object target has empty bounds');
  }
  var scaleX = targetBounds.width / layerBounds.width;
  var scaleY = targetBounds.height / layerBounds.height;
  var scale = mode === 'fill' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  layer.resize(scale * 100, scale * 100, AnchorPosition.MIDDLECENTER);

  var resized = getLayerBoundsPx(layer);
  var layerCenterX = resized.left + resized.width / 2;
  var layerCenterY = resized.top + resized.height / 2;
  var targetCenterX = targetBounds.left + targetBounds.width / 2;
  var targetCenterY = targetBounds.top + targetBounds.height / 2;
  layer.translate(targetCenterX - layerCenterX, targetCenterY - layerCenterY);
}

function getLayerBoundsArray(layer) {
  var bounds = getLayerBoundsPx(layer);
  return [bounds.left, bounds.top, bounds.right, bounds.bottom];
}

function readSmartObjectCanvas(doc, layer, cacheKey) {
  if (SMART_OBJECT_CANVAS_CACHE[cacheKey]) {
    return SMART_OBJECT_CANVAS_CACHE[cacheKey];
  }
  var openDocuments = snapshotOpenDocuments();
  doc.activeLayer = layer;
  executeAction(stringIDToTypeID('placedLayerEditContents'), new ActionDescriptor(), DialogModes.NO);
  var soDoc = app.activeDocument;
  if (!soDoc || soDoc === doc) {
    throw new Error('Photoshop did not open smart object contents: ' + cacheKey);
  }
  var canvas = null;
  try {
    canvas = {
      width: Math.round(positiveFiniteNumber(soDoc.width.value, 'Smart object width')),
      height: Math.round(positiveFiniteNumber(soDoc.height.value, 'Smart object height')),
      resolution: positiveFiniteNumber(soDoc.resolution, 'Smart object resolution')
    };
  } finally {
    if (!documentWasOpen(soDoc, openDocuments)) {
      try {
        soDoc.close(SaveOptions.DONOTSAVECHANGES);
      } catch (closeSmartObjectError) {}
    }
    app.activeDocument = doc;
  }
  SMART_OBJECT_CANVAS_CACHE[cacheKey] = canvas;
  return canvas;
}

function normalizeInputForSmartObject(doc, layer, replacement, cacheKey) {
  var canvas = readSmartObjectCanvas(doc, layer, cacheKey);
  var inputFile = new File(replacement.input_image);
  if (!inputFile.exists) {
    throw new Error('Smart object input image not found: ' + replacement.input_image);
  }
  assertDocumentNotOpen(inputFile.fsName, 'Input image');
  var inputDocument = null;
  try {
    inputDocument = app.open(inputFile);
    var sourceWidth = positiveFiniteNumber(inputDocument.width.value, 'Input image width');
    var sourceHeight = positiveFiniteNumber(inputDocument.height.value, 'Input image height');
    var scaleX = canvas.width / sourceWidth;
    var scaleY = canvas.height / sourceHeight;
    var fitMode = replacement.inner_fit_mode || 'fill';
    var scale = fitMode === 'fill' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
    var scaledWidth = Math.max(1, Math.round(sourceWidth * scale));
    var scaledHeight = Math.max(1, Math.round(sourceHeight * scale));
    inputDocument.resizeImage(
      UnitValue(scaledWidth, 'px'),
      UnitValue(scaledHeight, 'px'),
      canvas.resolution,
      ResampleMethod.BICUBIC
    );
    try {
      inputDocument.backgroundLayer.isBackgroundLayer = false;
    } catch (noBackgroundLayerError) {}
    inputDocument.resizeCanvas(
      UnitValue(canvas.width, 'px'),
      UnitValue(canvas.height, 'px'),
      AnchorPosition.MIDDLECENTER
    );

    var normalizedFolder = new Folder(new File(RESULT_FILE_PATH).parent.fsName + '/normalized-inputs');
    createFolder(normalizedFolder);
    var normalizedFile = new File(
      normalizedFolder.fsName + '/input-' + (++NORMALIZED_INPUT_INDEX) + '.psd'
    );
    if (normalizedFile.exists) {
      normalizedFile.remove();
    }
    var saveOptions = new PhotoshopSaveOptions();
    saveOptions.layers = true;
    inputDocument.saveAs(normalizedFile, saveOptions, true, Extension.LOWERCASE);
    return {
      file: normalizedFile,
      canvas: canvas,
      source_width: sourceWidth,
      source_height: sourceHeight,
      fit_mode: fitMode
    };
  } finally {
    var closeFailure = null;
    for (var closeAttempt = 0; closeAttempt < 3; closeAttempt++) {
      try {
        if (!inputDocument) {
          break;
        }
        app.activeDocument = inputDocument;
        inputDocument.close(SaveOptions.DONOTSAVECHANGES);
        inputDocument = null;
        closeFailure = null;
        break;
      } catch (closeInputError) {
        closeFailure = closeInputError;
        $.sleep(100);
      }
    }
    app.activeDocument = doc;
    if (inputDocument) {
      throw new Error(
        'Failed to close input image after 3 attempts: ' + inputFile.fsName +
        (closeFailure ? ' (' + String(closeFailure) + ')' : '')
      );
    }
  }
}

function replaceArtworkInsideSmartObject(soDoc, replacement) {
  removeGeneratedArtwork(soDoc);
  var targetLayer = null;
  if (replacement.inner_layer_path) {
    targetLayer = findLayerByPath(soDoc, replacement.inner_layer_path);
  } else if (replacement.inner_layer_name) {
    targetLayer = findLayerByNameRecursive(soDoc, replacement.inner_layer_name);
  }
  var targetBounds = targetLayer ? getLayerBoundsPx(targetLayer) : getDocumentBoundsPx(soDoc);
  if (targetLayer) {
    targetLayer.visible = false;
  }
  var placedLayer = placeImage(replacement.input_image);
  placedLayer.name = GENERATED_ARTWORK_LAYER_NAME;
  fitLayerToBounds(placedLayer, targetBounds, replacement.inner_fit_mode || 'fill');
}

function replaceSmartObjectContents(doc, replacement, result, mode, replacementIndex) {
  var layer = findLayerByPath(doc, replacement.layer_path);
  if (!layer) {
    result.stages.push({ stage: 'find_layer', ok: false, layer: replacement.layer_path });
    throw new Error('Smart object layer not found: ' + replacement.layer_path);
  }

  doc.activeLayer = layer;
  var beforeBounds = getLayerBoundsArray(layer);
  var normalizedInput = normalizeInputForSmartObject(
    doc,
    layer,
    replacement,
    replacement.layer_path + ':' + replacementIndex
  );
  doc.activeLayer = layer;
  var desc = new ActionDescriptor();
  desc.putPath(charIDToTypeID('null'), normalizedInput.file);
  executeAction(stringIDToTypeID('placedLayerReplaceContents'), desc, DialogModes.NO);
  result.stages.push({
    stage: 'replace_so',
    ok: true,
    layer: replacement.layer_path,
    input: replacement.input_image,
    replace_mode: mode,
    fit_mode: normalizedInput.fit_mode,
    input_width: normalizedInput.source_width,
    input_height: normalizedInput.source_height,
    source_canvas_width: normalizedInput.canvas.width,
    source_canvas_height: normalizedInput.canvas.height,
    source_canvas_resolution: normalizedInput.canvas.resolution,
    before_bounds: beforeBounds,
    after_bounds: getLayerBoundsArray(layer)
  });
}

function editSmartObjectContents(doc, replacement, result, mode) {
  var layer = findLayerByPath(doc, replacement.layer_path);
  if (!layer) {
    result.stages.push({ stage: 'find_layer', ok: false, layer: replacement.layer_path });
    throw new Error('Smart object layer not found: ' + replacement.layer_path);
  }

  var openDocuments = snapshotOpenDocuments();
  doc.activeLayer = layer;
  var convertedLinkedSource = false;
  try {
    executeAction(stringIDToTypeID('placedLayerConvertToEmbedded'), undefined, DialogModes.NO);
    convertedLinkedSource = true;
  } catch (convertLinkedSourceError) {}
  layer = findLayerByPath(doc, replacement.layer_path);
  if (!layer) {
    throw new Error('Smart object layer disappeared after link isolation: ' + replacement.layer_path);
  }
  doc.activeLayer = layer;
  var desc = new ActionDescriptor();
  executeAction(stringIDToTypeID('placedLayerEditContents'), desc, DialogModes.NO);
  var soDoc = app.activeDocument;
  if (!soDoc || soDoc === doc) {
    throw new Error('Photoshop did not open smart object contents: ' + replacement.layer_path);
  }
  var openedByTask = !documentWasOpen(soDoc, openDocuments);
  if (!openedByTask) {
    app.activeDocument = doc;
    throw new Error(
      'Smart object source is already open in Photoshop. Close it before starting: ' +
      replacement.layer_path
    );
  }

  var smartObjectClosed = false;
  try {
    if (!documentIsInsidePhotoshopTemp(soDoc)) {
      throw new Error(
        'Smart object content is outside Photoshop temporary storage; refusing to modify the source file: ' +
        replacement.layer_path
      );
    }
    replaceArtworkInsideSmartObject(soDoc, replacement);
    saveSmartObjectDocument(soDoc);
    soDoc.close(SaveOptions.DONOTSAVECHANGES);
    smartObjectClosed = true;
    result.stages.push({
      stage: 'replace_so',
      ok: true,
      layer: replacement.layer_path,
      input: replacement.input_image,
      replace_mode: mode,
      converted_linked_source: convertedLinkedSource
    });
  } finally {
    if (openedByTask && !smartObjectClosed) {
      try {
        soDoc.close(SaveOptions.DONOTSAVECHANGES);
      } catch (closeSmartObjectError) {}
    }
    app.activeDocument = doc;
  }
}

function replaceSmartObject(doc, replacement, result, replacementIndex) {
  var mode = replacement.replace_mode || CONFIG.smart_object_replace_mode || 'replaceContents';
  if (mode === 'editSmartObject') {
    editSmartObjectContents(doc, replacement, result, mode);
    return;
  }
  replaceSmartObjectContents(doc, replacement, result, mode, replacementIndex);
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
    assertDocumentNotOpen(CONFIG.mockup_path, 'Template');
    mockup = app.open(new File(CONFIG.mockup_path));
    result.stages.push({ stage: 'open_mockup', ok: true, path: CONFIG.mockup_path });

    for (var i = 0; i < CONFIG.so_replacements.length; i++) {
      replaceSmartObject(mockup, CONFIG.so_replacements[i], result, i);
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
  const expectedOutputCount = input.native_slices?.length ?? 0
  for (const group of input.groups) {
    if (expectedOutputCount > 0 && group.output_paths.length !== expectedOutputCount) {
      throw new AppErrorClass(
        'INVALID_INPUT',
        'Photoshop 快速切片 JSX 的 output_paths 数量必须等于 native_slices 数量',
        false,
      )
    }
    if (expectedOutputCount > 0) {
      continue
    }
    validateJob({
      task_id: input.task_id,
      group_index: group.group_index,
      mockup_path: input.mockup_path,
      ...(group.smart_object_replace_mode
        ? { smart_object_replace_mode: group.smart_object_replace_mode }
        : {}),
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

  const useNativeSlices = (input.native_slices?.length ?? 0) > 0
  const exportFunction = useNativeSlices
    ? `function removeFolderTree(folder) {
  if (!folder.exists) {
    return;
  }
  var entries = folder.getFiles();
  for (var i = 0; i < entries.length; i++) {
    if (entries[i] instanceof Folder) {
      removeFolderTree(entries[i]);
    } else {
      entries[i].remove();
    }
  }
  folder.remove();
}

function collectExportedImages(folder, output) {
  var entries = folder.getFiles();
  for (var i = 0; i < entries.length; i++) {
    if (entries[i] instanceof Folder) {
      collectExportedImages(entries[i], output);
    } else if (/\\.(jpe?g|png)$/i.test(entries[i].name)) {
      output.push(entries[i]);
    }
  }
}

function normalizedExportKey(value) {
  return String(value).toLowerCase().replace(/\\.[^.]+$/, '').replace(/[\\s_.-]+/g, '');
}

function naturalExportKey(file) {
  return String(file.fsName).toLowerCase().replace(/\\d+/g, function(value) {
    return ('0000000000' + value).slice(-10);
  });
}

function binaryByte(data, offset) {
  return data.charCodeAt(offset) & 255;
}

function binaryUint16(data, offset) {
  return binaryByte(data, offset) * 256 + binaryByte(data, offset + 1);
}

function binaryUint32(data, offset) {
  return (
    ((binaryByte(data, offset) * 256 + binaryByte(data, offset + 1)) * 256 +
      binaryByte(data, offset + 2)) *
      256 +
    binaryByte(data, offset + 3)
  );
}

function isJpegStartOfFrame(marker) {
  return (
    marker === 0xC0 || marker === 0xC1 || marker === 0xC2 || marker === 0xC3 ||
    marker === 0xC5 || marker === 0xC6 || marker === 0xC7 || marker === 0xC9 ||
    marker === 0xCA || marker === 0xCB || marker === 0xCD || marker === 0xCE ||
    marker === 0xCF
  );
}

function readExportedImageSize(file) {
  var data = '';
  try {
    file.encoding = 'BINARY';
    if (!file.open('r')) {
      return null;
    }
    data = file.read(262144);
  } catch (readHeaderError) {
    return null;
  } finally {
    try { file.close(); } catch (closeHeaderError) {}
  }

  if (
    data.length >= 24 &&
    binaryByte(data, 0) === 0x89 && binaryByte(data, 1) === 0x50 &&
    binaryByte(data, 2) === 0x4E && binaryByte(data, 3) === 0x47
  ) {
    return { width: binaryUint32(data, 16), height: binaryUint32(data, 20) };
  }
  if (data.length < 10 || binaryByte(data, 0) !== 0xFF || binaryByte(data, 1) !== 0xD8) {
    return null;
  }

  var offset = 2;
  while (offset + 8 < data.length) {
    if (binaryByte(data, offset) !== 0xFF) {
      offset++;
      continue;
    }
    while (offset < data.length && binaryByte(data, offset) === 0xFF) {
      offset++;
    }
    if (offset >= data.length) {
      break;
    }
    var marker = binaryByte(data, offset++);
    if (marker === 0x00 || marker === 0xD8 || marker === 0xD9 || marker === 0x01 ||
        (marker >= 0xD0 && marker <= 0xD7)) {
      continue;
    }
    if (offset + 1 >= data.length || marker === 0xDA) {
      break;
    }
    var segmentLength = binaryUint16(data, offset);
    if (segmentLength < 2 || offset + segmentLength > data.length) {
      break;
    }
    if (isJpegStartOfFrame(marker) && segmentLength >= 7) {
      return {
        width: binaryUint16(data, offset + 5),
        height: binaryUint16(data, offset + 3)
      };
    }
    offset += segmentLength;
  }
  return null;
}

function sliceDimensionTolerance(expected) {
  return Math.max(4, Math.ceil(expected * 0.02));
}

function exportedSizeMatchesSlice(size, slice) {
  if (!size || !slice.bounds || slice.bounds.length !== 4) {
    return false;
  }
  var expectedWidth = slice.bounds[2] - slice.bounds[0];
  var expectedHeight = slice.bounds[3] - slice.bounds[1];
  return (
    Math.abs(size.width - expectedWidth) <= sliceDimensionTolerance(expectedWidth) &&
    Math.abs(size.height - expectedHeight) <= sliceDimensionTolerance(expectedHeight)
  );
}

function selectExpectedSliceExports(files, slices) {
  var remaining = [];
  for (var fileIndex = 0; fileIndex < files.length; fileIndex++) {
    remaining.push({ file: files[fileIndex], size: readExportedImageSize(files[fileIndex]) });
  }

  var selected = [];
  for (var sliceIndex = 0; sliceIndex < slices.length; sliceIndex++) {
    var matchIndex = -1;
    for (var candidateIndex = 0; candidateIndex < remaining.length; candidateIndex++) {
      if (exportedSizeMatchesSlice(remaining[candidateIndex].size, slices[sliceIndex])) {
        matchIndex = candidateIndex;
        break;
      }
    }
    if (matchIndex < 0) {
      return [];
    }
    selected.push(remaining[matchIndex].file);
    remaining.splice(matchIndex, 1);
  }

  for (var extraIndex = 0; extraIndex < remaining.length; extraIndex++) {
    if (!remaining[extraIndex].size) {
      return [];
    }
    for (var expectedIndex = 0; expectedIndex < slices.length; expectedIndex++) {
      if (exportedSizeMatchesSlice(remaining[extraIndex].size, slices[expectedIndex])) {
        return [];
      }
    }
  }
  return selected;
}

function orderExportedImages(files, slices) {
  var remaining = files.slice(0);
  var ordered = [];
  for (var i = 0; i < slices.length; i++) {
    var sliceKey = normalizedExportKey(slices[i].name);
    var matchIndex = -1;
    var matches = 0;
    for (var j = 0; j < remaining.length; j++) {
      var fileKey = normalizedExportKey(remaining[j].name);
      if (sliceKey && (fileKey === sliceKey || fileKey.slice(-sliceKey.length) === sliceKey)) {
        matchIndex = j;
        matches++;
      }
    }
    if (matches > 1) {
      throw new Error('Ambiguous native slice export name: ' + slices[i].name);
    }
    if (matches === 1) {
      ordered.push(remaining[matchIndex]);
      remaining.splice(matchIndex, 1);
    }
  }
  remaining.sort(function(left, right) {
    var leftKey = naturalExportKey(left);
    var rightKey = naturalExportKey(right);
    return leftKey < rightKey ? -1 : (leftKey > rightKey ? 1 : 0);
  });
  return ordered.concat(remaining);
}

function exportNativeSlicesByBounds(doc, group, groupResult) {
  for (var i = 0; i < CONFIG.native_slices.length; i++) {
    throwIfCancellationRequested();
    var bounds = CONFIG.native_slices[i].bounds;
    if (!bounds || bounds.length !== 4 || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) {
      throw new Error('Invalid native slice bounds: ' + CONFIG.native_slices[i].name);
    }
    var sliceDocument = doc.duplicate();
    try {
      sliceDocument.crop([bounds[0], bounds[1], bounds[2], bounds[3]]);
      saveAs(sliceDocument, group.output_paths[i], group.format, group.jpg_quality);
      groupResult.outputs.push(group.output_paths[i]);
      throwIfCancellationRequested();
    } finally {
      try {
        sliceDocument.close(SaveOptions.DONOTSAVECHANGES);
      } catch (closeSliceError) {}
      app.activeDocument = doc;
    }
  }
}

function exportNativeSlices(doc, group, groupResult) {
  var tempRoot = new File(RESULT_FILE_PATH).parent;
  var exportFolder = new Folder(tempRoot.fsName + '/native-slices-' + group.group_index);
  removeFolderTree(exportFolder);
  createFolder(exportFolder);
  var exportDescriptor = new ActionDescriptor();
  var saveForWebOptions = new ActionDescriptor();
  saveForWebOptions.putEnumerated(charIDToTypeID('Op  '), charIDToTypeID('SWOp'), charIDToTypeID('OpSa'));
  saveForWebOptions.putEnumerated(
    charIDToTypeID('Fmt '),
    charIDToTypeID('IRFm'),
    group.format === 'jpg' ? charIDToTypeID('JPEG') : charIDToTypeID('PN24')
  );
  saveForWebOptions.putBoolean(charIDToTypeID('Intr'), false);
  var webJpegQuality = Math.max(0, Math.min(100, Math.round((group.jpg_quality / 12) * 100)));
  saveForWebOptions.putInteger(charIDToTypeID('Qlty'), webJpegQuality);
  saveForWebOptions.putBoolean(charIDToTypeID('SHTM'), false);
  saveForWebOptions.putBoolean(charIDToTypeID('SImg'), true);
  saveForWebOptions.putBoolean(charIDToTypeID('SSSO'), false);
  saveForWebOptions.putList(charIDToTypeID('SSLt'), new ActionList());
  saveForWebOptions.putBoolean(charIDToTypeID('DIDr'), false);
  saveForWebOptions.putEnumerated(charIDToTypeID('SWsl'), charIDToTypeID('STsl'), charIDToTypeID('SLUs'));
  saveForWebOptions.putPath(charIDToTypeID('In  '), exportFolder);
  exportDescriptor.putObject(charIDToTypeID('Usng'), stringIDToTypeID('SaveForWeb'), saveForWebOptions);
  throwIfCancellationRequested();
  executeAction(charIDToTypeID('Expr'), exportDescriptor, DialogModes.NO);
  throwIfCancellationRequested();

  var exported = [];
  collectExportedImages(exportFolder, exported);
  exported = orderExportedImages(exported, CONFIG.native_slices);
  if (exported.length < CONFIG.native_slices.length) {
    appendLog({
      level: 'warn',
      stage: 'native_slice_export_fallback',
      message: 'PS 原生切片导出数量不足，已回退切片边界裁切（明显更慢）。请检查模板用户/图层切片是否完整、命名是否稳定',
      group: group.group_index,
      sku_folder: group.sku_folder,
      expected_outputs: CONFIG.native_slices.length,
      actual_outputs: exported.length
    });
    removeFolderTree(exportFolder);
    exportNativeSlicesByBounds(doc, group, groupResult);
    return;
  }
  if (exported.length > CONFIG.native_slices.length) {
    var expectedExports = selectExpectedSliceExports(exported, CONFIG.native_slices);
    if (expectedExports.length !== CONFIG.native_slices.length) {
      appendLog({
        level: 'warn',
        stage: 'native_slice_export_fallback',
        message: 'PS 原生切片导出含无法安全匹配的额外文件，已回退切片边界裁切（明显更慢）。请去掉自动切片碎片并稳定切片命名',
        group: group.group_index,
        sku_folder: group.sku_folder,
        expected_outputs: CONFIG.native_slices.length,
        actual_outputs: exported.length
      });
      removeFolderTree(exportFolder);
      exportNativeSlicesByBounds(doc, group, groupResult);
      return;
    }
    appendLog({
      level: 'warn',
      stage: 'native_slice_extra_ignored',
      message: '已忽略 PS 原生切片导出的额外碎片（仍走快速路径）。建议清理模板中的自动切片',
      group: group.group_index,
      sku_folder: group.sku_folder,
      expected_outputs: CONFIG.native_slices.length,
      actual_outputs: exported.length
    });
    exported = expectedExports;
  }
  for (var i = 0; i < exported.length; i++) {
    throwIfCancellationRequested();
    var outputPath = group.output_paths[i];
    ensureParentFolder(outputPath);
    var destination = new File(outputPath);
    if (destination.exists) {
      destination.remove();
    }
    if (!exported[i].copy(destination.fsName)) {
      throw new Error('Failed to move native slice output: ' + exported[i].fsName);
    }
    groupResult.outputs.push(outputPath);
    throwIfCancellationRequested();
  }
  removeFolderTree(exportFolder);
  appendLog({
    level: 'info',
    stage: 'native_slice_export',
    message: 'PS 原生切片导出完成',
    group: group.group_index,
    sku_folder: group.sku_folder,
    output_file: groupResult.outputs.join(',')
  });
}

function exportOutputs(doc, group, groupResult) {
  exportNativeSlices(doc, group, groupResult);
}`
    : `function exportOutputs(doc, group, groupResult) {
  appendLog({
    level: 'info',
    stage: 'export_start',
    message: '开始导出成品图',
    group: group.group_index,
    sku_folder: group.sku_folder
  });
  var startedAt = new Date().getTime();
  for (var i = 0; i < group.clip_areas.length; i++) {
    throwIfCancellationRequested();
    var area = group.clip_areas[i];
    var outputPath = group.output_paths[i];
    if (group.clip_areas.length === 1 && area.is_full) {
      saveAs(doc, outputPath, group.format, group.jpg_quality);
      groupResult.outputs.push(outputPath);
      throwIfCancellationRequested();
      continue;
    }

    var duplicate = doc.duplicate();
    try {
      duplicate.crop([area.x, area.y, area.x + area.w, area.y + area.h]);
      saveAs(duplicate, outputPath, group.format, group.jpg_quality);
      groupResult.outputs.push(outputPath);
      throwIfCancellationRequested();
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
}`
  const workingDocumentStart = useNativeSlices
    ? 'var workingDocument = baseDocument;'
    : 'var workingDocument = baseDocument.duplicate();'
  const purgeEveryGroups =
    typeof input.purge_every_groups === 'number' && Number.isFinite(input.purge_every_groups)
      ? Math.max(0, Math.floor(input.purge_every_groups))
      : PHOTOSHOP_BATCH_PURGE_EVERY_GROUPS
  const pristineHistoryState = useNativeSlices
    ? 'var pristineHistoryState = baseDocument.activeHistoryState;'
    : ''
  const restorePristineState = useNativeSlices
    ? `if (i > 0) {
        baseDocument.activeHistoryState = pristineHistoryState;
      }`
    : ''
  const workingDocumentClose = useNativeSlices
    ? ''
    : `try {
          workingDocument.close(SaveOptions.DONOTSAVECHANGES);
        } catch (closeWorkingError) {}`
  const maybePurgeAfterGroup = useNativeSlices
    ? `groupsSincePurge += 1;
        if (CONFIG.purge_every_groups > 0 && groupsSincePurge >= CONFIG.purge_every_groups) {
          try {
            baseDocument.activeHistoryState = pristineHistoryState;
            app.purge(PurgeTarget.HISTORYCACHES);
            pristineHistoryState = baseDocument.activeHistoryState;
            appendLog({
              level: 'info',
              stage: 'purge_histories',
              message: '已清理 Photoshop 历史缓存并重新建立模板快照',
              group: group.group_index,
              sku_folder: group.sku_folder,
              purge_every_groups: CONFIG.purge_every_groups,
              groups_since_purge: groupsSincePurge
            });
          } catch (purgeError) {
            appendLog({
              level: 'warn',
              stage: 'purge_histories',
              message: '清理 Photoshop 历史缓存失败，将继续套版',
              group: group.group_index,
              sku_folder: group.sku_folder,
              error: String(purgeError),
              purge_every_groups: CONFIG.purge_every_groups,
              groups_since_purge: groupsSincePurge
            });
          }
          groupsSincePurge = 0;
        }`
    : `groupsSincePurge += 1;
        if (CONFIG.purge_every_groups > 0 && groupsSincePurge >= CONFIG.purge_every_groups) {
          try {
            app.purge(PurgeTarget.HISTORYCACHES);
            appendLog({
              level: 'info',
              stage: 'purge_histories',
              message: '已清理 Photoshop 历史缓存',
              group: group.group_index,
              sku_folder: group.sku_folder,
              purge_every_groups: CONFIG.purge_every_groups,
              groups_since_purge: groupsSincePurge
            });
          } catch (purgeError) {
            appendLog({
              level: 'warn',
              stage: 'purge_histories',
              message: '清理 Photoshop 历史缓存失败，将继续套版',
              group: group.group_index,
              sku_folder: group.sku_folder,
              error: String(purgeError),
              purge_every_groups: CONFIG.purge_every_groups,
              groups_since_purge: groupsSincePurge
            });
          }
          groupsSincePurge = 0;
        }`

  return `var CONFIG = ${jsonString({
    task_id: input.task_id,
    mockup_path: input.mockup_path,
    template_name: input.template_name,
    smart_object_replace_mode: input.smart_object_replace_mode,
    native_slices: input.native_slices ?? [],
    purge_every_groups: purgeEveryGroups,
    groups: input.groups,
    result_file_path: input.result_file_path,
    log_file_path: input.log_file_path,
    cancel_file_path: input.cancel_file_path,
    cancellation_mode: input.cancellation_mode ?? 'immediate',
  })};
var RESULT_FILE_PATH = ${jsonString(input.result_file_path)};
var LOG_FILE_PATH = ${jsonString(input.log_file_path)};
var CANCEL_FILE_PATH = ${jsonString(input.cancel_file_path)};
var GENERATED_ARTWORK_LAYER_NAME = '__TENGYU_ARTWORK__';
var SMART_OBJECT_CANVAS_CACHE = {};
var NORMALIZED_INPUT_INDEX = 0;
var CANCELLATION_ERROR = '__TENGYU_CANCELLED__';

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

function normalizedFsPath(filePath) {
  return String(new File(filePath).fsName).toLowerCase();
}

function assertDocumentNotOpen(filePath, label) {
  var targetPath = normalizedFsPath(filePath);
  for (var i = 0; i < app.documents.length; i++) {
    try {
      if (normalizedFsPath(app.documents[i].fullName.fsName) === targetPath) {
        throw new Error(label + ' is already open in Photoshop. Close it before starting: ' + filePath);
      }
    } catch (documentPathError) {
      if (String(documentPathError).indexOf('is already open in Photoshop') >= 0) {
        throw documentPathError;
      }
    }
  }
}

function snapshotOpenDocuments() {
  var documents = [];
  for (var i = 0; i < app.documents.length; i++) {
    documents.push(app.documents[i]);
  }
  return documents;
}

function documentWasOpen(document, documents) {
  for (var i = 0; i < documents.length; i++) {
    if (documents[i] === document) {
      return true;
    }
  }
  return false;
}

function documentIsInsidePhotoshopTemp(document) {
  try {
    var documentPath = String(document.fullName.fsName).toLowerCase();
    var tempPath = String(Folder.temp.fsName).toLowerCase();
    return (
      documentPath === tempPath ||
      documentPath.indexOf(tempPath + '\\\\') === 0 ||
      documentPath.indexOf(tempPath + '/') === 0
    );
  } catch (documentPathError) {
    return false;
  }
}

function saveSmartObjectDocument(document) {
  var smartObjectFile = new File(document.fullName.fsName);
  var fileName = String(smartObjectFile.name).toLowerCase();
  var dotIndex = fileName.lastIndexOf('.');
  var extension = dotIndex >= 0 ? fileName.substring(dotIndex + 1) : '';
  var previousDialogs = app.displayDialogs;
  app.displayDialogs = DialogModes.NO;
  try {
    if (extension === 'png') {
      document.saveAs(smartObjectFile, new PNGSaveOptions(), false, Extension.LOWERCASE);
      return;
    }
    if (extension === 'jpg' || extension === 'jpeg') {
      var jpgOptions = new JPEGSaveOptions();
      jpgOptions.quality = 12;
      document.saveAs(smartObjectFile, jpgOptions, false, Extension.LOWERCASE);
      return;
    }
    if (extension === 'psd') {
      var psdOptions = new PhotoshopSaveOptions();
      psdOptions.layers = true;
      document.saveAs(smartObjectFile, psdOptions, false, Extension.LOWERCASE);
      return;
    }
    if (extension === 'psb') {
      var psbOptions = new LargeDocumentFormatSaveOptions();
      psbOptions.layers = true;
      document.saveAs(smartObjectFile, psbOptions, false, Extension.LOWERCASE);
      return;
    }
    if (extension === 'tif' || extension === 'tiff') {
      var tiffOptions = new TiffSaveOptions();
      tiffOptions.layers = true;
      document.saveAs(smartObjectFile, tiffOptions, false, Extension.LOWERCASE);
      return;
    }
    throw new Error('Unsupported smart object temporary format: ' + smartObjectFile.name);
  } finally {
    app.displayDialogs = previousDialogs;
  }
}

function positiveFiniteNumber(value, label) {
  var number = Number(value);
  if (!isFinite(number) || number <= 0) {
    throw new Error(label + ' must be a positive finite number');
  }
  return number;
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

function throwIfCancellationRequested() {
  if (CONFIG.cancellation_mode === 'immediate' && cancelRequested()) {
    throw new Error(CANCELLATION_ERROR);
  }
}

function isCancellationError(error) {
  return String(error).indexOf(CANCELLATION_ERROR) >= 0;
}

function removeOutputFiles(paths) {
  var failures = [];
  for (var i = 0; i < paths.length; i++) {
    var file = new File(paths[i]);
    var lastError = '';
    for (var attempt = 0; attempt < 3 && file.exists; attempt++) {
      try {
        if (!file.remove() && file.exists) {
          lastError = 'File.remove returned false';
        }
      } catch (removeOutputError) {
        lastError = String(removeOutputError);
      }
      if (file.exists && attempt < 2) {
        $.sleep(100);
      }
    }
    if (file.exists) {
      failures.push(paths[i] + (lastError ? ' (' + lastError + ')' : ''));
    }
  }
  return failures;
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

function findLayerByNameRecursive(container, layerName) {
  for (var i = 0; i < container.artLayers.length; i++) {
    if (container.artLayers[i].name === layerName) {
      return container.artLayers[i];
    }
  }
  for (var j = 0; j < container.layerSets.length; j++) {
    var layerSet = container.layerSets[j];
    if (layerSet.name === layerName) {
      return layerSet;
    }
    var nested = findLayerByNameRecursive(layerSet, layerName);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function removeGeneratedArtwork(container) {
  var removed = 0;
  for (var i = container.artLayers.length - 1; i >= 0; i--) {
    if (container.artLayers[i].name === GENERATED_ARTWORK_LAYER_NAME) {
      container.artLayers[i].remove();
      removed++;
    }
  }
  for (var j = container.layerSets.length - 1; j >= 0; j--) {
    removed += removeGeneratedArtwork(container.layerSets[j]);
  }
  return removed;
}

function getLayerBoundsPx(layer) {
  var bounds = layer.bounds;
  var left = Number(bounds[0].value);
  var top = Number(bounds[1].value);
  var right = Number(bounds[2].value);
  var bottom = Number(bounds[3].value);
  return {
    left: left,
    top: top,
    right: right,
    bottom: bottom,
    width: right - left,
    height: bottom - top
  };
}

function getDocumentBoundsPx(doc) {
  return {
    left: 0,
    top: 0,
    right: Number(doc.width.value),
    bottom: Number(doc.height.value),
    width: Number(doc.width.value),
    height: Number(doc.height.value)
  };
}

function placeImage(filePath) {
  var inputFile = new File(filePath);
  if (!inputFile.exists) {
    throw new Error('Smart object input image not found: ' + filePath);
  }
  var desc = new ActionDescriptor();
  desc.putPath(charIDToTypeID('null'), inputFile);
  executeAction(charIDToTypeID('Plc '), desc, DialogModes.NO);
  return app.activeDocument.activeLayer;
}

function fitLayerToBounds(layer, targetBounds, mode) {
  var layerBounds = getLayerBoundsPx(layer);
  if (layerBounds.width <= 0 || layerBounds.height <= 0) {
    throw new Error('Placed artwork has empty bounds');
  }
  if (targetBounds.width <= 0 || targetBounds.height <= 0) {
    throw new Error('Smart object target has empty bounds');
  }
  var scaleX = targetBounds.width / layerBounds.width;
  var scaleY = targetBounds.height / layerBounds.height;
  var scale = mode === 'fill' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  layer.resize(scale * 100, scale * 100, AnchorPosition.MIDDLECENTER);

  var resized = getLayerBoundsPx(layer);
  var layerCenterX = resized.left + resized.width / 2;
  var layerCenterY = resized.top + resized.height / 2;
  var targetCenterX = targetBounds.left + targetBounds.width / 2;
  var targetCenterY = targetBounds.top + targetBounds.height / 2;
  layer.translate(targetCenterX - layerCenterX, targetCenterY - layerCenterY);
}

function getLayerBoundsArray(layer) {
  var bounds = getLayerBoundsPx(layer);
  return [bounds.left, bounds.top, bounds.right, bounds.bottom];
}

function readSmartObjectCanvas(doc, layer, cacheKey) {
  if (SMART_OBJECT_CANVAS_CACHE[cacheKey]) {
    return SMART_OBJECT_CANVAS_CACHE[cacheKey];
  }
  var openDocuments = snapshotOpenDocuments();
  doc.activeLayer = layer;
  executeAction(stringIDToTypeID('placedLayerEditContents'), new ActionDescriptor(), DialogModes.NO);
  var soDoc = app.activeDocument;
  if (!soDoc || soDoc === doc) {
    throw new Error('Photoshop did not open smart object contents: ' + cacheKey);
  }
  var canvas = null;
  try {
    canvas = {
      width: Math.round(positiveFiniteNumber(soDoc.width.value, 'Smart object width')),
      height: Math.round(positiveFiniteNumber(soDoc.height.value, 'Smart object height')),
      resolution: positiveFiniteNumber(soDoc.resolution, 'Smart object resolution')
    };
  } finally {
    if (!documentWasOpen(soDoc, openDocuments)) {
      try {
        soDoc.close(SaveOptions.DONOTSAVECHANGES);
      } catch (closeSmartObjectError) {}
    }
    app.activeDocument = doc;
  }
  SMART_OBJECT_CANVAS_CACHE[cacheKey] = canvas;
  return canvas;
}

function normalizeInputForSmartObject(doc, layer, replacement, cacheKey) {
  var canvas = readSmartObjectCanvas(doc, layer, cacheKey);
  var inputFile = new File(replacement.input_image);
  if (!inputFile.exists) {
    throw new Error('Smart object input image not found: ' + replacement.input_image);
  }
  assertDocumentNotOpen(inputFile.fsName, 'Input image');
  var inputDocument = null;
  try {
    inputDocument = app.open(inputFile);
    var sourceWidth = positiveFiniteNumber(inputDocument.width.value, 'Input image width');
    var sourceHeight = positiveFiniteNumber(inputDocument.height.value, 'Input image height');
    var scaleX = canvas.width / sourceWidth;
    var scaleY = canvas.height / sourceHeight;
    var fitMode = replacement.inner_fit_mode || 'fill';
    var scale = fitMode === 'fill' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
    var scaledWidth = Math.max(1, Math.round(sourceWidth * scale));
    var scaledHeight = Math.max(1, Math.round(sourceHeight * scale));
    inputDocument.resizeImage(
      UnitValue(scaledWidth, 'px'),
      UnitValue(scaledHeight, 'px'),
      canvas.resolution,
      ResampleMethod.BICUBIC
    );
    try {
      inputDocument.backgroundLayer.isBackgroundLayer = false;
    } catch (noBackgroundLayerError) {}
    inputDocument.resizeCanvas(
      UnitValue(canvas.width, 'px'),
      UnitValue(canvas.height, 'px'),
      AnchorPosition.MIDDLECENTER
    );

    var normalizedFolder = new Folder(new File(RESULT_FILE_PATH).parent.fsName + '/normalized-inputs');
    createFolder(normalizedFolder);
    var normalizedFile = new File(
      normalizedFolder.fsName + '/input-' + (++NORMALIZED_INPUT_INDEX) + '.psd'
    );
    if (normalizedFile.exists) {
      normalizedFile.remove();
    }
    var saveOptions = new PhotoshopSaveOptions();
    saveOptions.layers = true;
    inputDocument.saveAs(normalizedFile, saveOptions, true, Extension.LOWERCASE);
    return {
      file: normalizedFile,
      canvas: canvas,
      source_width: sourceWidth,
      source_height: sourceHeight,
      fit_mode: fitMode
    };
  } finally {
    var closeFailure = null;
    for (var closeAttempt = 0; closeAttempt < 3; closeAttempt++) {
      try {
        if (!inputDocument) {
          break;
        }
        app.activeDocument = inputDocument;
        inputDocument.close(SaveOptions.DONOTSAVECHANGES);
        inputDocument = null;
        closeFailure = null;
        break;
      } catch (closeInputError) {
        closeFailure = closeInputError;
        $.sleep(100);
      }
    }
    app.activeDocument = doc;
    if (inputDocument) {
      throw new Error(
        'Failed to close input image after 3 attempts: ' + inputFile.fsName +
        (closeFailure ? ' (' + String(closeFailure) + ')' : '')
      );
    }
  }
}

function replaceArtworkInsideSmartObject(soDoc, group, replacement) {
  removeGeneratedArtwork(soDoc);
  var targetLayer = null;
  if (replacement.inner_layer_path) {
    targetLayer = findLayerByPath(soDoc, replacement.inner_layer_path);
  } else if (replacement.inner_layer_name) {
    targetLayer = findLayerByNameRecursive(soDoc, replacement.inner_layer_name);
  }
  var targetBounds = targetLayer ? getLayerBoundsPx(targetLayer) : getDocumentBoundsPx(soDoc);
  if (targetLayer) {
    targetLayer.visible = false;
  }
  var placedLayer = placeImage(replacement.input_image);
  placedLayer.name = GENERATED_ARTWORK_LAYER_NAME;
  var fitMode = replacement.inner_fit_mode || 'fill';
  fitLayerToBounds(placedLayer, targetBounds, fitMode);
  appendLog({
    level: 'info',
    stage: 'so_inner_place',
    message: '智能对象内部置入印花',
    group: group.group_index,
    sku_folder: group.sku_folder,
    smart_object: replacement.layer_path,
    input: replacement.input_image,
    inner_layer_path: replacement.inner_layer_path || '',
    inner_layer_name: replacement.inner_layer_name || '',
    fit_mode: fitMode,
    replace_mode: 'editSmartObject'
  });
}

function replaceSmartObjectContents(doc, group, replacement, mode, replacementIndex) {
  var layer = findLayerByPath(doc, replacement.layer_path);
  if (!layer) {
    throw new Error('Smart object layer not found: ' + replacement.layer_path);
  }

  doc.activeLayer = layer;
  var startedAt = new Date().getTime();
  var beforeBounds = getLayerBoundsArray(layer);
  var normalizedInput = normalizeInputForSmartObject(
    doc,
    layer,
    replacement,
    replacement.layer_path + ':' + replacementIndex
  );
  doc.activeLayer = layer;
  var desc = new ActionDescriptor();
  desc.putPath(charIDToTypeID('null'), normalizedInput.file);
  executeAction(stringIDToTypeID('placedLayerReplaceContents'), desc, DialogModes.NO);
  appendLog({
    level: 'info',
    stage: 'so_replace',
    message: '替换智能对象',
    group: group.group_index,
    sku_folder: group.sku_folder,
    smart_object: replacement.layer_path,
    input: replacement.input_image,
    replace_mode: mode,
    fit_mode: normalizedInput.fit_mode,
    input_width: normalizedInput.source_width,
    input_height: normalizedInput.source_height,
    source_canvas_width: normalizedInput.canvas.width,
    source_canvas_height: normalizedInput.canvas.height,
    source_canvas_resolution: normalizedInput.canvas.resolution,
    before_bounds: beforeBounds,
    after_bounds: getLayerBoundsArray(layer),
    duration_ms: new Date().getTime() - startedAt
  });
}

function editSmartObjectContents(doc, group, replacement) {
  var layer = findLayerByPath(doc, replacement.layer_path);
  if (!layer) {
    throw new Error('Smart object layer not found: ' + replacement.layer_path);
  }

  var openDocuments = snapshotOpenDocuments();
  doc.activeLayer = layer;
  var convertedLinkedSource = false;
  try {
    executeAction(stringIDToTypeID('placedLayerConvertToEmbedded'), undefined, DialogModes.NO);
    convertedLinkedSource = true;
  } catch (convertLinkedSourceError) {}
  layer = findLayerByPath(doc, replacement.layer_path);
  if (!layer) {
    throw new Error('Smart object layer disappeared after link isolation: ' + replacement.layer_path);
  }
  doc.activeLayer = layer;
  appendLog({
    level: 'info',
    stage: 'so_edit_open',
    message: '打开智能对象内容',
    group: group.group_index,
    sku_folder: group.sku_folder,
    smart_object: replacement.layer_path,
    input: replacement.input_image,
    replace_mode: 'editSmartObject'
  });
  var desc = new ActionDescriptor();
  executeAction(stringIDToTypeID('placedLayerEditContents'), desc, DialogModes.NO);
  var soDoc = app.activeDocument;
  if (!soDoc || soDoc === doc) {
    throw new Error('Photoshop did not open smart object contents: ' + replacement.layer_path);
  }
  var openedByTask = !documentWasOpen(soDoc, openDocuments);
  if (!openedByTask) {
    app.activeDocument = doc;
    throw new Error(
      'Smart object source is already open in Photoshop. Close it before starting: ' +
      replacement.layer_path
    );
  }

  var smartObjectClosed = false;
  try {
    if (!documentIsInsidePhotoshopTemp(soDoc)) {
      throw new Error(
        'Smart object content is outside Photoshop temporary storage; refusing to modify the source file: ' +
        replacement.layer_path
      );
    }
    replaceArtworkInsideSmartObject(soDoc, group, replacement);
    saveSmartObjectDocument(soDoc);
    soDoc.close(SaveOptions.DONOTSAVECHANGES);
    smartObjectClosed = true;
    appendLog({
      level: 'info',
      stage: 'so_edit_save',
      message: '保存智能对象内容',
      group: group.group_index,
      sku_folder: group.sku_folder,
      smart_object: replacement.layer_path,
      replace_mode: 'editSmartObject',
      converted_linked_source: convertedLinkedSource
    });
  } finally {
    if (openedByTask && !smartObjectClosed) {
      try {
        soDoc.close(SaveOptions.DONOTSAVECHANGES);
      } catch (closeSmartObjectError) {}
    }
    app.activeDocument = doc;
  }
}

function replaceSmartObject(doc, group, replacement, replacementIndex) {
  var mode = replacement.replace_mode || group.smart_object_replace_mode || CONFIG.smart_object_replace_mode || 'replaceContents';
  appendLog({
    level: 'debug',
    stage: 'so_find',
    message: '定位智能对象',
    group: group.group_index,
    sku_folder: group.sku_folder,
    smart_object: replacement.layer_path,
    input: replacement.input_image,
    replace_mode: mode
  });
  if (mode === 'editSmartObject') {
    editSmartObjectContents(doc, group, replacement);
    return;
  }
  replaceSmartObjectContents(doc, group, replacement, mode, replacementIndex);
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

${exportFunction}

function runBatch() {
  var previousRulerUnits = app.preferences.rulerUnits;
  var baseDocument = null;
  var result = { ok: false, cancelled: false, groups: [], outputs: [] };
  var failed = false;
  var batchStartedAt = new Date().getTime();
  var groupsSincePurge = 0;

  try {
    app.preferences.rulerUnits = Units.PIXELS;
    appendLog({ level: 'info', stage: 'task_start', message: '开始模板批处理' });
    appendLog({ level: 'info', stage: 'template_start', message: '开始处理模板' });
    appendLog({ level: 'info', stage: 'template_open', message: '打开模板' });
    assertDocumentNotOpen(CONFIG.mockup_path, 'Template');
    baseDocument = app.open(new File(CONFIG.mockup_path));
    ${pristineHistoryState}

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

      ${restorePristineState}
      ${workingDocumentStart}
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
          throwIfCancellationRequested();
          replaceSmartObject(
            workingDocument,
            group,
            group.so_replacements[replacementIndex],
            replacementIndex
          );
          throwIfCancellationRequested();
        }
        throwIfCancellationRequested();
        exportOutputs(workingDocument, group, groupResult);
        throwIfCancellationRequested();
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
        ${maybePurgeAfterGroup}
      } catch (groupError) {
        if (isCancellationError(groupError)) {
          result.cancelled = true;
          var cleanupFailures = removeOutputFiles(groupResult.outputs);
          groupResult.outputs = [];
          if (cleanupFailures.length > 0) {
            result.cancelled = false;
            throw new Error('Failed to remove partial outputs after cancellation: ' + cleanupFailures.join(', '));
          }
          appendLog({
            level: 'warn',
            stage: 'cancelled',
            message: '用户取消，停止当前分组和后续分组',
            group: group.group_index,
            sku_folder: group.sku_folder,
            duration_ms: new Date().getTime() - groupStartedAt
          });
          break;
        }
        failed = true;
        groupResult.error = String(groupError);
        var failureCleanup = removeOutputFiles(groupResult.outputs);
        groupResult.outputs = [];
        if (failureCleanup.length > 0) {
          groupResult.error +=
            ' | Failed to remove partial outputs: ' + failureCleanup.join(', ');
        }
        appendLog({
          level: 'error',
          stage: 'group_complete',
          message: '套版组失败',
          group: group.group_index,
          sku_folder: group.sku_folder,
          error: groupResult.error,
          duration_ms: new Date().getTime() - groupStartedAt
        });
      } finally {
        ${workingDocumentClose}
      }
      result.groups.push(groupResult);
    }

    result.ok = !result.cancelled;
    if (result.cancelled) {
      appendLog({
        level: 'warn',
        stage: 'task_complete',
        message: '套版任务已取消',
        duration_ms: new Date().getTime() - batchStartedAt
      });
    } else if (failed) {
      appendLog({
        level: 'warn',
        stage: 'task_complete',
        message: '套版任务完成，部分分组失败',
        duration_ms: new Date().getTime() - batchStartedAt
      });
    } else {
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
  const resultFilePath =
    input.result_file_path ?? join(taskDir, `template-${input.template_name}-result.json`)
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
