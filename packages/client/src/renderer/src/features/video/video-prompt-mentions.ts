export type VideoPromptImage = {
  path: string
  name: string
}

export type VideoPromptReferenceOption = {
  index: number
  token: string
  name: string
  path: string
}

export type VideoPromptMention = {
  start: number
  end: number
  query: string
}

export function buildVideoReferenceToken(index: number) {
  return `[Image ${index}]`
}

export function findVideoPromptMention(value: string, caret: number): VideoPromptMention | null {
  const safeCaret = clamp(caret, 0, value.length)
  const beforeCaret = value.slice(0, safeCaret)
  const atIndex = beforeCaret.lastIndexOf('@')
  if (atIndex < 0) {
    return null
  }
  const query = beforeCaret.slice(atIndex + 1)
  if (/\s/.test(query)) {
    return null
  }
  return { start: atIndex, end: safeCaret, query }
}

export function filterVideoPromptReferenceOptions(
  images: VideoPromptImage[],
  query: string,
): VideoPromptReferenceOption[] {
  const normalizedQuery = normalizeSearchText(query)
  return images
    .map((image, index) => ({
      index: index + 1,
      token: buildVideoReferenceToken(index + 1),
      name: image.name,
      path: image.path,
    }))
    .filter((option) => {
      if (!normalizedQuery) {
        return true
      }
      return (
        normalizeSearchText(option.name).includes(normalizedQuery) ||
        normalizeSearchText(option.token).includes(normalizedQuery) ||
        String(option.index).includes(normalizedQuery)
      )
    })
}

export function replaceVideoPromptRange(
  value: string,
  rangeStart: number,
  rangeEnd: number,
  nextText: string,
) {
  const start = clamp(Math.min(rangeStart, rangeEnd), 0, value.length)
  const end = clamp(Math.max(rangeStart, rangeEnd), 0, value.length)
  const nextValue = `${value.slice(0, start)}${nextText}${value.slice(end)}`
  return {
    value: nextValue,
    caret: start + nextText.length,
  }
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase()
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
