import { listComfyuiWorkflowVersions } from '@/lib/comfyui-workflows'
import { NextResponse } from 'next/server'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await listComfyuiWorkflowVersions(id)

  return NextResponse.json({ ok: true, data: { items: data } })
}
