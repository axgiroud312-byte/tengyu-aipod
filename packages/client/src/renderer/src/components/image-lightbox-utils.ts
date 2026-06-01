export function nextImageIndex(currentIndex: number, imageCount: number, delta: number) {
  if (imageCount <= 0) {
    return null
  }

  return (currentIndex + delta + imageCount) % imageCount
}
