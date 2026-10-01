import { NextRequest, NextResponse } from 'next/server'
import { fetchGoogleTTSChunk } from '@/lib/tts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/tts?text=<<=190 chars>&slow=0|1 → single Google vi-VN MP3 chunk. */
export async function GET(req: NextRequest) {
  const text = (req.nextUrl.searchParams.get('text') ?? '').slice(0, 190)
  const slow = req.nextUrl.searchParams.get('slow') === '1'
  if (!text.trim()) {
    return NextResponse.json({ error: 'Thiếu tham số text' }, { status: 400 })
  }
  try {
    const buf = await fetchGoogleTTSChunk(text, slow)
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(buf.length),
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'lỗi không xác định'
    return NextResponse.json({ error: `Lỗi tạo giọng đọc: ${msg}` }, { status: 502 })
  }
}
