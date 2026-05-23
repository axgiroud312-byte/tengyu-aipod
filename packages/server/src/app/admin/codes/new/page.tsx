import { redirect } from 'next/navigation'

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function AdminCodesNewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedSearchParams = await searchParams
  const query = new URLSearchParams()
  for (const key of ['name', 'phone', 'email', 'wechat', 'notes']) {
    const value = firstValue(resolvedSearchParams[key])
    if (value?.trim()) {
      query.set(key, value.trim())
    }
  }

  redirect(query.toString() ? `/admin/codes?${query.toString()}` : '/admin/codes')
}
