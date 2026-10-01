/**
 * Split Vietnamese chapter text into TTS-friendly chunks (<= maxLen chars),
 * preferring sentence boundaries, then clause boundaries, then word boundaries.
 */
export function splitIntoChunks(text: string, maxLen = 180): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []

  // break into sentences
  const sentences = normalized.match(/[^.!?…]*[.!?…]+["»”')\]]*|[^.!?…]+$/g) ?? [normalized]
  const chunks: string[] = []
  let cur = ''

  const pushCur = () => {
    const t = cur.trim()
    if (t) chunks.push(t)
    cur = ''
  }

  const addHardSplit = (s: string) => {
    // split long sentence at clause punctuation, then at spaces
    let parts = s.split(/(?<=[,;:])/)
    for (const part of parts) {
      if ((cur + part).trim().length <= maxLen) {
        cur += part
        continue
      }
      pushCur()
      if (part.trim().length <= maxLen) {
        cur = part
        continue
      }
      // hard wrap on words
      const words = part.split(' ')
      for (const w of words) {
        if ((cur + w + ' ').length <= maxLen) {
          cur += w + ' '
        } else {
          pushCur()
          cur = w + ' '
        }
      }
    }
  }

  for (const s of sentences) {
    if ((cur + s).length <= maxLen) {
      cur += s
      continue
    }
    pushCur()
    if (s.length <= maxLen) {
      cur = s
    } else {
      addHardSplit(s)
    }
  }
  pushCur()
  return chunks
}

export function estimateChunkSeconds(chars: number, speed = 1): number {
  // Vietnamese Google TTS reads ~13.5 chars/second at 1x
  return chars / (13.5 * Math.max(0.25, speed))
}

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
