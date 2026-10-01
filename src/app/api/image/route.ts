import { NextRequest, NextResponse } from 'next/server'
import { md5, getBin, setBin } from '@/lib/cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED = [
  'lh3.googleusercontent.com',
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
  'lh6.googleusercontent.com',
  'static.8cache.com',
  'static.truyenfull.live',
  'truyenfull.live',
  'www.truyenfull.live',
  '8cache.com',
  'img.8cache.com',
]

/** GET /api/image?url=... — image proxy with disk cache (avoids hotlink blocks). */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url') ?? ''
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return NextResponse.json({ error: 'bad url' }, { status: 400 })
  }
  if (!ALLOWED.includes(host) && !host.endsWith('.8cache.com') && !host.endsWith('googleusercontent.com')) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 403 })
  }

  const key = md5(url)
  const cached = await getBin('img', key)
  if (cached) {
    return new NextResponse(new Uint8Array(cached), {
      headers: { 'Content-Type': guessType(cached), 'Cache-Control': 'public, max-age=604800' },
    })
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0',
        Referer: 'https://truyenfull.live/',
      },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ab = await res.arrayBuffer()
    const buf = Buffer.from(ab)
    if (buf.length > 100) await setBin('img', key, buf)
    return new NextResponse(new Uint8Array(buf), {
      headers: { 'Content-Type': res.headers.get('content-type') ?? guessType(buf), 'Cache-Control': 'public, max-age=604800' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

function guessType(buf: Buffer): string {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf.length > 6 && buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif'
  if (buf.length > 12 && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp'
  return 'image/jpeg'
}
