import { describe, expect, it } from 'vitest'
import type { DetectionImageResult } from '../../../main/lib/detection-service'
import { detectionPreviewResults } from './detection-preview'

describe('detection preview results', () => {
  it('orders successful results by risk group and excludes failed results', () => {
    const results: DetectionImageResult[] = [
      result('review', '疑似图', 'skipped'),
      {
        imagePath: '/tmp/failed.png',
        thumbnailUrl: '',
        status: 'failed',
        errorCode: 'llm_failed',
        error: '调用失败',
      },
      result('pass', '无风险图', 'success'),
      result('block', '高风险图', 'success'),
    ]

    expect(detectionPreviewResults(results).map((item) => item.riskLevel)).toEqual([
      'pass',
      'review',
      'block',
    ])
  })
})

function result(
  riskLevel: 'pass' | 'review' | 'block',
  reason: string,
  status: 'success' | 'skipped',
): DetectionImageResult {
  const base = {
    artifactId: `artifact-${riskLevel}`,
    imagePath: `/tmp/${riskLevel}.png`,
    outputPath: `/tmp/out/${riskLevel}.png`,
    printId: `print-${riskLevel}`,
    reason,
    riskLevel,
    riskScore: riskLevel === 'pass' ? 0 : riskLevel === 'review' ? 50 : 90,
    thumbnailUrl: '',
  }

  if (status === 'success') {
    return {
      ...base,
      cached: false,
      status,
    }
  }

  return {
    ...base,
    cached: true,
    status,
  }
}
