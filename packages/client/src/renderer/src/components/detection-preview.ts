import type { RiskLevel } from '@tengyu-aipod/shared'
import type { DetectionImageResult } from '../../../main/lib/detection-service'

export type DetectionPreviewResult = Extract<
  DetectionImageResult,
  { status: 'success' | 'skipped' }
>

const DETECTION_PREVIEW_RISK_ORDER: RiskLevel[] = ['pass', 'review', 'block']

export function isDetectionPreviewResult(
  result: DetectionImageResult,
): result is DetectionPreviewResult {
  return result.status !== 'failed'
}

export function detectionPreviewResults(results: DetectionImageResult[]): DetectionPreviewResult[] {
  return DETECTION_PREVIEW_RISK_ORDER.flatMap((level) =>
    results.filter(
      (result): result is DetectionPreviewResult =>
        isDetectionPreviewResult(result) && result.riskLevel === level,
    ),
  )
}
