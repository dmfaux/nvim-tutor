import type { Pos, Span, VFile } from './types'
import { charAt, clamp, firstNonBlank, isSpace, lastCol, linewiseSpan, nextPos, prevPos, wordKind } from './text'

export function innerWord(lines: string[], cursor: Pos, outer: boolean): Span | null {
  const lineNo = cursor.line
  const line = lines[lineNo] ?? ''
  if (!line) return null
  const col = clamp(cursor.col, 0, line.length - 1)
  const kind = wordKind(line[col] ?? ' ')
  let start = col
  let end = col
  while (start > 0 && wordKind(line[start - 1] ?? ' ') === kind) start--
  while (end + 1 < line.length && wordKind(line[end + 1] ?? ' ') === kind) end++
  if (outer && kind !== 'space') {
    if (end + 1 < line.length && isSpace(line[end + 1] ?? '')) {
      while (end + 1 < line.length && isSpace(line[end + 1] ?? '')) end++
    } else {
      while (start > 0 && isSpace(line[start - 1] ?? '')) start--
    }
  }
  return { start: { line: lineNo, col: start }, end: { line: lineNo, col: end }, linewise: false }
}

export function quoteObject(lines: string[], cursor: Pos, quote: string, outer: boolean): Span | null {
  const line = lines[cursor.line] ?? ''
  const indexes: number[] = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] === quote && line[i - 1] !== '\\') indexes.push(i)
  }
  for (let i = 0; i + 1 < indexes.length; i += 2) {
    const a = indexes[i]
    const b = indexes[i + 1]
    if (cursor.col >= a && cursor.col <= b) {
      if (outer || b <= a + 1) {
        return { start: { line: cursor.line, col: a }, end: { line: cursor.line, col: b }, linewise: false }
      }
      return {
        start: { line: cursor.line, col: a + 1 },
        end: { line: cursor.line, col: b - 1 },
        linewise: false,
      }
    }
  }
  return null
}

type Pair = { open: Pos; close: Pos }

function pairs(lines: string[], openCh: string, closeCh: string): Pair[] {
  const found: Pair[] = []
  const stack: Pos[] = []
  let inStr: string | null = null
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line] ?? ''
    for (let col = 0; col < text.length; col++) {
      const ch = text[col]
      const prev = text[col - 1]
      if (inStr) {
        if (ch === inStr && prev !== '\\') inStr = null
        continue
      }
      if (ch === '"' || ch === "'") {
        inStr = ch
        continue
      }
      if (ch === openCh) stack.push({ line, col })
      else if (ch === closeCh && stack.length) {
        const open = stack.pop()!
        found.push({ open, close: { line, col } })
      }
    }
  }
  return found
}

function contains(pair: Pair, cursor: Pos): boolean {
  if (cursor.line < pair.open.line || cursor.line > pair.close.line) return false
  if (cursor.line === pair.open.line && cursor.col < pair.open.col) return false
  if (cursor.line === pair.close.line && cursor.col > pair.close.col) return false
  return true
}

export function parenObject(lines: string[], cursor: Pos, openCh: string, closeCh: string, outer: boolean): Span | null {
  const match = pairs(lines, openCh, closeCh)
    .filter((pair) => contains(pair, cursor))
    .sort((a, b) => a.open.line - b.open.line || a.open.col - b.open.col)
    .at(-1)
  if (!match) return null
  if (outer) return { start: match.open, end: match.close, linewise: false }
  const start = nextAfter(lines, match.open)
  const end = prevBefore(lines, match.close)
  if (!start || !end || (start.line === end.line && start.col > end.col) || start.line > end.line) {
    return { start: match.open, end: match.open, linewise: false }
  }
  return { start, end, linewise: false }
}

function nextAfter(lines: string[], pos: Pos): Pos | null {
  const line = lines[pos.line] ?? ''
  if (pos.col + 1 < line.length) return { line: pos.line, col: pos.col + 1 }
  if (pos.line + 1 < lines.length) return { line: pos.line + 1, col: 0 }
  return null
}

function prevBefore(lines: string[], pos: Pos): Pos | null {
  if (pos.col > 0) return { line: pos.line, col: pos.col - 1 }
  if (pos.line === 0) return null
  const prev = lines[pos.line - 1] ?? ''
  return { line: pos.line - 1, col: Math.max(0, prev.length - 1) }
}

export function paragraphObject(lines: string[], cursor: Pos, outer: boolean): Span | null {
  if (lines.length === 0) return null
  let line = cursor.line
  if ((lines[line] ?? '').trim() === '') {
    let down = line
    while (down < lines.length && (lines[down] ?? '').trim() === '') down++
    if (down < lines.length) line = down
    else {
      let up = line
      while (up >= 0 && (lines[up] ?? '').trim() === '') up--
      if (up < 0) return null
      line = up
    }
  }
  let a = line
  let b = line
  while (a > 0 && (lines[a - 1] ?? '').trim() !== '') a--
  while (b + 1 < lines.length && (lines[b + 1] ?? '').trim() !== '') b++
  if (outer) {
    if (b + 1 < lines.length && (lines[b + 1] ?? '').trim() === '') b++
    else if (a > 0 && (lines[a - 1] ?? '').trim() === '') a--
  }
  return linewiseSpan(a, b)
}

export function functionObject(file: VFile | undefined, cursor: Pos, outer: boolean): Span | null {
  const fns = file?.functions ?? []
  const hit = fns
    .filter((fn) => posInSpan(cursor, outer ? fn.outer : fn.outer))
    .sort((a, b) => spanSize(a.outer) - spanSize(b.outer))[0]
  if (!hit) return null
  return outer ? hit.outer : hit.inner
}

export function parameterObject(file: VFile | undefined, cursor: Pos, outer: boolean): Span | null {
  const params = file?.parameters ?? []
  const hit = params
    .filter((param) => posInSpan(cursor, param.outer))
    .sort((a, b) => spanSize(a.outer) - spanSize(b.outer))[0]
  if (!hit) return null
  return outer ? hit.outer : hit.inner
}

function posInSpan(pos: Pos, span: Span): boolean {
  if (span.linewise) return pos.line >= span.start.line && pos.line <= span.end.line
  if (pos.line < span.start.line || pos.line > span.end.line) return false
  if (pos.line === span.start.line && pos.col < span.start.col) return false
  if (pos.line === span.end.line && pos.col > span.end.col) return false
  return true
}

function spanSize(span: Span): number {
  return (span.end.line - span.start.line) * 1000 + (span.end.col - span.start.col)
}

export function trimmedLineSpan(lines: string[], lineNo: number): Span {
  const line = lines[lineNo] ?? ''
  const start = firstNonBlank(line)
  const last = Math.max(start, (line.replace(/\s+$/, '').length || 1) - 1)
  return { start: { line: lineNo, col: start }, end: { line: lineNo, col: last }, linewise: false }
}

export function textObject(
  lines: string[],
  cursor: Pos,
  which: 'i' | 'a',
  key: string,
  file: VFile | undefined,
  treesitter: boolean,
): Span | null {
  const outer = which === 'a'
  if (key === 'w' || key === 'W') return innerWord(lines, cursor, outer)
  if (key === '"' || key === "'") return quoteObject(lines, cursor, key, outer)
  if (key === '(' || key === ')' || key === 'b') return parenObject(lines, cursor, '(', ')', outer)
  if (key === '{' || key === '}' || key === 'B') return parenObject(lines, cursor, '{', '}', outer)
  if (key === '[' || key === ']') return parenObject(lines, cursor, '[', ']', outer)
  if (key === 'p') return paragraphObject(lines, cursor, outer)
  if (key === 'f' && treesitter) return functionObject(file, cursor, outer)
  if (key === 'a' && treesitter) return parameterObject(file, cursor, outer)
  return null
}

export function surroundPair(ch: string): [string, string] | null {
  const pairs: Record<string, [string, string]> = {
    '"': ['"', '"'],
    "'": ["'", "'"],
    '`': ['`', '`'],
    '(': ['(', ')'],
    ')': ['(', ')'],
    '{': ['{', '}'],
    '}': ['{', '}'],
    '[': ['[', ']'],
    ']': ['[', ']'],
    '<': ['<', '>'],
    '>': ['<', '>'],
  }
  return pairs[ch] ?? null
}

export function wrapSpan(lines: string[], span: Span, ch: string): string[] | null {
  const pair = surroundPair(ch)
  if (!pair) return null
  const [open, close] = pair
  if (span.linewise) {
    const next = lines.slice()
    const a = span.start.line
    const b = span.end.line
    next[a] = open + (next[a] ?? '')
    next[b] = (next[b] ?? '') + close
    return next
  }
  const a = span.start
  const b = span.end
  if (a.line === b.line) {
    const line = lines[a.line] ?? ''
    const next = lines.slice()
    next[a.line] = line.slice(0, a.col) + open + line.slice(a.col, b.col + 1) + close + line.slice(b.col + 1)
    return next
  }
  const next = lines.slice()
  next[a.line] = (next[a.line] ?? '').slice(0, a.col) + open + (next[a.line] ?? '').slice(a.col)
  const endCol = b.col + 1
  next[b.line] = (next[b.line] ?? '').slice(0, endCol) + close + (next[b.line] ?? '').slice(endCol)
  return next
}

export function replaceSurround(lines: string[], span: Span, ch: string): string[] | null {
  const pair = surroundPair(ch)
  if (!pair || span.linewise) return null
  const [open, close] = pair
  if (span.start.line !== span.end.line) return null
  const line = lines[span.start.line] ?? ''
  const next = lines.slice()
  next[span.start.line] =
    line.slice(0, span.start.col) + open + line.slice(span.start.col + 1, span.end.col) + close + line.slice(span.end.col + 1)
  return next
}

export function findChar(
  lines: string[],
  from: Pos,
  motion: 'f' | 't' | 'F' | 'T',
  ch: string,
  times: number,
): Pos | null {
  let pos = from
  for (let n = 0; n < times; n++) {
    const hit = findCharOnce(lines, pos, motion, ch, n > 0)
    if (!hit) return n === 0 ? null : pos
    pos = hit
  }
  return pos
}

function findCharOnce(
  lines: string[],
  from: Pos,
  motion: 'f' | 't' | 'F' | 'T',
  ch: string,
  skipCurrent: boolean,
): Pos | null {
  const line = lines[from.line] ?? ''
  const forward = motion === 'f' || motion === 't'
  const till = motion === 't' || motion === 'T'
  if (forward) {
    let i = from.col + 1
    if (!skipCurrent && motion === 'f') i = from.col + 1
    for (; i < line.length; i++) {
      if (line[i] === ch) return { line: from.line, col: till ? i - 1 : i }
    }
  } else {
    for (let i = from.col - 1; i >= 0; i--) {
      if (line[i] === ch) return { line: from.line, col: till ? i + 1 : i }
    }
  }
  return null
}

export function moveBigW(lines: string[], from: Pos): Pos {
  const ch = charAt(lines, from)
  if (ch === undefined) return from
  let pos: Pos | null = from
  if (!isSpace(ch)) pos = skip(lines, nextPos(lines, from), (c) => !isSpace(c))
  if (!pos) return endOfBuffer(lines)
  if (isSpace(charAt(lines, pos) ?? '')) pos = skip(lines, pos, isSpace)
  return pos ?? endOfBuffer(lines)
}

export function wordMotion(lines: string[], from: Pos, motion: 'w' | 'b' | 'e' | 'ge'): Pos {
  if (motion === 'w') return moveW(lines, from)
  if (motion === 'b') return moveB(lines, from)
  if (motion === 'e') return moveE(lines, from)
  return moveGe(lines, from)
}

function moveW(lines: string[], from: Pos): Pos {
  const ch = charAt(lines, from)
  if (ch === undefined) return from
  let pos: Pos | null = from
  if (!isSpace(ch)) {
    const kind = wordKind(ch)
    pos = skip(lines, nextPos(lines, from), (c) => wordKind(c) === kind)
  }
  if (!pos) return endOfBuffer(lines)
  if (isSpace(charAt(lines, pos) ?? '')) pos = skip(lines, pos, isSpace)
  return pos ?? endOfBuffer(lines)
}

function moveE(lines: string[], from: Pos): Pos {
  let pos = nextPos(lines, from)
  if (!pos) return from
  if (isSpace(charAt(lines, pos) ?? '')) {
    const skipped = skip(lines, pos, isSpace)
    if (!skipped) return endOfBuffer(lines)
    pos = skipped
  }
  const kind = wordKind(charAt(lines, pos) ?? ' ')
  const past = skip(lines, nextPos(lines, pos), (c) => wordKind(c) === kind)
  if (!past) return endOfBuffer(lines)
  return prevPos(lines, past) ?? pos
}

function moveB(lines: string[], from: Pos): Pos {
  let pos = prevPos(lines, from)
  if (!pos) return from
  while (pos && isSpace(charAt(lines, pos) ?? '')) {
    const back = prevPos(lines, pos)
    if (!back) return { line: 0, col: 0 }
    pos = back
    if (!isSpace(charAt(lines, pos) ?? '')) break
  }
  if (!pos) return { line: 0, col: 0 }
  if (isSpace(charAt(lines, pos) ?? '')) return nextPos(lines, pos) ?? pos
  const kind = wordKind(charAt(lines, pos) ?? ' ')
  while (true) {
    const back = prevPos(lines, pos)
    if (!back) return pos
    if (isSpace(charAt(lines, back) ?? ' ') || wordKind(charAt(lines, back) ?? ' ') !== kind) return pos
    pos = back
  }
}

function moveGe(lines: string[], from: Pos): Pos {
  const startCh = charAt(lines, from)
  let pos = prevPos(lines, from)
  if (!pos) return from
  if (startCh && !isSpace(startCh)) {
    const kind = wordKind(startCh)
    if (wordKind(charAt(lines, pos) ?? ' ') === kind) {
      while (true) {
        const back = prevPos(lines, pos)
        if (!back || wordKind(charAt(lines, back) ?? ' ') !== kind) break
        pos = back
      }
      const before = prevPos(lines, pos)
      if (!before) return from
      pos = before
    }
  }
  while (isSpace(charAt(lines, pos) ?? '')) {
    const back = prevPos(lines, pos)
    if (!back) return from
    pos = back
  }
  return pos
}

function skip(lines: string[], start: Pos | null, pred: (ch: string) => boolean): Pos | null {
  let pos = start
  if (!pos) return null
  if (!pred(charAt(lines, pos) ?? '')) return pos
  while (pos && pred(charAt(lines, pos) ?? '')) {
    const n = nextPos(lines, pos)
    if (!n) return null
    if (!pred(charAt(lines, n) ?? '')) return n
    pos = n
  }
  return pos
}

function endOfBuffer(lines: string[]): Pos {
  const line = Math.max(0, lines.length - 1)
  return { line, col: lastCol(lines[line] ?? '') }
}
