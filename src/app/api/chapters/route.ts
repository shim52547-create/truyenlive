import { NextRequest, NextResponse } from 'next/server'
import { getChapterListPage, normalizeStoryUrl } from '@/lib/scraper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** GET /api/chapters?url=<story url>&from=<page 1-index>&to=<page> — fetch a batch of chapter-list pages. */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url') ?? ''
  const canonical = normalizeStoryUrl(raw)
  if (!canonical) return NextResponse.json({ error: 'URL truyện không hợp lệ' }, { status: 400 })

  const from = Math.max(1, parseInt(req.nextUrl.searchParams.get('from') ?? '1', 10) || 1)
  const to = Math.min(from + 7, parseInt(req.nextUrl.searchParams.get('to') ?? String(from), 10) || from)

  try {
    const pages = await Promise.all(
      Array.from({ length: to - from + 1 }, (_, i) => getChapterListPage(canonical, from + i))
    )
    // pages arrive in request order, so concatenating preserves chapter order
    const chapters = pages.flat()
    return NextResponse.json({ from, to, chapters, nextFrom: to + 1 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'lỗi không xác định'
    return NextResponse.json({ error: `Không tải được danh sách chương: ${msg}` }, { status: 502 })
  }
}
