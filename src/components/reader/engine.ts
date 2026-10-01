import { splitIntoChunks, estimateChunkSeconds } from '@/lib/text-utils'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export interface ChapterRef {
  n: number
  title: string
  url: string
}

export interface EngineOptions {
  autoNext: boolean
  readWhole: boolean
  skipAds: boolean
  speed: number
  volume: number
}

export interface EngineCallbacks {
  onStatus: (s: string) => void
  onChapterStart: (idx: number, content: { title: string; paragraphs: string[] } | null) => void
  onTtsProgress: (done: number, total: number) => void
  onPlayState: (running: boolean, paused: boolean) => void
  onTime: (current: number, duration: number) => void
  onChapterEnd: (idx: number, actualDuration: number) => void
  onAllEnd: () => void
  onNotice: (msg: string) => void
}

const TTS_CONCURRENCY = 3

export class ReaderEngine {
  private audio: HTMLAudioElement
  private cb: EngineCallbacks
  private opts: EngineOptions
  private chapters: ChapterRef[]

  private running = false
  private paused = false
  private token = 0
  private playIdx = 0
  private pendingSeek: number | null = null
  private chunks: string[] = []
  private chunkUrls: (string | null)[] = []
  private chunkDur: number[] = []
  private loadedCount = 0
  private advance: (() => void) | null = null
  private aborters = new Set<AbortController>()
  private lastEmit = 0
  private noticeShown = false
  private playbackStarted = false

  constructor(o: { chapters: ChapterRef[]; opts: EngineOptions; cb: EngineCallbacks }) {
    this.chapters = o.chapters
    this.opts = o.opts
    this.cb = o.cb
    this.audio = new Audio()
    this.audio.preload = 'auto'
    this.audio.volume = o.opts.volume
    this.audio.addEventListener('timeupdate', () => this.emitTime())
    this.audio.addEventListener('loadedmetadata', () => {
      const d = this.audio.duration
      if (isFinite(d) && d > 0 && this.playIdx < this.chunkDur.length) {
        this.chunkDur[this.playIdx] = d
        this.emitTime(true)
      }
    })
  }

  setChapters(chapters: ChapterRef[]) {
    this.chapters = chapters
  }

  setOptions(o: Partial<EngineOptions>) {
    Object.assign(this.opts, o)
    if (o.speed !== undefined) this.audio.playbackRate = o.speed
    if (o.volume !== undefined) this.audio.volume = o.volume
  }

  private effDur(i: number): number {
    const d = this.chunkDur[i] ?? 0
    if (d > 0) return d
    return estimateChunkSeconds((this.chunks[i] ?? '').length, this.opts.speed)
  }

  private totalDur(): number {
    let s = 0
    for (let i = 0; i < this.chunks.length; i++) s += this.effDur(i)
    return s
  }

  private baseTime(): number {
    let s = 0
    const upto = Math.min(this.playIdx, this.chunks.length)
    for (let i = 0; i < upto; i++) s += this.effDur(i)
    return s
  }

  private emitTime(force = false) {
    const now = Date.now()
    if (!force && now - this.lastEmit < 250) return
    this.lastEmit = now
    const cur = isFinite(this.audio.currentTime) ? this.audio.currentTime : 0
    this.cb.onTime(this.baseTime() + cur, this.totalDur())
  }

  // ---------- playback core ----------

  private playChunk(url: string): Promise<{ ended: boolean }> {
    const a = this.audio
    return new Promise<{ ended: boolean }>((resolve) => {
      let settled = false
      const settle = (ended: boolean) => {
        if (settled) return
        settled = true
        a.onended = null
        a.onerror = null
        this.advance = null
        resolve({ ended })
      }
      this.advance = () => settle(false)
      a.onended = () => settle(true)
      a.onerror = () => settle(true)
      a.src = url
      a.playbackRate = this.opts.speed
      a.volume = this.opts.volume
      const seek = this.pendingSeek
      this.pendingSeek = null
      if (seek != null) {
        const apply = () => {
          try {
            a.currentTime = seek
          } catch {
            /* noop */
          }
        }
        if (a.readyState >= 1) apply()
        else a.addEventListener('loadedmetadata', apply, { once: true })
      }
      a.play().catch((err: unknown) => {
        const name = (err as { name?: string })?.name
        if (name === 'NotAllowedError') {
          // Browser blocked autoplay — pause and wait for an explicit user gesture.
          this.paused = true
          this.cb.onPlayState(true, true)
          this.cb.onStatus('Trình duyệt chặn tự động phát. Nhấn nút Phát để tiếp tục.')
          settle(false)
        } else {
          settle(true)
        }
      })
    })
  }

  private async produceLoop(myToken: number): Promise<void> {
    let next = 0
    const worker = async (): Promise<void> => {
      while (this.running && this.token === myToken) {
        const i = next
        if (i >= this.chunks.length) return
        next++
        if (this.chunkUrls[i]) continue

        let ok = false
        for (let attempt = 0; attempt < 3; attempt++) {
          if (!this.running || this.token !== myToken) return
          const ac = new AbortController()
          this.aborters.add(ac)
          try {
            const res = await fetch(`/api/tts?text=${encodeURIComponent(this.chunks[i])}`, {
              signal: ac.signal,
            })
            if (!res.ok) throw new Error(`TTS ${res.status}`)
            const blob = await res.blob()
            if (!this.running || this.token !== myToken) return
            if (this.chunkUrls[i] == null) this.chunkUrls[i] = URL.createObjectURL(blob)
            ok = true
            break
          } catch {
            if (ac.signal.aborted || !this.running || this.token !== myToken) return
            await sleep(400 * (attempt + 1))
          } finally {
            this.aborters.delete(ac)
          }
        }
        if (!ok) {
          this.chunkUrls[i] = 'skip'
          if (!this.noticeShown) {
            this.noticeShown = true
            this.cb.onNotice('Một vài đoạn không tạo được giọng đọc và đã được bỏ qua.')
          }
        }
        this.loadedCount++
        this.cb.onTtsProgress(this.loadedCount, this.chunks.length)
        if (!this.playbackStarted) {
          this.cb.onStatus(`Đang tạo giọng đọc (${this.loadedCount}/${this.chunks.length})…`)
        }
        await sleep(40)
      }
    }
    await Promise.all(Array.from({ length: TTS_CONCURRENCY }, () => worker()))
  }

  private async consumeLoop(myToken: number): Promise<'finished' | 'stopped'> {
    let announcedPlay = false
    while (this.running && this.token === myToken) {
      while (this.paused && this.running && this.token === myToken) await sleep(120)
      if (!this.running || this.token !== myToken) break
      if (this.playIdx >= this.chunks.length) return 'finished'
      const url = this.chunkUrls[this.playIdx]
      if (!url) {
        await sleep(150)
        continue
      }
      if (url === 'skip') {
        this.playIdx++
        continue
      }
      if (!announcedPlay) {
        announcedPlay = true
        this.playbackStarted = true
        this.cb.onStatus('Đang đọc…')
      }
      const r = await this.playChunk(url)
      if (!this.running || this.token !== myToken) break
      if (r.ended) this.playIdx++
      this.emitTime(true)
    }
    return 'stopped'
  }

  private async runChapter(myToken: number, idx: number): Promise<'finished' | 'stopped'> {
    this.playIdx = 0
    this.pendingSeek = null
    this.chunks = []
    this.chunkUrls = []
    this.chunkDur = []
    this.loadedCount = 0
    this.noticeShown = false
    this.playbackStarted = false
    this.cb.onChapterStart(idx, null)
    this.cb.onTtsProgress(0, 0)
    this.cb.onStatus('Đang tải nội dung chương…')

    const ch = this.chapters[idx]
    if (!ch) return 'stopped'

    let content: { title: string; paragraphs: string[] } | null = null
    const ac = new AbortController()
    this.aborters.add(ac)
    try {
      const res = await fetch(
        `/api/chapter?url=${encodeURIComponent(ch.url)}&skipAds=${this.opts.skipAds ? 1 : 0}`,
        { signal: ac.signal }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      content = await res.json()
    } catch {
      if (!this.running || this.token !== myToken) return 'stopped'
      this.cb.onNotice('Không tải được nội dung chương, sẽ bỏ qua chương này.')
      return 'error'
    } finally {
      this.aborters.delete(ac)
    }
    if (!this.running || this.token !== myToken) return 'stopped'

    let paras = content.paragraphs ?? []
    if (!paras.length) {
      this.cb.onNotice('Chương này trống hoặc không đọc được nội dung, sẽ bỏ qua.')
      return 'error'
    }
    if (!this.opts.readWhole) {
      let total = 0
      const cut: string[] = []
      for (const p of paras) {
        if (total >= 1200) break
        cut.push(p)
        total += p.length
      }
      paras = cut
    }

    const displayTitle = `Chương ${content.title}`
    this.cb.onChapterStart(idx, { title: displayTitle, paragraphs: content.paragraphs })

    const announce = `Chương ${content.title}.`.slice(0, 190)
    const chunks = [announce, ...splitIntoChunks(paras.join(' '))]
    this.chunks = chunks
    this.chunkUrls = new Array(chunks.length).fill(null)
    this.chunkDur = new Array(chunks.length).fill(0)
    this.cb.onTtsProgress(0, chunks.length)
    this.cb.onStatus(`Đang tạo giọng đọc (0/${chunks.length})…`)

    await Promise.all([this.produceLoop(myToken), this.consumeLoop(myToken)])
    if (!this.running || this.token !== myToken) return 'stopped'

    // chapter finished normally
    const allKnown = this.chunkDur.length > 0 && this.chunkDur.every((d) => d > 0)
    const actual = allKnown ? this.chunkDur.reduce((a, b) => a + b, 0) : 0
    this.cb.onChapterEnd(idx, actual)
    return 'finished'
  }

  async start(startIdx: number): Promise<void> {
    if (this.running) return
    this.running = true
    this.paused = false
    this.cb.onPlayState(true, false)
    const myToken = ++this.token
    let idx = Math.max(0, Math.min(startIdx, this.chapters.length - 1))

    let consecutiveErrors = 0
    while (this.running && this.token === myToken && idx < this.chapters.length) {
      const r = await this.runChapter(myToken, idx)
      if (this.token !== myToken) return
      if (r === 'stopped') {
        // genuine stop requested elsewhere (stop()); nothing to clean up
        return
      }
      if (r === 'error') {
        consecutiveErrors++
        if (!this.opts.autoNext || consecutiveErrors >= 3) {
          this.running = false
          this.paused = false
          this.cb.onPlayState(false, false)
          this.cb.onStatus(
            consecutiveErrors >= 3
              ? 'Lỗi liên tiếp nhiều chương. Đã dừng — kiểm tra kết nối rồi nhấn Bắt đầu.'
              : 'Lỗi khi đọc chương. Nhấn Bắt đầu để thử lại.'
          )
          return
        }
        // skip to next chapter automatically
        idx++
        continue
      }
      consecutiveErrors = 0
      if (!this.opts.autoNext) break
      idx++
    }

    if (this.token !== myToken) return
    this.running = false
    this.paused = false
    this.cb.onPlayState(false, false)
    const finishedAll = idx >= this.chapters.length
    this.cb.onStatus(
      finishedAll
        ? 'Đã đọc xong toàn bộ truyện! Chọn chương khác hoặc nhập link truyện mới.'
        : 'Đã đọc xong chương này. Nhấn Bắt đầu để đọc tiếp.'
    )
    if (finishedAll) this.cb.onAllEnd()
  }

  togglePause(): boolean {
    if (!this.running) return false
    this.paused = !this.paused
    if (this.paused) {
      this.audio.pause()
      this.cb.onStatus('Tạm dừng.')
    } else {
      this.audio.play().catch(() => {})
      this.cb.onStatus('Đang đọc…')
    }
    this.cb.onPlayState(true, this.paused)
    return this.paused
  }

  resumeIfPaused() {
    if (this.running && this.paused) this.togglePause()
  }

  stop(statusText = 'Đã dừng.') {
    this.running = false
    this.token++
    this.paused = false
    this.aborters.forEach((ac) => ac.abort())
    this.aborters.clear()
    this.advance?.()
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.revokeAll()
    this.chunkUrls = []
    this.chunks = []
    this.cb.onPlayState(false, false)
    this.cb.onTtsProgress(0, 0)
    this.cb.onStatus(statusText)
  }

  /** Jump straight to a chapter (used when clicking a row while playing). */
  restartAt(idx: number) {
    this.hardReset()
    this.cb.onPlayState(true, false)
    void this.start(idx)
  }

  private hardReset() {
    this.running = false
    this.token++
    this.paused = false
    this.aborters.forEach((ac) => ac.abort())
    this.aborters.clear()
    this.advance?.()
    this.audio.pause()
    this.revokeAll()
  }

  seek(t: number) {
    if (!this.running || !this.chunks.length) return
    let acc = 0
    for (let i = 0; i < this.chunks.length; i++) {
      const d = this.effDur(i)
      const last = i === this.chunks.length - 1
      if (acc + d > t || last) {
        const off = Math.max(0, Math.min(t - acc, Math.max(0, d - 0.05)))
        const a = this.audio
        if (i === this.playIdx && !a.paused && !a.ended) {
          try {
            a.currentTime = off
          } catch {
            /* noop */
          }
        } else {
          this.playIdx = i
          this.pendingSeek = off
          a.pause()
          this.advance?.()
        }
        this.emitTime(true)
        return
      }
      acc += d
    }
  }

  skip(delta: number, currentDisplay: number) {
    this.seek(Math.max(0, currentDisplay + delta))
  }

  private revokeAll() {
    for (const u of this.chunkUrls) {
      if (u && u !== 'skip') {
        try {
          URL.revokeObjectURL(u)
        } catch {
          /* noop */
        }
      }
    }
  }

  getAudioPlaybackRate(): number {
    return this.audio.playbackRate
  }

  destroy() {
    this.stop('')
  }
}
