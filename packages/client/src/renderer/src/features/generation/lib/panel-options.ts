export type Txt2imgMode = 'ai' | 'manual'
export type Img2imgMode = 'layout' | 'style' | 'layout-style' | 'manual'
export type ComfyuiImg2imgPromptMode = 'ai' | 'workflow' | 'manual'
export type MattingMode = 'comfyui' | 'mixed'
export type Txt2imgGenerationPath = 'grsai' | 'comfyui'
export type ReferenceImageDraft = {
  id: string
  name: string
  dataUrl: string
  base64: string
  mime_type: string
}

export const img2imgModes: Array<{ key: Img2imgMode; label: string; instruction: string }> = [
  {
    key: 'layout',
    label: '参考构图',
    instruction:
      'Use only the layout structure from the reference image. Do not copy subject matter.',
  },
  {
    key: 'style',
    label: '参考风格',
    instruction: 'Use only the art style from the reference image. Create new content.',
  },
  {
    key: 'layout-style',
    label: '构图+风格',
    instruction:
      'Use both layout and art style from the reference image while creating a new motif.',
  },
  {
    key: 'manual',
    label: '自己写',
    instruction: '',
  },
]
