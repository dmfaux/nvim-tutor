import type { Pos, Span } from './types'

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n))
}

export function cmp(a: Pos, b: Pos): number {
  if (a.line !== b.line) return a.line - b.line
  return a.col - b.col
}

export function samePos(a: Pos, b: Pos): boolean {
  return a.line === b.line && a.col === b.col
}

export function charAt(lines: string[], pos: Pos): string | undefined {
  return lines[pos.line]?.[pos.col]
}

export function clampNormal(lines: string[], pos: Pos): Pos {
  if (lines.length === 0) return { line: 0, col: 0 }
  const line = clamp(pos.line, 0, lines.length - 1)
  const len = lines[line]?.length ?? 0
  const col = len === 0 ? 0 : clamp(pos.col, 0, len - 1)
  return { line, col }
}

export function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t'
}

export function wordKind(ch: string): 'word' | 'punct' | 'space' {
  if (isSpace(ch)) return 'space'
  if (/[A-Za-z0-9_]/.test(ch)) return 'word'
  return 'punct'
}

export function nextPos(lines: string[], pos: Pos): Pos | null {
  const line = lines[pos.line] ?? ''
  if (pos.col + 1 < line.length) return { line: pos.line, col: pos.col + 1 }
  if (pos.line + 1 < lines.length) return { line: pos.line + 1, col: 0 }
  return null
}

export function prevPos(lines: string[], pos: Pos): Pos | null {
  if (pos.col > 0) return { line: pos.line, col: pos.col - 1 }
  if (pos.line === 0) return null
  const prev = lines[pos.line - 1] ?? ''
  return { line: pos.line - 1, col: Math.max(0, prev.length - 1) }
}

export function firstNonBlank(line: string): number {
  const m = /\S/.exec(line)
  return m ? m.index : 0
}

export function lastCol(line: string): number {
  return Math.max(0, line.length - 1)
}

export function linewiseSpan(a: number, b: number): Span {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return {
    start: { line: lo, col: 0 },
    end: { line: hi, col: 0 },
    linewise: true,
  }
}

export function spanFromMove(from: Pos, to: Pos, inclusive: boolean, linewise: boolean): Span {
  if (linewise) return linewiseSpan(from.line, to.line)
  if (!inclusive) return { start: from, end: to, linewise: false, exclusiveEnd: true }
  const forward = cmp(from, to) <= 0
  return {
    start: forward ? from : to,
    end: forward ? to : from,
    linewise: false,
    exclusiveEnd: false,
  }
}

export function deleteSpan(lines: string[], span: Span): { lines: string[]; text: string; cursor: Pos } {
  const base = lines.length ? lines : ['']
  if (span.linewise) {
    const lo = clamp(Math.min(span.start.line, span.end.line), 0, base.length - 1)
    const hi = clamp(Math.max(span.start.line, span.end.line), 0, base.length - 1)
    const text = base.slice(lo, hi + 1).join('\n')
    const next = [...base.slice(0, lo), ...base.slice(hi + 1)]
    if (next.length === 0) next.push('')
    return { lines: next, text, cursor: clampNormal(next, { line: lo, col: 0 }) }
  }
  if (span.exclusiveEnd) {
    if (samePos(span.start, span.end)) return { lines: base.slice(), text: '', cursor: clampNormal(base, span.start) }
    const forward = cmp(span.start, span.end) < 0
    const from = forward ? span.start : span.end
    const to = forward ? span.end : span.start
    return deleteHalfOpen(base, from, to)
  }
  const forward = cmp(span.start, span.end) <= 0
  const from = forward ? span.start : span.end
  const inclusiveEnd = forward ? span.end : span.start
  const to = nextPos(base, inclusiveEnd)
  return deleteHalfOpen(base, from, to)
}

function deleteHalfOpen(lines: string[], start: Pos, end: Pos | null): { lines: string[]; text: string; cursor: Pos } {
  const endLine = end ? end.line : lines.length - 1
  const endCol = end ? end.col : (lines[lines.length - 1]?.length ?? 0)
  const from = {
    line: clamp(start.line, 0, lines.length - 1),
    col: Math.max(0, start.col),
  }
  if (from.line === endLine) {
    const line = lines[from.line] ?? ''
    const col = Math.min(from.col, line.length)
    const stop = clamp(endCol, col, line.length)
    const text = line.slice(col, stop)
    const next = lines.slice()
    next[from.line] = line.slice(0, col) + line.slice(stop)
    return { lines: next, text, cursor: { line: from.line, col: Math.min(col, next[from.line].length) } }
  }
  const startLine = lines[from.line] ?? ''
  const endLineText = lines[endLine] ?? ''
  const text = [startLine.slice(from.col), ...lines.slice(from.line + 1, endLine), endLineText.slice(0, endCol)].join('\n')
  const merged = startLine.slice(0, from.col) + endLineText.slice(endCol)
  const next = [...lines.slice(0, from.line), merged, ...lines.slice(endLine + 1)]
  return { lines: next, text, cursor: { line: from.line, col: Math.min(from.col, merged.length) } }
}

export function insertText(lines: string[], at: Pos, text: string): { lines: string[]; cursor: Pos } {
  const next = lines.length ? lines.slice() : ['']
  const line = next[at.line] ?? ''
  const col = clamp(at.col, 0, line.length)
  const parts = text.split('\n')
  if (parts.length === 1) {
    next[at.line] = line.slice(0, col) + text + line.slice(col)
    return { lines: next, cursor: { line: at.line, col: col + text.length } }
  }
  const first = line.slice(0, col) + parts[0]
  const last = parts[parts.length - 1] + line.slice(col)
  const middle = parts.slice(1, -1)
  next.splice(at.line, 1, first, ...middle, last)
  return { lines: next, cursor: { line: at.line + parts.length - 1, col: parts[parts.length - 1].length } }
}

export function wordAt(lines: string[], pos: Pos): { word: string; start: number; end: number } | null {
  const line = lines[pos.line] ?? ''
  if (!line) return null
  const col = clamp(pos.col, 0, Math.max(0, line.length - 1))
  const ch = line[col]
  if (!ch || !/[A-Za-z0-9_]/.test(ch)) return null
  let start = col
  let end = col
  while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1])) start--
  while (end + 1 < line.length && /[A-Za-z0-9_]/.test(line[end + 1])) end++
  return { word: line.slice(start, end + 1), start, end }
}

export function escapeReg(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function replaceIdent(text: string, name: string, next: string): string {
  return text.replace(new RegExp(`\\b${escapeReg(name)}\\b`, 'g'), next)
}

export function findMatches(lines: string[], query: string): Pos[] {
  if (!query) return []
  const out: Pos[] = []
  const q = query.toLowerCase()
  lines.forEach((line, lineNo) => {
    const hay = line.toLowerCase()
    let from = 0
    while (from <= hay.length - q.length) {
      const idx = hay.indexOf(q, from)
      if (idx < 0) break
      out.push({ line: lineNo, col: idx })
      from = idx + Math.max(1, q.length)
    }
  })
  return out
}

export function locate(content: string, needle: string): Pos {
  const idx = content.indexOf(needle)
  if (idx < 0) throw new Error(`missing ${needle}`)
  const before = content.slice(0, idx)
  const line = before.split('\n').length - 1
  const col = before.length - (before.lastIndexOf('\n') + 1)
  return { line, col }
}
