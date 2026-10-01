import { md5, getBin, setBin } from '@/lib/cache'

/**
 * Google Translate TTS proxy (voice = Google's vi-VN voice, free tw-ob endpoint).
 * - One request handles a single chunk of <= 190 chars.
 * - Results cached on disk keyed by voice+text.
 * - Global throttle so many concurrent client requests do not hammer upstream.
 * - Retries with host rotation.
 */

const HOSTS = ['https://translate.google.com', 'translate.google.com.vn'].map((h, i) =>
  i === 0 ? h : `https://${h}`
)

const MIN_GAP_MS = 140
let chain: Promise<void> = Promise.resolve()
let lastCall = 0

function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCall))
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastCall = Date.now()
  })
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run.then(fn)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function fetchGoogleTTSChunk(text: string, slow: boolean): Promise<Buffer> {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) throw new Error('empty text')
  if (clean.length > 190) throw new Error('chunk too long')

  const key = md5(`${slow ? 's' : 'n'}|${clean}`)
  const cached = await getBin('tts', `${key}.mp3`)
  if (cached) return cached

  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

  let lastErr: unknown = null
  for (let attempt = 0; attempt < 4; attempt++) {
    const host = HOSTS[attempt % HOSTS.length]
    const url =
      `${host}/translate_tts?ie=UTF-8&client=tw-ob&tl=vi` +
      `&q=${encodeURIComponent(clean)}&total=1&idx=0&textlen=${clean.length}` +
      `&ttsspeed=${slow ? '0.64' : '1'}`
    try {
      const buf = await throttle(async () => {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 12000)
        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent': UA,
              Referer: 'https://translate.google.com/',
              'Accept-Language': 'vi-VN,vi;q=0.9',
            },
            signal: ctrl.signal,
            cache: 'no-store',
          })
          if (!res.ok) throw new Error(`upstream ${res.status}`)
          const ab = await res.arrayBuffer()
          if (ab.byteLength < 512) throw new Error('audio too short')
          return Buffer.from(ab)
        } finally {
          clearTimeout(t)
        }
      })
      await setBin('tts', `${key}.mp3`, buf)
      return buf
    } catch (e) {
      lastErr = e
      await sleep(350 * (attempt + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('TTS upstream failed')
}
