export interface PhotoshopStatus {
  installed: boolean
  running: boolean
  com_connected: boolean
  version: string | null
  last_check_at: number
  error_code?: 'PS_NOT_INSTALLED' | 'PS_NOT_RUNNING' | 'PS_COM_FAILED'
  error_message?: string
}

export type SmartObjectMode = 'single' | 'shared' | 'independent' | 'none'
export type PhotoshopClipMode = 'none' | 'auto' | 'guides'
export type PhotoshopOutputLayout = 'template_first' | 'sku_first' | 'sku_flat'

export type PsdBounds = [number, number, number, number]

export interface PsdDocumentSize {
  w: number
  h: number
}

export interface PsdSmartObject {
  name: string
  path: string
  sort_order: number
  is_top_level: boolean
  bounds: PsdBounds
  shared_indicator: string
}

export interface PsdGuides {
  horizontal: number[]
  vertical: number[]
}

export interface PsdClipArea {
  x: number
  y: number
  w: number
  h: number
  is_full?: boolean
}

export interface PsdLayerInfo {
  name: string
  path: string
  typename: string
  is_group: boolean
  is_smart_object: boolean
  is_text: boolean
  bounds?: PsdBounds
}

export interface PsdTextLayer {
  name: string
  path: string
  text: string
  bounds?: PsdBounds
}

export interface PsdTemplate {
  id: string
  file_path: string
  file_hash: string
  doc_size: PsdDocumentSize
  smart_objects: PsdSmartObject[]
  guides: PsdGuides
  clip_areas: PsdClipArea[]
  mode: SmartObjectMode
  representative_so_count: number
  scanned_at: number
  layers: PsdLayerInfo[]
  text_layers: PsdTextLayer[]
}

export interface PhotoshopScanTemplateRequest {
  psd_path: string
}

export type PhotoshopExportFormat = 'jpg' | 'png'

export interface PhotoshopSoReplacement {
  layer_path: string
  input_image: string
}

export interface PhotoshopJob {
  task_id: string
  group_index: number
  mockup_path: string
  so_replacements: PhotoshopSoReplacement[]
  clip_mode?: PhotoshopClipMode
  clip_areas: PsdClipArea[]
  output_paths: string[]
  format: PhotoshopExportFormat
  jpg_quality: number
  result_file_path: string
}

export interface PhotoshopJsxJobFile {
  jsx_path: string
  result_file_path: string
  content: string
}

export interface PhotoshopJobResult {
  ok: boolean
  outputs: string[]
  attempts: number
  skipped?: boolean
  jsx_path?: string
  result_file_path?: string
}

export type PhotoshopProgressStage =
  | 'task_start'
  | 'template_start'
  | 'template_open'
  | 'group_start'
  | 'jsx_generate'
  | 'jsx_exec'
  | 'so_find'
  | 'so_replace'
  | 'export_start'
  | 'export_complete'
  | 'output_verify'
  | 'group_complete'
  | 'task_complete'
  | 'cancelled'

export interface PhotoshopProgressInfo {
  task_id: string
  total_groups: number
  completed: number
  failed: number
  skipped: number
  current_group: number | null
  current_stage: PhotoshopProgressStage
  verified_outputs: number
  template_index?: number
  template_total?: number
  template_name?: string
  group_index?: number
  group_total?: number
  groups_completed?: number
}

export interface PhotoshopProgressLogEntry {
  ts: number
  level: 'debug' | 'info' | 'warn' | 'error'
  stage: PhotoshopProgressStage
  message?: string
  task_id?: string
  template_name?: string
  group?: number
  sku_folder?: string
  smart_object?: string
  input?: string
  attempt?: number
  output_file?: string
  error?: string
  duration_ms?: number
}

export interface PhotoshopPrintAsset {
  id: string
  file_path: string
}

export interface PhotoshopTaskGroup {
  group_index: number
  sku_folder: string
  template_name: string
  print_assets: PhotoshopPrintAsset[]
  job: PhotoshopJob
}

export interface PhotoshopBatchTemplateResult {
  template_id: string
  template_name: string
  groups_total: number
  groups_completed: number
  outputs: string[]
}

export interface PhotoshopBatchOutputGroup {
  template_id: string
  template_name: string
  group_index: number
  sku_folder: string
  print_ids: string[]
  outputs: string[]
}

export interface PhotoshopBatchResult {
  ok: boolean
  task_id: string
  output_layout: PhotoshopOutputLayout
  cancelled?: boolean
  log_path?: string
  templates_total: number
  groups_total: number
  groups_completed: number
  outputs: string[]
  templates: PhotoshopBatchTemplateResult[]
  result_groups: PhotoshopBatchOutputGroup[]
}
