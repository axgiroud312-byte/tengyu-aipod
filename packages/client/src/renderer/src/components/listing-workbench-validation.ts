export function listingStartValidationIssues(input: {
  batchDir: string
  draftTemplateId: string
  itemCount: number
  selectedProfileCount: number
  targetShopName: string
}) {
  const issues: string[] = []
  if (!input.batchDir.trim()) {
    issues.push('请选择素材目录')
  }
  if (!input.draftTemplateId.trim()) {
    issues.push('请填写草稿模板编号输入框')
  }
  if (input.selectedProfileCount === 0) {
    issues.push('请选择比特浏览器档案')
  }
  if (input.itemCount === 0) {
    issues.push('请先扫描素材目录')
  }
  if (!input.targetShopName.trim()) {
    issues.push('请填写目标店铺名称')
  }
  return issues
}
