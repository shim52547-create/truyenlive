import { NextResponse } from 'next/server'
import { clearAll, sizeInfo } from '@/lib/cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await sizeInfo())
}

export async function DELETE() {
  const removed = await clearAll()
  return NextResponse.json({ ok: true, removed })
}
