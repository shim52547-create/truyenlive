'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from 'sonner'
import {
  AudioLines,
  Link2,
  Play,
  Square,
  Info,
  Settings,
  User,
  BookOpen,
  ListOrdered,
  ExternalLink,
  Volume2,
  RotateCcw,
  RotateCw,
  Pause,
  ListMusic,
  Loader2,
  Trash2,
  Eye,
  Search,
  X,
} from 'lucide-react'
import { ReaderEngine, type ChapterRef } from '@/components/reader/engine'
import { formatTime } from '@/lib/text-utils'

interface StoryInfo {
  title: string
  author: string
  genres: string[]
  cover: string
  description: string
  slug: string
  url: string
}

function normalizeStoryUrlClient(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  let slug = ''
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw)
      if (!/(^|\.)truyenfull\.(live|vn|com)$/i.test(u.hostname)) return null
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
  if (!slug) return null
  return `https://truyenfull.live/${slug}/`
}

const SAMPLE_URL = 'https://truyenfull.live/dan-dao-tong-su-chi-thi-tieu-ha-me/'

export default function Home() {
  const [urlInput, setUrlInput] = useState('')
  const [story, setStory] = useState<StoryInfo | null>(null)
  const [loadingStory, setLoadingStory] = useState(false)
  const [chapters, setChapters] = useState<ChapterRef[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listLoadedPages, setListLoadedPages] = useState(0)
  const [listTotalPages, setListTotalPages] = useState(0)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [content, setContent] = useState<{ title: string; paragraphs: string[] } | null>(null)
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [status, setStatus] = useState('Sẵn sàng. Vui lòng nhập link truyện.')
  const [tts, setTts] = useState({ done: 0, total: 0 })
  const [dispTime, setDispTime] = useState(0)
  const [dispDur, setDispDur] = useState(0)
  const [durMap, setDurMap] = useState<Record<number, number>>({})
  const [autoNext, setAutoNext] = useState(true)
  const [readWhole, setReadWhole] = useState(true)
  const [skipAds, setSkipAds] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [pitch, setPitch] = useState(0)
  const [volume, setVolume] = useState(1)
  const [voiceKey, setVoiceKey] = useState('google')
  const [browserVoices, setBrowserVoices] = useState<{ key: string; label: string }[]>([])
  const [cacheInfo, setCacheInfo] = useState<{ files: number; bytes: number } | null>(null)
  const [chapterSearch, setChapterSearch] = useState('')

  const engineRef = useRef<ReaderEngine | null>(null)
  const dispTimeRef = useRef(0)
  const chaptersRef = useRef<ChapterRef[]>([])
  const storyUrlRef = useRef('')
  const optsRef = useRef({ autoNext, readWhole, skipAds, speed, volume })
  const listLoadingRef = useRef(false)

  chaptersRef.current = chapters
  optsRef.current = { autoNext, readWhole, skipAds, speed, volume }
  dispTimeRef.current = dispTime

  // create engine once
  useEffect(() => {
    const engine = new ReaderEngine({
      chapters: [],
      opts: { autoNext: true, readWhole: true, skipAds: true, speed: 1, volume: 1 },
      cb: {
        onStatus: (s) => setStatus(s),
        onChapterStart: (idx, c) => {
          setCurrentIdx(idx)
          setContent(c)
          setDispTime(0)
          setDispDur(0)
        },
        onTtsProgress: (done, total) => setTts({ done, total }),
        onPlayState: (r, p) => {
          setRunning(r)
          setPaused(p)
        },
        onTime: (cur, dur) => {
          setDispTime(cur)
          setDispDur(dur)
        },
        onChapterEnd: (idx, actual) => {
          if (actual > 0) setDurMap((m) => ({ ...m, [idx]: actual }))
          setTts({ done: 0, total: 0 })
        },
        onAllEnd: () => {},
        onNotice: (msg) => toast.warning(msg),
      },
    })
    engineRef.current = engine
    ;(window as unknown as { __readerEngine?: ReaderEngine }).__readerEngine = engine
    return () => engine.destroy()
  }, [])

  // sync engine inputs
  useEffect(() => {
    engineRef.current?.setChapters(chapters)
  }, [chapters])
  useEffect(() => {
    engineRef.current?.setOptions({ autoNext, readWhole, skipAds, speed, volume })
  }, [autoNext, readWhole, skipAds, speed, volume])

  // keep current chapter row visible
  useEffect(() => {
    if (!story) return
    const el = document.getElementById(`ch-row-${currentIdx}`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentIdx, story])

  const loadRemainingChapters = useCallback(async (url: string, from: number, totalPages: number) => {
    if (listLoadingRef.current) return
    listLoadingRef.current = true
    setListLoading(true)
    try {
      let f = from
      while (f <= totalPages) {
        const to = Math.min(f + 7, totalPages)
        const res = await fetch(`/api/chapters?url=${encodeURIComponent(url)}&from=${f}&to=${to}`)
        if (!res.ok) break
        const d = await res.json()
        setChapters((prev) => {
          const seen = new Set(prev.map((c) => c.url))
          const add = (d.chapters as ChapterRef[]).filter((c) => !seen.has(c.url))
          return [...prev, ...add]
        })
        setListLoadedPages(to)
        f = d.nextFrom ?? to + 1
      }
    } finally {
      listLoadingRef.current = false
      setListLoading(false)
    }
  }, [])

  const handleLoadStory = useCallback(async () => {
    const canonical = normalizeStoryUrlClient(urlInput)
    if (!canonical) {
      toast.error('Link không hợp lệ. Hãy dán link truyện từ truyenfull.live')
      return
    }
    // reset previous session
    engineRef.current?.stop('Sẵn sàng. Vui lòng nhập link truyện.')
    setContent(null)
    setChapters([])
    setDurMap({})
    setCurrentIdx(0)
    setDispTime(0)
    setDispDur(0)
    setListLoadedPages(0)
    setListTotalPages(0)
    setChapterSearch('')
    setLoadingStory(true)
    setStatus('Đang tải thông tin truyện…')
    try {
      const res = await fetch(`/api/story?url=${encodeURIComponent(canonical)}`)
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Không tải được truyện')
        setStatus('Lỗi tải truyện. Vui lòng kiểm tra lại link.')
        return
      }
      const info: StoryInfo = data.info
      setStory(info)
      storyUrlRef.current = info.url
      setChapters(data.chapters ?? [])
      setListTotalPages(data.totalPages ?? 1)
      setStatus(`Đã tải truyện "${info.title}". Nhấn Bắt đầu để đọc.`)
      if ((data.totalPages ?? 1) > 1) {
        void loadRemainingChapters(info.url, 2, data.totalPages)
      }
    } catch {
      toast.error('Lỗi kết nối khi tải truyện')
      setStatus('Lỗi kết nối. Vui lòng thử lại.')
    } finally {
      setLoadingStory(false)
    }
  }, [urlInput, loadRemainingChapters])

  const handleStart = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    if (!story || chaptersRef.current.length === 0) {
      toast.error('Vui lòng nhập link truyện và nhấn "Lấy thông tin truyện" trước.')
      return
    }
    if (running) {
      engine.resumeIfPaused()
      return
    }
    setStatus('Đang khởi động…')
    void engine.start(currentIdx)
  }, [story, running, currentIdx])

  const handleStop = useCallback(() => {
    engineRef.current?.stop('Đã dừng.')
    setDispTime(0)
    setDispDur(0)
  }, [])

  const handlePlayPause = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    if (running) {
      engine.togglePause()
    } else {
      handleStart()
    }
  }, [running, handleStart])

  const handleChapterClick = useCallback(
    (idx: number) => {
      setCurrentIdx(idx)
      if (running) {
        engineRef.current?.restartAt(idx)
        setStatus('Đang chuyển chương…')
      } else if (story) {
        // Chọn chương khi đang dừng → phát ngay từ chương đó (click = user gesture)
        const ch = chaptersRef.current[idx]
        setStatus(`Phát từ chương: ${ch?.title ?? ''}…`)
        void engineRef.current?.start(idx)
      }
    },
    [running, story]
  )

  const handleSeekFrac = useCallback(
    (frac: number) => {
      const engine = engineRef.current
      if (!engine) return
      if (!running) {
        toast.info('Nhấn Bắt đầu trước khi tua.')
        return
      }
      engine.seek(frac * Math.max(1, dispDur))
    },
    [running, dispDur]
  )

  const seekBarRef = useRef<HTMLDivElement | null>(null)
  const lastSeekTs = useRef(0)
  const onSeekPointer = useCallback(
    (e: React.PointerEvent) => {
      const el = seekBarRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      lastSeekTs.current = Date.now()
      handleSeekFrac(frac)
    },
    [handleSeekFrac]
  )

  const handleSkip = useCallback(
    (delta: number) => {
      if (!running) return
      engineRef.current?.skip(delta, dispTimeRef.current)
    },
    [running]
  )

  const clearCache = useCallback(async () => {
    try {
      const res = await fetch('/api/cache', { method: 'DELETE' })
      const d = await res.json()
      toast.success(`Đã xóa bộ nhớ đệm (${d.removed ?? 0} tệp)`)
      setCacheInfo(null)
    } catch {
      toast.error('Không xóa được bộ nhớ đệm')
    }
  }, [])

  const openSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/cache')
      setCacheInfo(await res.json())
    } catch {
      /* ignore */
    }
  }, [])

  // lọc danh sách chương theo từ khóa (số chương hoặc tên)
  const chapterQuery = chapterSearch.trim().toLowerCase()
  const numQuery = chapterQuery.replace(/^(chương|chuong|ch\S*)\s+/u, '')
  const visibleChapters: { ch: ChapterRef; idx: number }[] = chapters
    .map((ch, idx) => ({ ch, idx }))
    .filter(({ ch }) => {
      if (!chapterQuery) return true
      if (ch.title.toLowerCase().includes(chapterQuery)) return true
      if (!numQuery) return false
      const s = String(ch.n)
      return s === numQuery || (numQuery.length >= 2 && s.includes(numQuery))
    })

  // detect browser Vietnamese voices (shown as info in the dropdown)
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const load = () => {
      const vs = window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('vi'))
      if (vs.length) {
        setBrowserVoices(vs.map((v) => ({ key: `browser:${v.voiceURI}`, label: `${v.name} (Trình duyệt)` })))
      }
    }
    load()
    window.speechSynthesis.onvoiceschanged = load
  }, [])

  return (
    <div className="min-h-screen bg-[#0a0e1c] text-slate-200">
      {/* ============ HEADER ============ */}
      <header className="border-b border-[#1b2742] bg-[#0c1224]/90 px-5 py-4">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg shadow-blue-600/30">
              <AudioLines className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight text-white">TruyệnFull AI Voice</h1>
              <p className="text-xs text-slate-400">Đọc truyện online từ TruyệnFull bằng giọng AI Google</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-400 md:block">
              Tự động đọc hết chương, chuyển chương liên tục
            </span>
            <Popover onOpenChange={(o) => o && openSettings()}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Cài đặt"
                  className="text-slate-400 hover:bg-white/5 hover:text-white"
                >
                  <Settings className="h-5 w-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 border-[#1b2742] bg-[#0e1528] text-slate-200">
                <h3 className="mb-2 text-sm font-semibold text-white">Cài đặt nâng cao</h3>
                <div className="rounded-lg border border-[#1b2742] bg-[#0a0f20] p-3 text-xs text-slate-400">
                  <p className="mb-2">
                    Giọng đọc: Google Translate TTS (vi-VN) chạy qua máy chủ của tool, tự chia nhỏ và
                    nối các đoạn, kết quả được lưu bộ nhớ đệm.
                  </p>
                  {cacheInfo && (
                    <p className="mb-2 text-slate-300">
                      Bộ nhớ đệm: {cacheInfo.files} tệp ({(cacheInfo.bytes / 1048576).toFixed(1)} MB)
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={clearCache}
                    className="h-8 gap-2 border-[#233252] bg-[#111a33] text-slate-200 hover:bg-[#1a2547]"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Xóa bộ nhớ đệm
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1440px] items-start gap-4 p-4 lg:grid-cols-[370px_1fr]">
        {/* ============ LEFT SIDEBAR ============ */}
        <div className="space-y-4 lg:sticky lg:top-4">
          <StepCard step={1} title="Nhập link truyện">
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoadStory()}
              placeholder="https://truyenfull.live/truyen/ten-truyen"
              className="h-10 border-[#233252] bg-[#0a0f20] text-slate-100 placeholder:text-slate-600"
            />
            <p className="mt-2 truncate text-[11px] text-slate-500">Ví dụ: {SAMPLE_URL}</p>
            <div className="mt-3 flex justify-end">
              <Button
                onClick={handleLoadStory}
                disabled={loadingStory}
                className="h-10 gap-2 bg-blue-600 font-medium text-white hover:bg-blue-500"
              >
                {loadingStory ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                {loadingStory ? 'Đang tải…' : 'Lấy thông tin truyện'}
              </Button>
            </div>
          </StepCard>

          <StepCard step={2} title="Cài đặt giọng đọc">
            <p className="mb-1.5 text-xs text-slate-400">Chọn giọng Google</p>
            <Select value={voiceKey} onValueChange={setVoiceKey}>
              <SelectTrigger className="h-10 w-full gap-2 border-[#233252] bg-[#0a0f20] text-slate-100">
                <span className="flex items-center gap-2">
                  <GoogleG />
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent className="border-[#233252] bg-[#0e1528] text-slate-100">
                <SelectItem value="google">Vietnamese (vi-VN) - Nữ (Google)</SelectItem>
                {browserVoices.map((v) => (
                  <SelectItem key={v.key} value={v.key} disabled>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SliderRow
              label="Tốc độ đọc"
              display={`${speed.toFixed(1)}x`}
              value={speed}
              min={0.5}
              max={2}
              step={0.1}
              onChange={setSpeed}
            />
            <SliderRow
              label="Cao độ (Pitch)"
              display={`${pitch >= 0 ? '+' : ''}${pitch.toFixed(1)}x`}
              value={pitch}
              min={-1}
              max={1}
              step={0.1}
              onChange={setPitch}
              hint="Áp dụng cho giọng trình duyệt, giọng Google giữ nguyên tông tự nhiên."
            />
            <SliderRow
              label="Âm lượng"
              display={`${Math.round(volume * 100)}%`}
              value={volume}
              min={0}
              max={1}
              step={0.05}
              onChange={setVolume}
            />
          </StepCard>

          <StepCard step={3} title="Tùy chọn đọc">
            <OptionRow
              label="Tự động chuyển chương"
              checked={autoNext}
              onCheckedChange={setAutoNext}
            />
            <OptionRow
              label="Đọc toàn bộ chương hiện tại"
              checked={readWhole}
              onCheckedChange={setReadWhole}
            />
            <OptionRow
              label="Bỏ qua phần quảng cáo / thông báo (nếu có)"
              checked={skipAds}
              onCheckedChange={setSkipAds}
            />
          </StepCard>

          <StepCard step={4} title="Điều khiển">
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={handleStart}
                disabled={!story || (running && !paused)}
                className="h-11 gap-2 bg-blue-600 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                <Play className="h-4 w-4 fill-current" /> Bắt đầu
              </Button>
              <Button
                onClick={handleStop}
                disabled={!running}
                variant="outline"
                className="h-11 gap-2 border-[#233252] bg-[#0a0f20] text-slate-200 hover:bg-[#111a33] hover:text-white"
              >
                <Square className="h-4 w-4 fill-current" /> Dừng
              </Button>
            </div>
            <div className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-400">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  running
                    ? paused
                      ? 'bg-amber-400'
                      : 'bg-emerald-400 animate-pulse'
                    : status.includes('Lỗi')
                      ? 'bg-red-400'
                      : 'bg-emerald-500'
                }`}
              />
              <span>{status}</span>
            </div>
          </StepCard>

          <StepCard
            title="Lưu ý"
            icon={<Info className="h-4 w-4 text-slate-500" />}
          >
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-5 text-slate-400">
              <li>Tool hoạt động với các truyện trên TruyenFull.live</li>
              <li>Cần có kết nối internet để sử dụng giọng AI Google</li>
              <li>Có thể bị giới hạn nếu trang web thay đổi cấu trúc</li>
              <li>Vui lòng sử dụng một cách hợp lý</li>
            </ul>
          </StepCard>
        </div>

        {/* ============ RIGHT MAIN PANEL ============ */}
        <div className="space-y-4 min-w-0">
          {/* Story info */}
          {story && (
            <section className="rounded-xl border border-[#1b2742] bg-[#0e1528] p-4">
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="mx-auto h-[205px] w-[150px] shrink-0 overflow-hidden rounded-lg bg-[#101a33] shadow-lg sm:mx-0">
                  {story.cover ? (
                    <img
                      src={`/api/image?url=${encodeURIComponent(story.cover)}`}
                      alt={`Bìa truyện ${story.title}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-slate-600">
                      <BookOpen className="h-10 w-10" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="mb-2 text-2xl font-bold text-white">{story.title}</h2>
                  <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-blue-400" />
                      Tác giả: <span className="text-slate-200">{story.author}</span>
                    </span>
                    {story.genres.length > 0 && (
                      <span className="flex items-center gap-1.5">
                        <BookOpen className="h-3.5 w-3.5 text-blue-400" />
                        Thể loại: <span className="text-slate-200">{story.genres.join(', ')}</span>
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      <ListOrdered className="h-3.5 w-3.5 text-blue-400" />
                      Số chương:{' '}
                      <span className="text-slate-200">
                        {chapters.length}
                        {listLoading ? ' chương (đang tải…)' : ' chương'}
                      </span>
                    </span>
                  </div>
                  {story.description && (
                    <p className="text-sm leading-relaxed text-slate-300 line-clamp-4">
                      {story.description}
                    </p>
                  )}
                  <a href={story.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 border-[#233252] bg-[#0a0f20] text-slate-200 hover:bg-[#111a33] hover:text-white"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Xem trên TruyenFull.live
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </a>
                </div>
              </div>
            </section>
          )}

          {/* Player */}
          <section className="rounded-xl border border-[#1b2742] bg-[#0e1528] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <BookOpen className="h-5 w-5 shrink-0 text-blue-400" />
                <h2 className="truncate text-base font-semibold text-white">
                  {content?.title ??
                    (story
                      ? `Chương ${chapters[currentIdx]?.title ?? ''}`
                      : 'Chưa chọn chương nào')}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs">
                {running ? (
                  paused ? (
                    <span className="text-amber-400">Tạm dừng</span>
                  ) : tts.total > 0 && tts.done < tts.total ? (
                    <span className="flex items-center gap-1.5 text-amber-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Đang tạo giọng đọc ({tts.done}/{tts.total})…
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-emerald-400">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                      Đang đọc…
                    </span>
                  )
                ) : (
                  <span className="text-slate-500">Sẵn sàng</span>
                )}
                {chapters.length > 0 && (
                  <span className="rounded-full border border-[#233252] bg-[#111a33] px-3 py-1 text-slate-300">
                    Chương {currentIdx + 1} / {chapters.length}
                  </span>
                )}
              </div>
            </div>

            <div
              id="content-box"
              className="max-h-[300px] overflow-y-auto rounded-lg border border-[#1b2742] bg-[#0a0f20] p-5"
            >
              {content ? (
                <div className="space-y-4">
                  {content.paragraphs.map((p, i) => (
                    <p key={i} className="text-[15px] leading-7 text-slate-200">
                      {p}
                    </p>
                  ))}
                </div>
              ) : (
                <div className="py-14 text-center text-slate-500">
                  <BookOpen className="mx-auto mb-3 h-10 w-10 opacity-40" />
                  <p className="text-sm">
                    {story
                      ? 'Nhấn "Bắt đầu" hoặc chọn một chương trong danh sách để bắt đầu đọc.'
                      : 'Nhập link truyện ở cột bên trái và nhấn "Lấy thông tin truyện" để bắt đầu.'}
                  </p>
                </div>
              )}
            </div>

            {/* seek row */}
            <div className="mt-4 flex items-center gap-3 text-xs text-slate-400">
              <span className="w-10 shrink-0 text-right tabular-nums">{formatTime(dispTime)}</span>
              <div
                ref={seekBarRef}
                className="group relative flex h-6 flex-1 cursor-pointer items-center"
                onPointerDown={onSeekPointer}
                onPointerMove={(e) => {
                  if (e.buttons === 1 && Date.now() - lastSeekTs.current > 250) onSeekPointer(e)
                }}
                aria-label="Thanh tiến trình"
                role="slider"
                aria-valuemin={0}
                aria-valuemax={Math.round(dispDur)}
                aria-valuenow={Math.round(dispTime)}
              >
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1b2742]">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: `${dispDur > 0 ? Math.min(100, (dispTime / dispDur) * 100) : 0}%` }}
                  />
                </div>
                <div
                  className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-blue-400 opacity-0 shadow transition-opacity group-hover:opacity-100"
                  style={{
                    left: `${dispDur > 0 ? Math.min(100, (dispTime / dispDur) * 100) : 0}%`,
                  }}
                />
              </div>
              <span className="w-10 shrink-0 tabular-nums">{formatTime(dispDur)}</span>
            </div>

            {/* transport controls */}
            <div className="relative mt-1 flex items-center justify-center gap-8 py-1">
              <button
                onClick={() => handleSkip(-10)}
                disabled={!running}
                aria-label="Tua lại 10 giây"
                className="relative text-slate-300 transition-colors hover:text-white disabled:opacity-30"
              >
                <RotateCcw className="h-7 w-7" />
                <span className="absolute inset-0 grid place-items-center pt-0.5 text-[9px] font-semibold">
                  10
                </span>
              </button>
              <Button
                onClick={handlePlayPause}
                disabled={!story}
                aria-label={running && !paused ? 'Tạm dừng' : 'Phát'}
                className="grid h-14 w-14 place-items-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/40 hover:bg-blue-500 disabled:opacity-40"
                size="icon"
              >
                {running && !paused ? (
                  <Pause className="h-6 w-6 fill-current" />
                ) : (
                  <Play className="ml-0.5 h-6 w-6 fill-current" />
                )}
              </Button>
              <button
                onClick={() => handleSkip(10)}
                disabled={!running}
                aria-label="Tua nhanh 10 giây"
                className="relative text-slate-300 transition-colors hover:text-white disabled:opacity-30"
              >
                <RotateCw className="h-7 w-7" />
                <span className="absolute inset-0 grid place-items-center pt-0.5 text-[9px] font-semibold">
                  10
                </span>
              </button>
              <div className="absolute right-0 hidden items-center gap-2 md:flex">
                <Volume2 className="h-4 w-4 text-slate-400" />
                <Slider
                  value={[volume]}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={(v) => setVolume(v[0])}
                  aria-label="Âm lượng"
                  className="w-24"
                />
              </div>
            </div>
          </section>

          {/* Chapter list */}
          <section className="rounded-xl border border-[#1b2742] bg-[#0e1528] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ListMusic className="h-5 w-5 text-blue-400" />
                <h2 className="text-base font-semibold text-white">Danh sách chương</h2>
                {listLoading && (
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {chapters.length} chương
                  </span>
                )}
                {!listLoading && chapters.length > 0 && (
                  <span className="text-xs tabular-nums text-slate-500">
                    {chapterQuery
                      ? `${visibleChapters.length}/${chapters.length} chương`
                      : `${chapters.length} chương`}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Tự động đọc</span>
                <Switch checked={autoNext} onCheckedChange={setAutoNext} aria-label="Tự động đọc" />
              </div>
            </div>
            {/* tìm kiếm chương */}
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                value={chapterSearch}
                onChange={(e) => setChapterSearch(e.target.value)}
                placeholder="Tìm chương theo số hoặc tên…"
                aria-label="Tìm kiếm chương"
                className="h-9 border-[#233252] bg-[#0a0f20] pl-9 pr-9 text-sm text-slate-100 placeholder:text-slate-600"
              />
              {chapterSearch && (
                <button
                  onClick={() => setChapterSearch('')}
                  aria-label="Xóa tìm kiếm"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mb-2 text-[11px] text-slate-500">
              Chọn một chương bất kỳ để phát ngay từ chương đó.
            </p>
            <div className="nice-scroll max-h-[340px] space-y-1 overflow-y-auto pr-1">
              {chapters.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-500">
                  {story ? 'Đang tải danh sách chương…' : 'Danh sách chương sẽ hiển thị sau khi tải truyện.'}
                </p>
              )}
              {chapters.length > 0 && visibleChapters.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-500">
                  Không tìm thấy chương nào khớp “{chapterSearch}”.
                </p>
              )}
              {visibleChapters.map(({ ch, idx }) => {
                const active = idx === currentIdx
                return (
                  <button
                    key={ch.url}
                    id={`ch-row-${idx}`}
                    onClick={() => handleChapterClick(idx)}
                    className={`group flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors ${
                      active
                        ? 'border border-blue-500/40 bg-blue-600/15 text-blue-300'
                        : 'border border-transparent text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    <Play
                      className={`h-3.5 w-3.5 shrink-0 fill-current ${
                        active
                          ? 'animate-pulse text-blue-400'
                          : 'text-slate-600 group-hover:text-blue-400'
                      }`}
                    />
                    <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-500">
                      {ch.n}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{ch.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">
                      {durMap[idx] ? formatTime(durMap[idx]) : '—'}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

function StepCard({
  step,
  title,
  icon,
  children,
}: {
  step?: number
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-[#1b2742] bg-[#0e1528] p-4">
      <div className="mb-3 flex items-center gap-2">
        {step != null && (
          <span className="grid h-6 w-6 place-items-center rounded-full bg-blue-600 text-xs font-bold text-white">
            {step}
          </span>
        )}
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {icon}
      </div>
      {children}
    </section>
  )
}

function SliderRow({
  label,
  display,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string
  display: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  hint?: string
}) {
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs text-slate-400">{label}</span>
        <span className="text-xs tabular-nums text-slate-300">{display}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        aria-label={label}
      />
      {hint && <p className="mt-1 text-[10px] text-slate-600">{hint}</p>}
    </div>
  )
}

function OptionRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-1.5 text-sm text-slate-300">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="border-slate-500 data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600"
      />
      {label}
    </label>
  )
}

function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.2 3.7-8.6z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.1 0-5.8-2.1-6.7-5l-3.9 3C3.3 21.3 7.3 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.3 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4l-3.9-3C.5 8.2 0 10 0 12s.5 3.8 1.4 5.4l3.9-3z"
      />
      <path
        fill="#EA4335"
        d="M12 4.7c1.8 0 3 .8 3.7 1.4l2.7-2.6C16.9 1.3 15.2 0 12 0 7.3 0 3.3 2.7 1.4 6.6l3.9 3c.9-2.9 3.6-4.9 6.7-4.9z"
      />
    </svg>
  )
}
