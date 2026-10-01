import { md5, getJSON, setJSON } from '@/lib/cache'

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const STORY_CACHE_TTL = 60 * 60 * 1000 // 1h
const LIST_PAGE_CACHE_TTL = 6 * 60 * 60 * 1000 // 6h
const CHAPTER_CACHE_TTL = 24 * 60 * 60 * 1000 // 24h

export interface ChapterItem {
  n: number
  title: string
  url: string
}

export interface StoryInfo {
  title: string
  author: string
  genres: string[]
  cover: string
  description: string
  slug: string
  url: string
}

async function fetchText(url: string, timeoutMs = 20000, retries = 2): Promise<string> {
  let lastErr: unknown = null
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
        },
        signal: ctrl.signal,
        redirect: 'follow',
        cache: 'no-store',
      })
      clearTimeout(t)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (e) {
      clearTimeout(t)
      lastErr = e
      if (i < retries) await new Promise((r) => setTimeout(r, 500 * (i + 1)))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('fetch failed')
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => {
      try {
        return String.fromCodePoint(parseInt(d, 10))
      } catch {
        return ''
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16))
      } catch {
        return ''
      }
    })
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;/g, "'")
}

/** Accept full URLs (story/chapter pages), /truyen/… or /doc-truyen/… forms, or a bare slug. */
export function normalizeStoryUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  let host = 'truyenfull.live'
  let slug = ''
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw)
      if (!/(^|\.)truyenfull\.(live|vn|com)$/i.test(u.hostname)) return null
      host = u.hostname
      const seg = u.pathname.split('/').filter(Boolean)
      let i = 0
      if (seg[i] === 'truyen' || seg[i] === 'doc-truyen' || seg[i] === 'chuong') i++
      slug = seg[i] ?? ''
    } catch {
      return null
    }
  } else if (/^[a-z0-9-]+$/i.test(raw)) {
    slug = raw
  } else {
    return null
  }
  if (!slug || /^trang-\d+$/i.test(slug)) return null
  return `https://${host}/${slug}/`
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function parseChapterItems(html: string): ChapterItem[] {
  const items: ChapterItem[] = []
  const uls = html.match(/<ul class="list-chapter">[\s\S]*?<\/ul>/g) ?? []
  for (const ul of uls) {
    const liRe = /<li><span[^>]*><\/span>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/li>/g
    let m: RegExpExecArray | null
    while ((m = liRe.exec(ul)) !== null) {
      let title = stripTags(m[2].replace(/<span class="chapter-text">[\s\S]*?<\/span>/g, ''))
      // title like "1: Cửu U Bí Lục" (site already includes number)
      const n = parseInt(title, 10)
      if (title.startsWith(': ')) title = title.slice(2)
      items.push({ n: isNaN(n) ? items.length + 1 : n, title, url: m[1] })
    }
  }
  return items
}

function parsePagination(html: string): number {
  let max = 1
  const pag = html.match(/<ul class="pagination[\s\S]*?<\/ul>/g)
  const region = pag ? pag.join(' ') : html
  const re = /\/trang-(\d+)\//g
  let m: RegExpExecArray | null
  while ((m = re.exec(region)) !== null) max = Math.max(max, parseInt(m[1], 10))
  return max
}

/** Strip tags but preserve newlines (unlike stripTags). */
function stripTagsKeepLines(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
}

function cleanDescription(html: string): string {
  const i = html.indexOf('class="desc-text"')
  if (i < 0) return ''
  const openEnd = html.indexOf('>', i) + 1
  const close = html.indexOf('</div>', openEnd)
  const inner = html.slice(openEnd, close > 0 ? close : openEnd + 8000)
  const text = stripTagsKeepLines(
    inner
      .replace(/<span[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
  )
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    // drop the site template SEO paragraph
    .filter((l) => !/^bạn đang theo dõi đọc truyện online/i.test(l))
    .filter((l) => !/^truyen\s*full|^truyenfull/i.test(l))
    .filter((l) => !/^(đọc truyện|truyện full|đăng bởi|nguồn)/i.test(l))
  return lines.join('\n')
}

export async function getStoryInfo(
  canonicalUrl: string
): Promise<{ info: StoryInfo; chapters: ChapterItem[]; totalPages: number }> {
  const cacheKey = md5(canonicalUrl)
  const cached = await getJSON<{ info: StoryInfo; chapters: ChapterItem[]; totalPages: number }>(
    'story',
    cacheKey,
    STORY_CACHE_TTL
  )
  if (cached) return cached

  const html = await fetchText(canonicalUrl)
  if (/<title>.*404|không tìm thấy|not found/i.test(html.slice(0, 3000)) && !/class="title"/.test(html)) {
    throw new Error('Không tìm thấy truyện (404)')
  }

  const title =
    stripTags((html.match(/<h3 class="title"[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? '') ||
      (html.match(/<a class="truyen-title"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '')) || 'Không rõ tiêu đề'

  const author = stripTags(html.match(/<a itemprop="author"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '') || 'Đang cập nhật'

  const genres: string[] = []
  const gRe = /<a itemprop="genre"[^>]*>([\s\S]*?)<\/a>/g
  let gm: RegExpExecArray | null
  while ((gm = gRe.exec(html)) !== null) {
    const g = stripTags(gm[1])
    if (g && !genres.includes(g)) genres.push(g)
    if (genres.length >= 4) break
  }

  const cover =
    html.match(/<div class="book"><img src="([^"]+)"/)?.[1] ??
    html.match(/<div class="book"[^>]*>\s*<img[^>]*src="([^"]+)"/)?.[1] ??
    ''

  const description = cleanDescription(html)
  const chapters = parseChapterItems(html)
  const totalPages = parsePagination(html)

  const data = {
    info: {
      title,
      author,
      genres,
      cover,
      description,
      slug: canonicalUrl.replace(/https:\/\/[^/]+\//, '').replace(/\//g, ''),
      url: canonicalUrl,
    } as StoryInfo,
    chapters,
    totalPages,
  }
  await setJSON('story', cacheKey, data)
  return data
}

export async function getChapterListPage(slugUrl: string, page: number): Promise<ChapterItem[]> {
  const key = md5(`${slugUrl}|p${page}`)
  const cached = await getJSON<ChapterItem[]>('listpage', key, LIST_PAGE_CACHE_TTL)
  if (cached) return cached
  const url = page <= 1 ? slugUrl : `${slugUrl.replace(/\/$/, '')}/trang-${page}/`
  const html = await fetchText(url)
  const items = parseChapterItems(html)
  if (items.length) await setJSON('listpage', key, items)
  return items
}

export interface ChapterContent {
  title: string
  paragraphs: string[]
  charCount: number
}

const ALWAYS_NOISE = [
  /^truyen\s*full/i,
  /^truyenfull/i,
  /truyenfulllive/i,
  /^8cache/i,
  /^wattpad$/i,
  /^(wedu|adscript|adsbygoogle)$/i,
]

const AD_PATTERNS = [
  /^đăng bởi/i,
  /^nguồn[:\s]/i,
  /^source[:\s]/i,
  /quảng\s*cao/i,
  /^hệ thống\s*đang/i,
  /^website\s*(mua|bán)/i,
  /^https?:\/\//i,
  /^www\./i,
  /^(chương trước|chương sau|danh sách chương|mục lục)\s*[:.]?\s*$/i,
  /^(bạn đang đọc|đọc truyện|đang đọc truyện)\b.*\b(online|truyện chữ|miễn phí)\b/i,
  /^(chúc bạn đọc truyện|chúc các bạn đọc truyện)/i,
]

function extractChapterBody(html: string): string {
  const startMatch = html.match(/id="chapter-c"[^>]*>/)
  if (!startMatch || startMatch.index === undefined) return ''
  const start = startMatch.index + startMatch[0].length
  let end = html.length
  const markers = ['id="ads-chapter-bottom"', 'class="chapter-nav"', 'hr class="chapter-end"', 'id="comments']
  for (const mk of markers) {
    const i = html.indexOf(mk, start)
    if (i !== -1) {
      // cut at the '<' that opens the tag containing the marker, so we never split mid-tag
      const lt = html.lastIndexOf('<', i)
      end = Math.min(end, lt > start ? lt : i)
    }
  }
  let body = html.slice(start, end)
  // remove hidden SEO blocks
  body = body.replace(/<p[^>]*display:\s*none[^>]*>[\s\S]*?<\/p>/gi, '')
  body = body.replace(/<span[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, '')
  body = body.replace(/<div[^>]*display:\s*none[^>]*>[\s\S]*?<\/div>/gi, '')
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '')
  body = body.replace(/<style[\s\S]*?<\/style>/gi, '')
  return body
}

export async function getChapterContent(url: string): Promise<ChapterContent> {
  if (!/truyenfull\.(live|vn|com)/i.test(url)) throw new Error('URL chương không hợp lệ')
  const key = md5(url)
  const cached = await getJSON<ChapterContent>('chapter', key, CHAPTER_CACHE_TTL)
  if (cached) return cached

  const html = await fetchText(url)
  const rawTitle = stripTags(
    (html.match(/<a class="chapter-title"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '').replace(
      /<span class="chapter-text">[\s\S]*?<\/span>/g,
      ''
    )
  )
  const storyTitle = stripTags(html.match(/<a class="truyen-title"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '')
  const title = rawTitle || 'Chương'

  const body = extractChapterBody(html)
  let paras = body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
  paras = decodeEntities(paras.replace(/<[^>]+>/g, ''))
  const lines = paras
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    // always remove pure SEO noise lines
    .filter((l) => !ALWAYS_NOISE.some((re) => re.test(l)))

  const data: ChapterContent = {
    title: storyTitle && title.startsWith(storyTitle) ? title : title,
    paragraphs: lines,
    charCount: lines.join('').length,
  }
  await setJSON('chapter', key, data)
  return data
}

export function filterAds(paragraphs: string[], skipAds: boolean): string[] {
  if (!skipAds) return paragraphs
  return paragraphs.filter((l) => !AD_PATTERNS.some((re) => re.test(l)))
}
