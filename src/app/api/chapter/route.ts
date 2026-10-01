import { NextRequest, NextResponse } from 'next/server'
import { getChapterContent, filterAds } from '@/lib/scraper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/chapter?url=<chapter url>&skipAds=1 — cleaned chapter text. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url') ?? ''
  const skipAds = req.nextUrl.searchParams.get('skipAds') === '1'
  if (!/^https:\/\/truyenfull\.(live|vn|com)\//i.test(url)) {
    return NextResponse.json({ error: 'URL chương không hợp lệ' }, { status: 400 })
  }
  try {
    const data = await getChapterContent(url)
    return NextResponse.json({ ...data, paragraphs: filterAds(data.paragraphs, skipAds) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'lỗi không xác định'
    return NextResponse.json({ error: `Không tải được nội dung chương: ${msg}` }, { status: 502 })
  }
}
