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
  jsx_path?: string
  result_file_path?: string
}

export interface PhotoshopPrintAsset {
  id: string
  file_path: string
}

export interface PhotoshopTaskGroup {
  group_index: number
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

export interface PhotoshopBatchResult {
  ok: boolean
  task_id: string
  templates_total: number
  groups_total: number
  groups_completed: number
  outputs: string[]
  templates: PhotoshopBatchTemplateResult[]
}
