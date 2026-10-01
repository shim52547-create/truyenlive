import { NextRequest, NextResponse } from 'next/server'
import { getStoryInfo, normalizeStoryUrl } from '@/lib/scraper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url') ?? ''
  const normalized = normalizeStoryUrl(raw)
  if (!normalized) {
    return NextResponse.json(
      {
        error:
          'Link không hợp lệ. Hãy nhập link truyện trên truyenfull.live, ví dụ: https://truyenfull.live/dan-dao-tong-su-chi-thi-tieu-ha-me/',
      },
      { status: 400 }
    )
  }
  try {
    const data = await getStoryInfo(normalized)
    return NextResponse.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'lỗi không xác định'
    return NextResponse.json({ error: `Không tải được truyện: ${msg}` }, { status: 502 })
  }
}
