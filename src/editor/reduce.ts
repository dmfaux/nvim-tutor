import { leaderRows, lookupLeader, type LeaderAction } from './leader'
import {
  findChar,
  moveBigW,
  parenObject,
  quoteObject,
  replaceSurround,
  surroundPair,
  textObject,
  trimmedLineSpan,
  wordMotion,
  wrapSpan,
} from './objects'
import {
  clamp,
  clampNormal,
  cmp,
  deleteSpan,
  escapeReg,
  findMatches,
  firstNonBlank,
  insertText,
  lastCol,
  linewiseSpan,
  replaceIdent,
  spanFromMove,
  wordAt,
} from './text'
import {
  EMPTY_FEATURES,
  type Change,
  type EditorState,
  type Features,
  type FileMemory,
  type Float,
  type MotionState,
  type Pending,
  type Pos,
  type Register,
  type Snap,
  type Span,
  type SymbolInfo,
  type TelescopeItem,
  type TelescopeMode,
  type VFile,
} from './types'

export type { EditorState }

const EMPTY_MOTION: MotionState = { motionCount: '' }

export function createState(init: {
  files: VFile[]
  file: string
  cursor?: Pos
  mode?: EditorState['mode']
  features?: Features
  buffers?: string[]
  symbols?: SymbolInfo[]
  completionItems?: string[]
}): EditorState {
  const files = structuredClone(init.files)
  const file = files.find((item) => item.path === init.file) ?? files[0]
  const lines = (file?.content ?? '').split('\n')
  const cursor = clampNormal(lines, init.cursor ?? { line: 0, col: 0 })
  const mode = init.mode ?? 'normal'
  let state: EditorState = {
    mode,
    lines,
    cursor: mode === 'insert' ? (init.cursor ?? cursor) : cursor,
    anchor: null,
    wantCol: cursor.col,
    countPrefix: '',
    pending: null,
    registerName: null,
    registers: {},
    undo: [],
    redo: [],
    inChange: false,
    cmdline: '',
    searchQuery: '',
    searchOrigin: null,
    lastFind: null,
    message: '',
    float: null,
    files,
    file: file?.path ?? init.file,
    buffers: init.buffers ?? [file?.path ?? init.file],
    features: init.features ?? { ...EMPTY_FEATURES },
    macro: { recording: null, playing: false, slots: {} },
    lastChange: null,
    chord: [],
    chordOrigin: null,
    events: [],
    nav: null,
    effect: null,
    oilDir: null,
    oilOriginal: null,
    previous: null,
    replaying: false,
    symbols: init.symbols ?? [],
    completionItems: init.completionItems ?? [],
  }
  if (mode === 'insert') state = refreshCompletion(state)
  return state
}

export function applyKeys(state: EditorState, keys: string[]): EditorState {
  return keys.reduce(reduce, state)
}

export function reduce(state: EditorState, key: string): EditorState {
  if (key === '.' && isIdle(state) && !state.replaying) return repeatChange(state)
  const wasIdle = isIdle(state)
  const origin = wasIdle ? contentKey(state) : state.chordOrigin
  let next = reduceInner(state, key)
  next = recordMacro(state, next, key)
  if (state.replaying || next.replaying) return next
  if (key === 'u' || key === '<C-r>') {
    return { ...next, chord: [], chordOrigin: null, inChange: false }
  }
  const chord = wasIdle ? [key] : [...state.chord, key]
  next = { ...next, chord, chordOrigin: origin }
  if (isIdle(next)) {
    if (origin != null && contentKey(next) !== origin) {
      const change: Change = { keys: chord, count: 1 }
      next = { ...next, lastChange: change }
    }
    next = { ...next, chord: [], chordOrigin: null, inChange: false }
  }
  return next
}

function repeatChange(state: EditorState): EditorState {
  if (!state.lastChange) return { ...state, message: 'no change to repeat', countPrefix: '' }
  const times = countValue(state.countPrefix)
  let next: EditorState = { ...state, countPrefix: '', replaying: true, message: '', pending: null }
  for (let i = 0; i < times; i++) {
    for (const key of state.lastChange.keys) next = reduceInner(next, key)
  }
  return { ...next, replaying: false, inChange: false, events: [...next.events, 'dot'], chord: [], chordOrigin: null }
}

function recordMacro(before: EditorState, next: EditorState, key: string): EditorState {
  if (!before.macro.recording || next.macro.recording !== before.macro.recording || before.macro.playing) return next
  const rec = before.macro.recording
  const prev = next.macro.slots[rec] ?? []
  return { ...next, macro: { ...next.macro, slots: { ...next.macro.slots, [rec]: [...prev, key] } } }
}

function reduceInner(state: EditorState, key: string): EditorState {
  if (state.float?.type === 'telescope') return telescopeKey(state, key)
  if (state.float?.type === 'rename') return renameKey(state, key)
  if (state.float?.type === 'references') return referencesKey(state, key)
  if (state.float && key === '<Esc>') return { ...state, float: null, message: '' }
  if (state.float && isNoteFloat(state.float)) state = { ...state, float: null }
  if (state.mode === 'insert') return insertKey(state, key)
  if (state.mode === 'command') return commandKey(state, key)
  if (state.mode === 'search') return searchKey(state, key)
  if (state.mode === 'visual' || state.mode === 'visual-line') return visualKey(state, key)
  return normalKey(state, key)
}

function isNoteFloat(float: Float): boolean {
  return float.type === 'hover' || float.type === 'diagnostic' || float.type === 'blame' || float.type === 'preview'
}

function isIdle(state: EditorState): boolean {
  const modal = state.float?.type === 'telescope' || state.float?.type === 'rename' || state.float?.type === 'references'
  return state.mode === 'normal' && !state.pending && !state.countPrefix && !state.registerName && !modal
}

function contentKey(state: EditorState): string {
  return `${state.file}\0${state.lines.join('\n')}`
}

function countValue(prefix: string): number {
  const n = Number.parseInt(prefix, 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function snapshot(state: EditorState): Snap {
  return {
    lines: state.lines.slice(),
    cursor: { ...state.cursor },
    anchor: state.anchor ? { ...state.anchor } : null,
    file: state.file,
    files: structuredClone(state.files),
    registers: structuredClone(state.registers),
    oilDir: state.oilDir,
    oilOriginal: state.oilOriginal ? [...state.oilOriginal] : null,
    previous: state.previous ? structuredClone(state.previous) : null,
    buffers: [...state.buffers],
  }
}

function applySnap(state: EditorState, snap: Snap): EditorState {
  return {
    ...state,
    lines: snap.lines.slice(),
    cursor: { ...snap.cursor },
    anchor: snap.anchor ? { ...snap.anchor } : null,
    wantCol: snap.cursor.col,
    file: snap.file,
    files: structuredClone(snap.files),
    registers: structuredClone(snap.registers),
    oilDir: snap.oilDir,
    oilOriginal: snap.oilOriginal ? [...snap.oilOriginal] : null,
    previous: snap.previous ? structuredClone(snap.previous) : null,
    buffers: [...snap.buffers],
    mode: 'normal',
    pending: null,
    countPrefix: '',
    registerName: null,
    float: null,
    inChange: false,
  }
}

function withUndo(state: EditorState): EditorState {
  if (state.inChange) return state
  return { ...state, inChange: true, redo: [], undo: [...state.undo, snapshot(state)].slice(-100) }
}

function undo(state: EditorState): EditorState {
  const prev = state.undo.at(-1)
  if (!prev) return { ...state, message: 'already at oldest change', countPrefix: '', pending: null }
  return { ...applySnap(state, prev), undo: state.undo.slice(0, -1), redo: [...state.redo, snapshot(state)], message: '1 change undone' }
}

function redo(state: EditorState): EditorState {
  const next = state.redo.at(-1)
  if (!next) return { ...state, message: 'already at newest change', countPrefix: '', pending: null }
  return { ...applySnap(state, next), redo: state.redo.slice(0, -1), undo: [...state.undo, snapshot(state)], message: '1 change redone' }
}

function say(state: EditorState, message: string): EditorState {
  return { ...state, message, countPrefix: '', pending: null, registerName: null }
}

function currentVFile(state: EditorState): VFile | undefined {
  return state.files.find((file) => file.path === state.file)
}

function putRegister(state: EditorState, name: string | null, reg: Register): EditorState {
  const registers: Record<string, Register> = { ...state.registers, '"': reg }
  const events = [...state.events]
  if (name) {
    registers[name] = reg
    events.push(`reg:${name}`)
  }
  return { ...state, registers, events, registerName: null }
}

function normalKey(state: EditorState, key: string): EditorState {
  const arrow = arrowKey(key)
  if (arrow && !state.pending) key = arrow
  const pending = state.pending

  if (pending?.kind === 'replace') return replaceChar(state, key)
  if (pending?.kind === 'find') return finishFind(state, key, pending.count, pending.motion)
  if (pending?.kind === 'macro-reg') return startMacro(state, key)
  if (pending?.kind === 'macro-play') return playMacro(state, key)
  if (pending?.kind === 'flash-char') return armFlash(state, key)
  if (pending?.kind === 'flash-label') return jumpFlash(state, key)
  if (pending?.kind === 'surround-char') return applySurround(state, key)
  if (pending?.kind === 'surround-change') return surroundChange(state, key)
  if (pending?.kind === 'surround-del') return surroundDelete(state, key)
  if (pending?.kind === 'leader') return leaderKey(state, key)
  if (pending?.kind === 'bracket') return bracketKey(state, key)
  if (pending?.kind === 'register') return { ...state, pending: null, registerName: key, message: '' }
  if (pending?.kind === 'g') return gKey(state, key)
  if (pending?.kind === 'op') return opKey(state, key)
  if (pending?.kind === 'surround-add') return surroundMotion(state, key)

  if (/^[1-9]$/.test(key) || (key === '0' && state.countPrefix)) {
    return { ...state, countPrefix: state.countPrefix + key, message: '' }
  }

  if (key === '<C-r>') return redo(state)
  if (key === 'u') return undo(state)
  if (key === '<Esc>') return { ...state, countPrefix: '', pending: null, registerName: null, message: '' }
  if (key === 'i') return beginInsert(state, 'i')
  if (key === 'a') return beginInsert(state, 'a')
  if (key === 'I') return beginInsert(state, 'I')
  if (key === 'A') return beginInsert(state, 'A')
  if (key === 'o') return openLine(state, true)
  if (key === 'O') return openLine(state, false)
  if (key === 'v') return { ...state, mode: 'visual', anchor: { ...state.cursor }, countPrefix: '', message: '' }
  if (key === 'V') return { ...state, mode: 'visual-line', anchor: { ...state.cursor }, countPrefix: '', message: '' }
  if (key === ':') return { ...state, mode: 'command', cmdline: ':', countPrefix: '', message: '' }
  if (key === '/') return { ...state, mode: 'search', cmdline: '/', searchOrigin: { ...state.cursor }, countPrefix: '', message: '' }
  if (key === 'n') return seek(state, 1)
  if (key === 'N') return seek(state, -1)
  if (key === ';') return repeatFind(state, false)
  if (key === ',') return repeatFind(state, true)
  if (key === 'x' || key === '<Del>') return deleteChars(state, countValue(state.countPrefix), false)
  if (key === 'X') return deleteChars(state, countValue(state.countPrefix), true)
  if (key === 'p') return put(state, false)
  if (key === 'P') return put(state, true)
  if (key === 'J') return joinLines(state)
  if (key === 'r') return { ...state, pending: { kind: 'replace' }, message: '' }
  if (key === '"') return { ...state, pending: { kind: 'register' }, message: '' }
  if (key === 'g') return { ...state, pending: { kind: 'g' }, message: '' }
  if (key === ']') return { ...state, pending: { kind: 'bracket', dir: ']' }, message: '' }
  if (key === '[') return { ...state, pending: { kind: 'bracket', dir: '[' }, message: '' }
  if (key === 'q') {
    if (state.macro.recording) return { ...state, macro: { ...state.macro, recording: null }, message: 'recorded', countPrefix: '' }
    return { ...state, pending: { kind: 'macro-reg' }, message: '' }
  }
  if (key === '@') return { ...state, pending: { kind: 'macro-play' }, message: '' }
  if (key === '<Space>' && state.features.leader) return { ...state, pending: { kind: 'leader', prefix: '' }, countPrefix: '', message: '' }
  if (key === '-' && state.features.oil) return openOil(state)
  if (key === 's' && state.features.flash) return { ...state, pending: { kind: 'flash-char' }, countPrefix: '', message: '' }
  if (key === 'K' && state.features.lsp) return hover(state)
  if (key === 'G') {
    const line = state.countPrefix ? countValue(state.countPrefix) - 1 : state.lines.length - 1
    return moveTo(state, goLine(state, line))
  }
  if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
    return { ...state, pending: { kind: 'find', motion: key, count: countValue(state.countPrefix) }, countPrefix: '', message: '' }
  }
  if (key === 'd' || key === 'c' || key === 'y' || key === '>' || key === '<') {
    return {
      ...state,
      pending: { kind: 'op', op: key, count: countValue(state.countPrefix), ...EMPTY_MOTION },
      countPrefix: '',
      message: '',
    }
  }
  if (key === '<CR>' && state.oilDir != null) return oilEnter(state)

  const moved = plainMotion(state, key, countValue(state.countPrefix))
  if (moved) return moveTo(state, moved)
  return say(state, 'not in this tutor yet')
}

function opKey(state: EditorState, key: string): EditorState {
  const pending = state.pending
  if (pending?.kind !== 'op') return state
  if (key === '<Esc>') return { ...state, pending: null, countPrefix: '', message: '' }
  if (state.features.surround && pending.motionCount === '' && !pending.obj && !pending.find && !pending.g) {
    if (pending.op === 'y' && key === 's') {
      return { ...state, pending: { kind: 'surround-add', count: pending.count, ...EMPTY_MOTION } }
    }
    if (pending.op === 'c' && key === 's') return { ...state, pending: { kind: 'surround-change' } }
    if (pending.op === 'd' && key === 's') return { ...state, pending: { kind: 'surround-del' } }
  }
  if ((key === 'd' || key === 'c' || key === 'y' || key === '>' || key === '<') && key === pending.op && !pending.obj && !pending.find && !pending.g && pending.motionCount === '') {
    const extra = countValue(pending.motionCount)
    const count = pending.count * extra
    const end = Math.min(state.lines.length - 1, state.cursor.line + count - 1)
    const span = linewiseSpan(state.cursor.line, end)
    if (key === 'c') return changeLines(state, span)
    return applyOp(state, key, span)
  }
  return takeMotion(state, pending, key, (span) => {
    if (pending.op === 'c' && span.linewise) return changeLines(state, span)
    return applyOp(state, pending.op, span)
  })
}

function surroundMotion(state: EditorState, key: string): EditorState {
  const pending = state.pending
  if (pending?.kind !== 'surround-add') return state
  if (key === '<Esc>') return { ...state, pending: null, message: '' }
  if (key === 's' && !pending.obj && !pending.find && !pending.g && !pending.motionCount) {
    return { ...state, pending: { kind: 'surround-char', span: trimmedLineSpan(state.lines, state.cursor.line) } }
  }
  return takeMotion(state, pending, key, (span) => ({ ...state, pending: { kind: 'surround-char', span }, message: '' }))
}

function takeMotion(
  state: EditorState,
  pending: MotionState & { count: number },
  key: string,
  done: (span: Span) => EditorState,
): EditorState {
  if (pending.find) {
    const times = pending.count * countValue(pending.motionCount)
    const pos = findChar(state.lines, state.cursor, pending.find, key, times)
    if (!pos || (pos.line === state.cursor.line && pos.col === state.cursor.col)) {
      return say(state, 'not found')
    }
    const span = spanFromMove(state.cursor, pos, true, false)
    const next = done(span)
    return { ...next, lastFind: { motion: pending.find, ch: key } }
  }
  if (pending.g) {
    if (key === 'g') {
      const line = pending.count > 1 || pending.motionCount ? pending.count * countValue(pending.motionCount) - 1 : 0
      return done(goLine(state, line).span)
    }
    if (key === 'e') return done(repeatWord(state, 'ge', pending.count * countValue(pending.motionCount)).span)
    return say(state, 'not in this tutor yet')
  }
  if (pending.obj) {
    const span = objectSpan(state, pending.obj, key)
    if (!span) return say(state, 'no text object')
    let next = done(span)
    if (key === 'f') next = { ...next, events: [...next.events, 'textobject:function'] }
    if (key === 'a') next = { ...next, events: [...next.events, 'textobject:parameter'] }
    return next
  }
  if (/^[1-9]$/.test(key) || (key === '0' && pending.motionCount)) {
    return { ...state, pending: { ...state.pending!, motionCount: pending.motionCount + key } as Pending }
  }
  if (key === 'i' || key === 'a') return { ...state, pending: { ...state.pending!, obj: key } as Pending }
  if (key === 'f' || key === 't' || key === 'F' || key === 'T') {
    return { ...state, pending: { ...state.pending!, find: key } as Pending }
  }
  if (key === 'g') return { ...state, pending: { ...state.pending!, g: true } as Pending }

  const times = pending.count * countValue(pending.motionCount)
  const useKey = state.pending?.kind === 'op' && state.pending.op === 'c' && key === 'w' ? 'e' : key
  const moved = plainMotion(state, useKey, times)
  if (!moved) return say(state, 'not in this tutor yet')
  return done(moved.span)
}

function objectSpan(state: EditorState, which: 'i' | 'a', key: string): Span | null {
  return textObject(state.lines, state.cursor, which, key, currentVFile(state), state.features.treesitter)
}

type MoveInfo = { landing: Pos; span: Span; wantCol: number; lastFind?: EditorState['lastFind'] }

function plainMotion(state: EditorState, key: string, times: number): MoveInfo | null {
  if (key === 'h' || key === 'l' || key === 'j' || key === 'k' || key === 'w' || key === 'W' || key === 'b' || key === 'e' || key === '0' || key === '^' || key === '$' || key === '%' || key === '{' || key === '}') {
    return repeatPlain(state, key, times)
  }
  return null
}

function repeatPlain(state: EditorState, key: string, times: number): MoveInfo | null {
  if (key === 'j' || key === 'k') {
    const delta = key === 'j' ? times : -times
    const line = clamp(state.cursor.line + delta, 0, Math.max(0, state.lines.length - 1))
    const len = state.lines[line]?.length ?? 0
    const col = len === 0 ? 0 : Math.min(state.wantCol, len - 1)
    return { landing: { line, col }, span: linewiseSpan(state.cursor.line, line), wantCol: state.wantCol }
  }
  if (key === '0') {
    const landing = { line: state.cursor.line, col: 0 }
    return { landing, span: spanFromMove(state.cursor, landing, false, false), wantCol: 0 }
  }
  if (key === '^') {
    const landing = { line: state.cursor.line, col: firstNonBlank(state.lines[state.cursor.line] ?? '') }
    return { landing, span: spanFromMove(state.cursor, landing, false, false), wantCol: landing.col }
  }
  if (key === '$') {
    const landing = { line: state.cursor.line, col: lastCol(state.lines[state.cursor.line] ?? '') }
    return { landing, span: spanFromMove(state.cursor, landing, true, false), wantCol: landing.col }
  }
  if (key === '%') {
    const landing = matchBracket(state.lines, state.cursor)
    if (!landing) return { landing: state.cursor, span: spanFromMove(state.cursor, state.cursor, true, false), wantCol: state.cursor.col }
    return { landing, span: spanFromMove(state.cursor, landing, true, false), wantCol: landing.col }
  }
  if (key === '{' || key === '}') {
    const landingLine = paragraphJump(state.lines, state.cursor.line, key === '}' ? 1 : -1)
    const landing = { line: landingLine, col: firstNonBlank(state.lines[landingLine] ?? '') }
    return { landing, span: linewiseSpan(state.cursor.line, landingLine), wantCol: landing.col }
  }
  let cursor = state.cursor
  let wantCol = state.wantCol
  for (let i = 0; i < times; i++) {
    const step = stepOnce(state.lines, cursor, key)
    if (!step) break
    cursor = step
    wantCol = step.col
  }
  const inclusive = key === 'e'
  const span = spanFromMove(state.cursor, cursor, inclusive, false)
  return { landing: cursor, span, wantCol }
}

function stepOnce(lines: string[], cursor: Pos, key: string): Pos | null {
  const line = lines[cursor.line] ?? ''
  if (key === 'h') return cursor.col === 0 ? cursor : { line: cursor.line, col: cursor.col - 1 }
  if (key === 'l') return cursor.col >= line.length - 1 ? cursor : { line: cursor.line, col: cursor.col + 1 }
  if (key === 'w') return wordMotion(lines, cursor, 'w')
  if (key === 'b') return wordMotion(lines, cursor, 'b')
  if (key === 'e') return wordMotion(lines, cursor, 'e')
  if (key === 'W') return moveBigW(lines, cursor)
  return null
}

function repeatWord(state: EditorState, motion: 'ge', times: number): MoveInfo {
  let cursor = state.cursor
  for (let i = 0; i < times; i++) cursor = wordMotion(state.lines, cursor, motion)
  return { landing: cursor, span: spanFromMove(state.cursor, cursor, true, false), wantCol: cursor.col }
}

function goLine(state: EditorState, line: number): MoveInfo {
  const target = clamp(line, 0, Math.max(0, state.lines.length - 1))
  const col = firstNonBlank(state.lines[target] ?? '')
  return { landing: { line: target, col }, span: linewiseSpan(state.cursor.line, target), wantCol: col }
}

function moveTo(state: EditorState, info: MoveInfo): EditorState {
  return {
    ...state,
    cursor: clampNormal(state.lines, info.landing),
    wantCol: info.wantCol,
    countPrefix: '',
    pending: null,
    registerName: null,
    message: '',
    lastFind: info.lastFind ?? state.lastFind,
  }
}

function gKey(state: EditorState, key: string): EditorState {
  if (key === 'g') {
    const line = state.countPrefix ? countValue(state.countPrefix) - 1 : 0
    return moveTo(state, goLine(state, line))
  }
  if (key === 'e') return moveTo(state, repeatWord(state, 'ge', countValue(state.countPrefix)))
  if (key === 'd' && state.features.lsp) return gotoDef(state)
  if (key === 'r' && state.features.lsp) return showRefs(state)
  return say(state, 'not in this tutor yet')
}

function applyOp(state: EditorState, op: 'd' | 'c' | 'y' | '>' | '<', span: Span): EditorState {
  if (op === '>' || op === '<') {
    const lo = Math.min(span.start.line, span.end.line)
    const hi = Math.max(span.start.line, span.end.line)
    const lines = indentLines(state.lines, lo, hi, op === '>' ? 1 : -1)
    const cursor = { line: lo, col: firstNonBlank(lines[lo] ?? '') }
    return finishNormal(withUndo(state), lines, cursor)
  }
  const removed = deleteSpan(state.lines, span)
  if (op === 'y') {
    const next = putRegister(state, state.registerName, { text: removed.text, linewise: span.linewise })
    return { ...next, pending: null, countPrefix: '', message: 'yanked', cursor: state.cursor }
  }
  const base = withUndo(state)
  const yanked = putRegister(base, state.registerName, { text: removed.text, linewise: !!span.linewise })
  if (op === 'd') return finishNormal(yanked, removed.lines, removed.cursor)
  const cursor = {
    line: removed.cursor.line,
    col: Math.min(removed.cursor.col, (removed.lines[removed.cursor.line] ?? '').length),
  }
  return {
    ...yanked,
    lines: removed.lines,
    cursor,
    mode: 'insert',
    pending: null,
    countPrefix: '',
    anchor: null,
    message: '',
    float: null,
  }
}

function changeLines(state: EditorState, span: Span): EditorState {
  const lo = Math.min(span.start.line, span.end.line)
  const hi = Math.min(state.lines.length - 1, Math.max(span.start.line, span.end.line))
  const text = state.lines.slice(lo, hi + 1).join('\n')
  const lines = [...state.lines.slice(0, lo), '', ...state.lines.slice(hi + 1)]
  const base = putRegister(withUndo(state), state.registerName, { text, linewise: true })
  return { ...base, lines, cursor: { line: lo, col: 0 }, mode: 'insert', pending: null, countPrefix: '', anchor: null, message: '', float: null }
}

function finishNormal(state: EditorState, lines: string[], cursor: Pos): EditorState {
  const clamped = clampNormal(lines, cursor)
  return {
    ...state,
    lines,
    cursor: clamped,
    wantCol: clamped.col,
    mode: 'normal',
    pending: null,
    countPrefix: '',
    anchor: null,
    message: '',
    float: state.float?.type === 'completion' ? null : state.float,
  }
}

function deleteChars(state: EditorState, count: number, behind: boolean): EditorState {
  const line = state.lines[state.cursor.line] ?? ''
  if (!line) return { ...state, countPrefix: '', message: '' }
  if (behind && state.cursor.col === 0) return { ...state, countPrefix: '', message: '' }
  const start = behind ? Math.max(0, state.cursor.col - count) : state.cursor.col
  const end = behind ? state.cursor.col - 1 : Math.min(line.length - 1, state.cursor.col + count - 1)
  const span: Span = { start: { line: state.cursor.line, col: start }, end: { line: state.cursor.line, col: end }, linewise: false }
  return applyOp(state, 'd', span)
}

function replaceChar(state: EditorState, key: string): EditorState {
  if (key === '<Esc>') return { ...state, pending: null, message: '' }
  if (key.length !== 1) return say(state, 'not in this tutor yet')
  const line = state.lines[state.cursor.line] ?? ''
  if (!line) return { ...state, pending: null }
  const chars = line.split('')
  const count = Math.max(1, countValue(state.countPrefix))
  for (let i = 0; i < count && state.cursor.col + i < chars.length; i++) chars[state.cursor.col + i] = key
  const lines = state.lines.slice()
  lines[state.cursor.line] = chars.join('')
  return finishNormal(withUndo({ ...state, pending: null }), lines, state.cursor)
}

function beginInsert(state: EditorState, where: 'i' | 'a' | 'I' | 'A'): EditorState {
  const line = state.lines[state.cursor.line] ?? ''
  let col = state.cursor.col
  if (where === 'a') col = line.length === 0 ? 0 : Math.min(line.length, state.cursor.col + 1)
  if (where === 'A') col = line.length
  if (where === 'I') col = firstNonBlank(line)
  return refreshCompletion({ ...state, mode: 'insert', cursor: { line: state.cursor.line, col }, countPrefix: '', pending: null, registerName: null, message: '' })
}

function openLine(state: EditorState, below: boolean): EditorState {
  const at = below ? state.cursor.line + 1 : state.cursor.line
  const lines = [...state.lines.slice(0, at), '', ...state.lines.slice(at)]
  return { ...withUndo(state), lines, cursor: { line: at, col: 0 }, mode: 'insert', countPrefix: '', pending: null, message: '' }
}

function put(state: EditorState, before: boolean): EditorState {
  const reg = state.registers[state.registerName ?? '"']
  if (!reg) return say(state, 'register empty')
  const base = withUndo(state)
  if (reg.linewise) {
    const chunk = reg.text.split('\n')
    const at = before ? state.cursor.line : state.cursor.line + 1
    const lines = [...state.lines.slice(0, at), ...chunk, ...state.lines.slice(at)]
    return finishNormal({ ...base, registerName: null }, lines, { line: at, col: 0 })
  }
  const line = state.lines[state.cursor.line] ?? ''
  const at = line.length === 0 ? 0 : before ? state.cursor.col : Math.min(line.length, state.cursor.col + 1)
  const inserted = insertText(state.lines, { line: state.cursor.line, col: at }, reg.text)
  const cursor = { line: inserted.cursor.line, col: Math.max(0, inserted.cursor.col - 1) }
  return finishNormal({ ...base, registerName: null }, inserted.lines, cursor)
}

function joinLines(state: EditorState): EditorState {
  const count = Math.max(2, state.countPrefix ? countValue(state.countPrefix) : 2)
  const lo = state.cursor.line
  const hi = Math.min(state.lines.length - 1, lo + count - 1)
  if (hi === lo) return { ...state, countPrefix: '', message: '' }
  let acc = (state.lines[lo] ?? '').replace(/\s+$/, '')
  for (let i = lo + 1; i <= hi; i++) acc += ` ${(state.lines[i] ?? '').replace(/^\s+/, '')}`
  const lines = [...state.lines.slice(0, lo), acc, ...state.lines.slice(hi + 1)]
  return finishNormal(withUndo(state), lines, { line: lo, col: Math.max(0, acc.length - 1) })
}

function indentLines(lines: string[], lo: number, hi: number, dir: 1 | -1): string[] {
  const next = lines.slice()
  for (let i = lo; i <= hi && i < next.length; i++) {
    if (dir > 0) next[i] = `  ${next[i] ?? ''}`
    else next[i] = (next[i] ?? '').startsWith('  ') ? (next[i] ?? '').slice(2) : (next[i] ?? '').replace(/^\t/, '')
  }
  return next
}

function finishFind(state: EditorState, key: string, times: number, motion: 'f' | 't' | 'F' | 'T'): EditorState {
  if (key === '<Esc>') return { ...state, pending: null }
  if (key.length !== 1) return say(state, 'not in this tutor yet')
  const pos = findChar(state.lines, state.cursor, motion, key, times)
  if (!pos) return say(state, 'not found')
  return moveTo(
    { ...state, lastFind: { motion, ch: key } },
    { landing: pos, span: spanFromMove(state.cursor, pos, true, false), wantCol: pos.col, lastFind: { motion, ch: key } },
  )
}

function repeatFind(state: EditorState, reverse: boolean): EditorState {
  if (!state.lastFind) return say(state, 'no find')
  const swap = { f: 'F', F: 'f', t: 'T', T: 't' } as const
  const motion = reverse ? swap[state.lastFind.motion] : state.lastFind.motion
  return finishFind(state, state.lastFind.ch, countValue(state.countPrefix), motion)
}

function seek(state: EditorState, dir: 1 | -1): EditorState {
  if (!state.searchQuery) return say(state, 'no previous search')
  const matches = findMatches(state.lines, state.searchQuery)
  if (!matches.length) return say(state, 'not found')
  const hit = dir > 0 ? (matches.find((pos) => cmp(pos, state.cursor) > 0) ?? matches[0]) : ([...matches].reverse().find((pos) => cmp(pos, state.cursor) < 0) ?? matches[matches.length - 1])
  return { ...state, cursor: hit, wantCol: hit.col, countPrefix: '', message: `/${state.searchQuery}` }
}

function visualKey(state: EditorState, key: string): EditorState {
  const arrow = arrowKey(key)
  if (arrow) key = arrow
  if (state.pending?.kind === 'g') {
    if (key === 'g') {
      const line = state.countPrefix ? countValue(state.countPrefix) - 1 : 0
      return { ...moveTo(state, goLine(state, line)), mode: state.mode, anchor: state.anchor }
    }
    return say(state, 'not in this tutor yet')
  }
  if (key === '<Esc>' || (key === 'v' && state.mode === 'visual') || (key === 'V' && state.mode === 'visual-line')) {
    return { ...state, mode: 'normal', anchor: null, countPrefix: '', pending: null, message: '' }
  }
  if (key === 'v') return { ...state, mode: 'visual' }
  if (key === 'V') return { ...state, mode: 'visual-line' }
  if (key === 'd' || key === 'x' || key === 'y' || key === 'c' || key === '>' || key === '<') {
    const span = visualSpan(state)
    const op = key === 'x' ? 'd' : key
    const next = applyOp({ ...state, mode: 'normal', anchor: null }, op, span)
    return next
  }
  if (key === 'i' || key === 'a') return { ...state, pending: { kind: 'op', op: 'y', count: 1, obj: key, motionCount: '' } }
  if (state.pending?.kind === 'op' && state.pending.obj) {
    const span = objectSpan(state, state.pending.obj, key)
    if (!span) return say({ ...state, pending: null }, 'no text object')
    return {
      ...state,
      pending: null,
      anchor: span.linewise ? { line: span.start.line, col: 0 } : span.start,
      cursor: span.linewise ? { line: span.end.line, col: 0 } : span.end,
      mode: span.linewise ? 'visual-line' : state.mode,
    }
  }
  if (/^[1-9]$/.test(key) || (key === '0' && state.countPrefix)) return { ...state, countPrefix: state.countPrefix + key }
  const moved = plainMotion(state, key, countValue(state.countPrefix))
  if (moved) return { ...moveTo(state, moved), mode: state.mode, anchor: state.anchor }
  if (key === 'g') return { ...state, pending: { kind: 'g' } }
  return say(state, 'not in this tutor yet')
}

function visualSpan(state: EditorState): Span {
  const anchor = state.anchor ?? state.cursor
  if (state.mode === 'visual-line') return linewiseSpan(anchor.line, state.cursor.line)
  return spanFromMove(anchor, state.cursor, true, false)
}

function insertKey(state: EditorState, key: string): EditorState {
  if (key === '<Esc>') {
    const col = state.cursor.col > 0 ? state.cursor.col - 1 : 0
    return { ...state, mode: 'normal', cursor: clampNormal(state.lines, { line: state.cursor.line, col }), float: null, message: '' }
  }
  if (state.float?.type === 'completion') {
    if (key === '<C-n>' || key === '<Down>') return nudgeCompletion(state, 1)
    if (key === '<C-p>' || key === '<Up>') return nudgeCompletion(state, -1)
    if (key === '<C-y>' || key === '<CR>') return acceptCompletion(state)
    if (key === '<C-e>') return { ...state, float: null }
  }
  if (key === '<CR>') return refreshCompletion(splitLine(state))
  if (key === '<BS>') return refreshCompletion(backspace(state))
  if (key === '<C-w>') return refreshCompletion(deleteBack(state, true))
  if (key === '<C-u>') return refreshCompletion(deleteBack(state, false))
  if (key === '<Left>' || key === '<Right>' || key === '<Up>' || key === '<Down>') return moveInsert(state, key)
  if (key.length === 1) return refreshCompletion(typeChar(state, key))
  return { ...state, message: 'not in this tutor yet' }
}

function typeChar(state: EditorState, ch: string): EditorState {
  const inserted = insertText(state.lines, state.cursor, ch)
  return { ...withUndo(state), lines: inserted.lines, cursor: inserted.cursor }
}

function splitLine(state: EditorState): EditorState {
  const inserted = insertText(state.lines, state.cursor, '\n')
  return { ...withUndo(state), lines: inserted.lines, cursor: inserted.cursor }
}

function backspace(state: EditorState): EditorState {
  if (state.cursor.col === 0 && state.cursor.line === 0) return state
  if (state.cursor.col === 0) {
    const prev = state.lines[state.cursor.line - 1] ?? ''
    const lines = [...state.lines.slice(0, state.cursor.line - 1), prev + (state.lines[state.cursor.line] ?? ''), ...state.lines.slice(state.cursor.line + 1)]
    return { ...withUndo(state), lines, cursor: { line: state.cursor.line - 1, col: prev.length } }
  }
  const line = state.lines[state.cursor.line] ?? ''
  const lines = state.lines.slice()
  lines[state.cursor.line] = line.slice(0, state.cursor.col - 1) + line.slice(state.cursor.col)
  return { ...withUndo(state), lines, cursor: { line: state.cursor.line, col: state.cursor.col - 1 } }
}

function deleteBack(state: EditorState, word: boolean): EditorState {
  const line = state.lines[state.cursor.line] ?? ''
  const col = state.cursor.col
  if (col === 0) return state
  let start = 0
  if (word) {
    let i = col
    while (i > 0 && /\s/.test(line[i - 1] ?? '')) i--
    while (i > 0 && !/\s/.test(line[i - 1] ?? '')) i--
    start = i
  }
  const lines = state.lines.slice()
  lines[state.cursor.line] = line.slice(0, start) + line.slice(col)
  return { ...withUndo(state), lines, cursor: { line: state.cursor.line, col: start } }
}

function moveInsert(state: EditorState, key: string): EditorState {
  const line = state.lines[state.cursor.line] ?? ''
  if (key === '<Left>') return { ...state, cursor: { line: state.cursor.line, col: Math.max(0, state.cursor.col - 1) }, float: null }
  if (key === '<Right>') return { ...state, cursor: { line: state.cursor.line, col: Math.min(line.length, state.cursor.col + 1) }, float: null }
  if (key === '<Up>' && state.cursor.line > 0) {
    const prev = state.lines[state.cursor.line - 1] ?? ''
    return { ...state, cursor: { line: state.cursor.line - 1, col: Math.min(state.cursor.col, prev.length) }, float: null }
  }
  if (key === '<Down>' && state.cursor.line < state.lines.length - 1) {
    const next = state.lines[state.cursor.line + 1] ?? ''
    return { ...state, cursor: { line: state.cursor.line + 1, col: Math.min(state.cursor.col, next.length) }, float: null }
  }
  return state
}

function refreshCompletion(state: EditorState): EditorState {
  if (!state.features.blink || state.mode !== 'insert') {
    return state.float?.type === 'completion' ? { ...state, float: null } : state
  }
  const line = state.lines[state.cursor.line] ?? ''
  const before = line.slice(0, state.cursor.col)
  const match = /[A-Za-z0-9_]+$/.exec(before)
  if (!match) return state.float?.type === 'completion' ? { ...state, float: null } : state
  const prefix = match[0]
  const items = state.completionItems.filter((item) => item.startsWith(prefix) && item !== prefix)
  if (!items.length) return state.float?.type === 'completion' ? { ...state, float: null } : state
  const selected = state.float?.type === 'completion' ? clamp(state.float.selected, 0, items.length - 1) : 0
  return { ...state, float: { type: 'completion', items, selected, startCol: state.cursor.col - prefix.length } }
}

function nudgeCompletion(state: EditorState, dir: number): EditorState {
  const float = state.float
  if (float?.type !== 'completion') return state
  const selected = (float.selected + dir + float.items.length) % float.items.length
  return { ...state, float: { ...float, selected } }
}

function acceptCompletion(state: EditorState): EditorState {
  const float = state.float
  if (float?.type !== 'completion') return state
  const item = float.items[float.selected] ?? float.items[0]
  if (!item) return { ...state, float: null }
  const line = state.lines[state.cursor.line] ?? ''
  const lines = state.lines.slice()
  lines[state.cursor.line] = line.slice(0, float.startCol) + item + line.slice(state.cursor.col)
  return {
    ...withUndo(state),
    lines,
    cursor: { line: state.cursor.line, col: float.startCol + item.length },
    float: null,
    events: [...state.events, 'complete:accept'],
    message: '',
  }
}

function commandKey(state: EditorState, key: string): EditorState {
  if (key === '<Esc>') return { ...state, mode: 'normal', cmdline: '', message: '' }
  if (key === '<BS>') {
    if (state.cmdline.length <= 1) return { ...state, mode: 'normal', cmdline: '', message: '' }
    return { ...state, cmdline: state.cmdline.slice(0, -1) }
  }
  if (key === '<CR>') return runCommand(state, state.cmdline.slice(1))
  if (key.length === 1) return { ...state, cmdline: state.cmdline + key }
  return state
}

function runCommand(state: EditorState, body: string): EditorState {
  const trimmed = body.trim()
  if (trimmed === 'Tutor' || trimmed === 'tutor') return { ...state, mode: 'normal', cmdline: '', effect: 'tutor', message: '' }
  if (trimmed === 'q') return quit(state)
  if (trimmed === 'w') return writeBuffer({ ...state, mode: 'normal', cmdline: '' })
  const sub = parseSub(trimmed)
  if (sub) return substitute(state, sub)
  return { ...state, mode: 'normal', cmdline: '', message: 'not in this tutor yet' }
}

function parseSub(body: string): { pat: string; rep: string; flags: string; all: boolean } | null {
  const all = body.startsWith('%')
  const source = all ? body.slice(1) : body
  if (!source.startsWith('s/')) return null
  const parts = source.slice(2).split('/')
  if (parts.length < 2) return null
  return { pat: parts[0] ?? '', rep: parts[1] ?? '', flags: parts[2] ?? '', all }
}

function substitute(state: EditorState, sub: { pat: string; rep: string; flags: string; all: boolean }): EditorState {
  if (!sub.pat) return { ...state, mode: 'normal', cmdline: '', message: 'empty pattern' }
  const re = new RegExp(escapeReg(sub.pat), sub.flags.includes('g') ? 'g' : '')
  const lines = state.lines.slice()
  const indexes = sub.all ? lines.map((_, i) => i) : [state.cursor.line]
  let count = 0
  for (const index of indexes) {
    const next = (lines[index] ?? '').replace(re, () => {
      count += 1
      return sub.rep
    })
    lines[index] = next
  }
  if (!count) return { ...state, mode: 'normal', cmdline: '', message: 'pattern not found' }
  return { ...finishNormal(withUndo(state), lines, state.cursor), events: [...state.events, 'cmd:s'], message: `${count} substitution${count === 1 ? '' : 's'}` }
}

function quit(state: EditorState): EditorState {
  if (state.float) return { ...state, float: null, mode: 'normal', cmdline: '', message: '' }
  if (state.oilDir != null && state.previous) {
    return {
      ...state,
      file: state.previous.file,
      lines: state.previous.lines.slice(),
      cursor: { ...state.previous.cursor },
      wantCol: state.previous.cursor.col,
      oilDir: null,
      oilOriginal: null,
      previous: null,
      mode: 'normal',
      cmdline: '',
      message: '',
    }
  }
  return { ...state, mode: 'normal', cmdline: '', message: 'already at the tutor' }
}

function writeBuffer(state: EditorState): EditorState {
  if (state.oilDir != null) return commitOil(state)
  const content = state.lines.join('\n')
  const files = state.files.map((file) => (file.path === state.file ? { ...file, content } : file))
  return { ...state, files, mode: 'normal', cmdline: '', message: 'written', events: [...state.events, 'cmd:w'] }
}

function searchKey(state: EditorState, key: string): EditorState {
  if (key === '<Esc>') {
    return { ...state, mode: 'normal', cmdline: '', cursor: state.searchOrigin ?? state.cursor, searchOrigin: null, message: '' }
  }
  if (key === '<CR>') {
    const query = state.cmdline.slice(1)
    return { ...state, mode: 'normal', cmdline: '', searchQuery: query, searchOrigin: null, message: query ? `/${query}` : '' }
  }
  if (key === '<BS>') {
    const cmdline = state.cmdline.slice(0, -1)
    if (cmdline.length <= 1) return { ...state, mode: 'normal', cmdline: '', cursor: state.searchOrigin ?? state.cursor, searchOrigin: null, message: '' }
    return jumpSearch({ ...state, cmdline }, cmdline.slice(1))
  }
  if (key.length === 1) return jumpSearch({ ...state, cmdline: state.cmdline + key }, state.cmdline.slice(1) + key)
  return state
}

function jumpSearch(state: EditorState, query: string): EditorState {
  const origin = state.searchOrigin ?? state.cursor
  const matches = findMatches(state.lines, query)
  const hit = matches.find((pos) => cmp(pos, origin) > 0) ?? matches[0]
  if (!hit) return { ...state, message: 'not found' }
  return { ...state, cursor: hit, wantCol: hit.col, searchQuery: query, message: '' }
}

function bracketKey(state: EditorState, key: string): EditorState {
  const pending = state.pending
  if (pending?.kind !== 'bracket') return state
  if (key === 't') return { ...state, pending: null, countPrefix: '', nav: pending.dir === ']' ? 'next' : 'prev', message: '' }
  if (key === 'c' && state.features.gitsigns) return jumpHunk(state, pending.dir === ']' ? 1 : -1)
  if (key === 'd' && state.features.lsp) return jumpDiag(state, pending.dir === ']' ? 1 : -1)
  return say(state, 'not in this tutor yet')
}

function leaderKey(state: EditorState, key: string): EditorState {
  const pending = state.pending
  if (pending?.kind !== 'leader') return state
  if (key === '<Esc>') return { ...state, pending: null, message: '' }
  if (key === '<BS>') {
    if (!pending.prefix) return { ...state, pending: null, message: '' }
    return { ...state, pending: { kind: 'leader', prefix: pending.prefix.slice(0, -1) } }
  }
  if (key === '<Space>') key = ' '
  const found = lookupLeader(state.features, pending.prefix, key)
  if (found.type === 'group') return { ...state, pending: { kind: 'leader', prefix: found.prefix }, message: '' }
  if (found.type === 'action') return runLeader(state, found.action)
  return say(state, 'not in this tutor yet')
}

function runLeader(state: EditorState, action: LeaderAction): EditorState {
  if (action === 'files') return openTelescope(state, 'files')
  if (action === 'grep') return openTelescope(state, 'grep')
  if (action === 'buffers') return openTelescope(state, 'buffers')
  if (action === 'stage') return stageHunk(state)
  if (action === 'preview') return previewHunk(state)
  if (action === 'blame') return blame(state)
  return startRename(state)
}

function telescopeKey(state: EditorState, key: string): EditorState {
  const float = state.float
  if (float?.type !== 'telescope') return state
  if (key === '<Esc>') return { ...state, float: null, message: '' }
  if (key === '<CR>') return confirmTelescope(state, float)
  if (key === '<C-n>' || key === '<Down>') return { ...state, float: { ...float, selected: Math.min(float.items.length - 1, float.selected + 1) } }
  if (key === '<C-p>' || key === '<Up>') return { ...state, float: { ...float, selected: Math.max(0, float.selected - 1) } }
  if (key === '<BS>') {
    const query = float.query.slice(0, -1)
    const items = telescopeItems(state, float.mode, query)
    return { ...state, float: { ...float, query, items, selected: 0 } }
  }
  if (key === '<C-u>') {
    const items = telescopeItems(state, float.mode, '')
    return { ...state, float: { ...float, query: '', items, selected: 0 } }
  }
  if (key.length === 1) {
    const query = float.query + key
    const items = telescopeItems(state, float.mode, query)
    return { ...state, float: { ...float, query, items, selected: 0 } }
  }
  return state
}

function openTelescope(state: EditorState, mode: TelescopeMode): EditorState {
  const items = telescopeItems(state, mode, '')
  return {
    ...state,
    pending: null,
    countPrefix: '',
    registerName: null,
    float: { type: 'telescope', mode, query: '', items, selected: 0 },
    events: [...state.events, `telescope:${mode}`],
    message: '',
  }
}

function telescopeItems(state: EditorState, mode: TelescopeMode, query: string): TelescopeItem[] {
  if (mode === 'files') return filterLabel(state.files.map((file) => ({ label: file.path, path: file.path })), query)
  if (mode === 'buffers') return filterLabel(state.buffers.map((path) => ({ label: path, path })), query)
  if (!query) return []
  const q = query.toLowerCase()
  const items: TelescopeItem[] = []
  for (const file of state.files) {
    file.content.split('\n').forEach((line, index) => {
      const at = line.toLowerCase().indexOf(q)
      if (at >= 0) items.push({ label: `${file.path}:${index + 1}: ${line.trim()}`, path: file.path, line: index, col: at })
    })
  }
  return items
}

function filterLabel(items: TelescopeItem[], query: string): TelescopeItem[] {
  if (!query) return items
  const q = query.toLowerCase()
  return items.filter((item) => item.label.toLowerCase().includes(q) || item.path.toLowerCase().includes(q))
}

function confirmTelescope(state: EditorState, float: Extract<Float, { type: 'telescope' }>): EditorState {
  const item = float.items[float.selected]
  if (!item) return { ...state, message: 'no match' }
  const next = openPath(state, item.path, { line: item.line ?? 0, col: item.col ?? 0 })
  return { ...next, events: [...state.events, `telescope:open:${item.path}`], message: item.path }
}

function openPath(state: EditorState, path: string, cursor: Pos): EditorState {
  const files = state.oilDir == null ? syncCurrent(state) : state.files
  const file = files.find((item) => item.path === path)
  if (!file) return { ...state, float: null, pending: null, message: `not found: ${path}` }
  const lines = file.content.split('\n')
  const buffers = state.buffers.includes(path) ? state.buffers : [...state.buffers, path]
  return {
    ...state,
    files,
    file: path,
    lines,
    cursor: clampNormal(lines, cursor),
    wantCol: cursor.col,
    anchor: null,
    mode: 'normal',
    float: null,
    pending: null,
    countPrefix: '',
    oilDir: null,
    oilOriginal: null,
    previous: null,
    buffers,
    message: '',
  }
}

function syncCurrent(state: EditorState): VFile[] {
  const content = state.lines.join('\n')
  return state.files.map((file) => (file.path === state.file ? { ...file, content } : file))
}

function openOil(state: EditorState): EditorState {
  const dir = parentDir(state.file)
  return openOilAt(state, dir, true)
}

function openOilAt(state: EditorState, dir: string, remember = false): EditorState {
  const entries = dirEntries(state.files, dir)
  const lines = ['../', ...entries]
  const previous: FileMemory | null = remember || !state.previous ? { file: state.oilDir != null && state.previous ? state.previous.file : state.file, lines: state.oilDir != null && state.previous ? state.previous.lines : state.lines.slice(), cursor: state.oilDir != null && state.previous ? state.previous.cursor : { ...state.cursor } } : state.previous
  return {
    ...state,
    previous,
    file: dir ? `oil://${dir}` : 'oil://',
    lines,
    cursor: { line: 0, col: 0 },
    wantCol: 0,
    oilDir: dir,
    oilOriginal: lines.slice(),
    pending: null,
    countPrefix: '',
    mode: 'normal',
    anchor: null,
    events: [...state.events, 'oil:open'],
    message: dir ? `oil ${dir}` : 'oil /',
  }
}

function oilEnter(state: EditorState): EditorState {
  const name = (state.lines[state.cursor.line] ?? '').trim()
  if (!name || name === '../') {
    return openOilAt(state, parentDir(state.oilDir ?? ''))
  }
  if (name.endsWith('/')) {
    const next = state.oilDir ? `${state.oilDir}/${name.slice(0, -1)}` : name.slice(0, -1)
    return openOilAt(state, next)
  }
  const path = `${state.oilDir ? `${state.oilDir}/` : ''}${name}`
  return openPath(state, path, { line: 0, col: 0 })
}

function commitOil(state: EditorState): EditorState {
  const dir = state.oilDir ?? ''
  const prefix = dir ? `${dir}/` : ''
  const orig = (state.oilOriginal ?? []).map((line) => line.trim()).filter((line) => line && line !== '../')
  const now = state.lines.map((line) => line.trim()).filter((line) => line && line !== '../')
  let files = state.files.map((file) => ({ ...file }))
  const events = [...state.events]
  if (now.length === orig.length) {
    for (let i = 0; i < orig.length; i++) {
      if (orig[i] === now[i] || orig[i].endsWith('/') || now[i].endsWith('/')) continue
      const from = prefix + orig[i]
      const to = prefix + now[i]
      files = files.map((file) => (file.path === from ? { ...file, path: to } : file))
      events.push('oil:rename', `oil:rename:${from}:${to}`)
    }
  } else {
    const origSet = new Set(orig)
    const nowSet = new Set(now)
    for (const name of now) {
      if (origSet.has(name) || name.endsWith('/')) continue
      const path = prefix + name
      if (!files.some((file) => file.path === path)) {
        files.push({ path, content: '' })
        events.push('oil:create', `oil:create:${path}`)
      }
    }
    for (const name of orig) {
      if (nowSet.has(name) || name.endsWith('/')) continue
      files = files.filter((file) => file.path !== prefix + name)
      events.push('oil:delete')
    }
  }
  return {
    ...withUndo(state),
    files,
    events,
    oilOriginal: state.lines.slice(),
    mode: 'normal',
    cmdline: '',
    message: 'written',
  }
}

function dirEntries(files: VFile[], dir: string): string[] {
  const prefix = dir ? `${dir}/` : ''
  const names = new Set<string>()
  for (const file of files) {
    if (dir) {
      if (!file.path.startsWith(prefix)) continue
      const rest = file.path.slice(prefix.length)
      if (!rest) continue
      const slash = rest.indexOf('/')
      names.add(slash === -1 ? rest : `${rest.slice(0, slash)}/`)
    } else if (file.path.includes('/')) names.add(`${file.path.slice(0, file.path.indexOf('/'))}/`)
    else names.add(file.path)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

function parentDir(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

function applySurround(state: EditorState, key: string): EditorState {
  const pending = state.pending
  if (pending?.kind !== 'surround-char') return state
  if (key === '<Esc>') return { ...state, pending: null }
  if (!surroundPair(key)) return say(state, 'not a surround')
  const lines = wrapSpan(state.lines, pending.span, key)
  if (!lines) return say(state, 'not a surround')
  return { ...finishNormal(withUndo(state), lines, pending.span.start), events: [...state.events, 'surround:add'], message: 'surrounded' }
}

function surroundChange(state: EditorState, key: string): EditorState {
  const pending = state.pending
  if (pending?.kind !== 'surround-change') return state
  if (key === '<Esc>') return { ...state, pending: null }
  if (!pending.from) {
    if (!surroundPair(key)) return say(state, 'not a surround')
    return { ...state, pending: { kind: 'surround-change', from: key } }
  }
  const span = surroundTarget(state, pending.from)
  if (!span) return say(state, 'no surround')
  const lines = replaceSurround(state.lines, span, key)
  if (!lines) return say(state, 'not a surround')
  return { ...finishNormal(withUndo(state), lines, span.start), events: [...state.events, 'surround:change'], message: 'changed surround' }
}

function surroundDelete(state: EditorState, key: string): EditorState {
  if (key === '<Esc>') return { ...state, pending: null }
  const span = surroundTarget(state, key)
  if (!span || span.start.line !== span.end.line) return say(state, 'no surround')
  const line = state.lines[span.start.line] ?? ''
  const lines = state.lines.slice()
  lines[span.start.line] = line.slice(0, span.start.col) + line.slice(span.start.col + 1, span.end.col) + line.slice(span.end.col + 1)
  return { ...finishNormal(withUndo(state), lines, span.start), events: [...state.events, 'surround:delete'], message: 'deleted surround' }
}

function surroundTarget(state: EditorState, ch: string): Span | null {
  if (ch === '"' || ch === "'") return quoteObject(state.lines, state.cursor, ch, true)
  if (ch === '(' || ch === ')' || ch === 'b') return parenObject(state.lines, state.cursor, '(', ')', true)
  if (ch === '{' || ch === '}' || ch === 'B') return parenObject(state.lines, state.cursor, '{', '}', true)
  if (ch === '[' || ch === ']') return parenObject(state.lines, state.cursor, '[', ']', true)
  return null
}

function armFlash(state: EditorState, key: string): EditorState {
  if (key === '<Esc>') return { ...state, pending: null }
  if (key.length !== 1) return say(state, 'not in this tutor yet')
  const hits = flashHits(state.lines, state.cursor, key)
  if (!hits.length) return say(state, 'not found')
  return { ...state, pending: { kind: 'flash-label', hits }, message: '' }
}

function jumpFlash(state: EditorState, key: string): EditorState {
  const pending = state.pending
  if (pending?.kind !== 'flash-label') return state
  if (key === '<Esc>') return { ...state, pending: null }
  const hit = pending.hits.find((item) => item.label === key)
  if (!hit) return say(state, 'not a label')
  return { ...moveTo(state, { landing: hit.pos, span: spanFromMove(state.cursor, hit.pos, true, false), wantCol: hit.pos.col }), events: [...state.events, 'flash:jump'] }
}

function flashHits(lines: string[], cursor: Pos, ch: string): { pos: Pos; label: string }[] {
  const all: Pos[] = []
  lines.forEach((text, line) => {
    for (let col = 0; col < text.length; col++) if (text[col] === ch) all.push({ line, col })
  })
  const ordered = [...all.filter((pos) => cmp(pos, cursor) > 0), ...all.filter((pos) => cmp(pos, cursor) <= 0)]
  const labels = 'asdfghjklqwertyuiopzxcvbnm'
  return ordered.slice(0, labels.length).map((pos, index) => ({ pos, label: labels[index] ?? 'a' }))
}

function jumpHunk(state: EditorState, dir: 1 | -1): EditorState {
  const hunks = [...(currentVFile(state)?.hunks ?? [])].sort((a, b) => a.line - b.line)
  if (!hunks.length) return say(state, 'no hunks')
  const hit = dir > 0 ? (hunks.find((hunk) => hunk.line > state.cursor.line) ?? hunks[0]) : ([...hunks].reverse().find((hunk) => hunk.line < state.cursor.line) ?? hunks[hunks.length - 1])
  return { ...state, cursor: { line: hit.line, col: 0 }, wantCol: 0, pending: null, countPrefix: '', message: 'hunk', events: [...state.events, 'gitsigns:hunk'] }
}

function stageHunk(state: EditorState): EditorState {
  const hunks = currentVFile(state)?.hunks ?? []
  if (!hunks.length) return say(state, 'no hunk')
  const hunk = hunks.find((item) => item.line === state.cursor.line) ?? hunks.find((item) => item.line >= state.cursor.line) ?? hunks[0]
  const files = state.files.map((file) => (file.path === state.file ? { ...file, hunks: (file.hunks ?? []).filter((item) => item.line !== hunk.line) } : file))
  return { ...state, files, pending: null, countPrefix: '', float: null, message: 'staged hunk', events: [...state.events, 'gitsigns:stage'] }
}

function previewHunk(state: EditorState): EditorState {
  const hunks = currentVFile(state)?.hunks ?? []
  const hunk = hunks.find((item) => item.line === state.cursor.line) ?? hunks[0]
  if (!hunk) return say(state, 'no hunk')
  return { ...state, pending: null, float: { type: 'preview', title: 'Hunk', body: hunk.preview }, message: '' }
}

function blame(state: EditorState): EditorState {
  const line = state.lines[state.cursor.line] ?? ''
  return { ...state, pending: null, float: { type: 'blame', body: `You  ${line.trim() || '(empty)'}  ·  just now` }, message: '' }
}

function hover(state: EditorState): EditorState {
  const word = wordAt(state.lines, state.cursor)
  const symbol = word ? state.symbols.find((item) => item.name === word.word) : undefined
  if (!symbol) return say(state, 'no information')
  return { ...state, countPrefix: '', float: { type: 'hover', title: symbol.name, body: symbol.signature }, events: [...state.events, 'lsp:hover'], message: '' }
}

function gotoDef(state: EditorState): EditorState {
  const word = wordAt(state.lines, state.cursor)
  const symbol = word ? state.symbols.find((item) => item.name === word.word) : undefined
  if (!symbol) return say(state, 'no definition')
  const next = openPath(state, symbol.file, { line: symbol.line, col: symbol.col })
  return { ...next, events: [...state.events, 'lsp:definition'], message: symbol.name }
}

function showRefs(state: EditorState): EditorState {
  const word = wordAt(state.lines, state.cursor)
  const symbol = word ? state.symbols.find((item) => item.name === word.word) : undefined
  if (!symbol) return say(state, 'no references')
  const items: TelescopeItem[] = [
    { label: `${symbol.file}:${symbol.line + 1}: definition`, path: symbol.file, line: symbol.line, col: symbol.col },
    ...symbol.refs.map((ref) => ({ label: `${ref.file}:${ref.line + 1}: ${ref.text.trim()}`, path: ref.file, line: ref.line, col: ref.col })),
  ]
  return { ...state, pending: null, countPrefix: '', float: { type: 'references', items, selected: 0 }, events: [...state.events, 'lsp:references'], message: '' }
}

function referencesKey(state: EditorState, key: string): EditorState {
  const float = state.float
  if (float?.type !== 'references') return state
  if (key === '<Esc>') return { ...state, float: null, message: '' }
  if (key === '<C-n>' || key === '<Down>' || key === 'j') return { ...state, float: { ...float, selected: Math.min(float.items.length - 1, float.selected + 1) } }
  if (key === '<C-p>' || key === '<Up>' || key === 'k') return { ...state, float: { ...float, selected: Math.max(0, float.selected - 1) } }
  if (key === '<CR>') {
    const item = float.items[float.selected]
    if (!item) return { ...state, float: null }
    const next = openPath(state, item.path, { line: item.line ?? 0, col: item.col ?? 0 })
    return { ...next, events: [...state.events, 'lsp:ref-jump'], message: item.label }
  }
  return state
}

function startRename(state: EditorState): EditorState {
  const word = wordAt(state.lines, state.cursor)
  if (!word) return say(state, 'no symbol')
  return { ...state, pending: null, countPrefix: '', float: { type: 'rename', value: word.word, original: word.word }, message: '' }
}

function renameKey(state: EditorState, key: string): EditorState {
  const float = state.float
  if (float?.type !== 'rename') return state
  if (key === '<Esc>') return { ...state, float: null, message: '' }
  if (key === '<CR>') return applyRename(state, float.value, float.original)
  if (key === '<BS>') return { ...state, float: { ...float, value: float.value.slice(0, -1) } }
  if (key === '<C-u>' || key === '<C-w>') return { ...state, float: { ...float, value: '' } }
  if (key.length === 1) return { ...state, float: { ...float, value: float.value + key } }
  return state
}

function applyRename(state: EditorState, nextName: string, original: string): EditorState {
  if (!nextName || !/^[A-Za-z0-9_]+$/.test(nextName)) return { ...state, message: 'invalid name' }
  const lines = state.lines.map((line) => replaceIdent(line, original, nextName))
  const files = state.files.map((file) => {
    const content = file.path === state.file ? lines.join('\n') : replaceIdent(file.content, original, nextName)
    return { ...file, content: file.path === state.file ? lines.join('\n') : content }
  })
  return {
    ...finishNormal(withUndo(state), lines, state.cursor),
    files,
    events: [...state.events, 'lsp:rename', `lsp:rename:${nextName}`],
    message: `renamed ${original} → ${nextName}`,
  }
}

function jumpDiag(state: EditorState, dir: 1 | -1): EditorState {
  const diags = [...(currentVFile(state)?.diagnostics ?? [])].sort((a, b) => a.line - b.line)
  if (!diags.length) return say(state, 'no diagnostics')
  const hit = dir > 0 ? (diags.find((item) => item.line > state.cursor.line) ?? diags[0]) : ([...diags].reverse().find((item) => item.line < state.cursor.line) ?? diags[diags.length - 1])
  return {
    ...state,
    cursor: { line: hit.line, col: hit.col },
    wantCol: hit.col,
    pending: null,
    countPrefix: '',
    float: { type: 'diagnostic', body: hit.message },
    events: [...state.events, 'lsp:diagnostic'],
    message: hit.message,
  }
}

function startMacro(state: EditorState, key: string): EditorState {
  if (!/^[a-z]$/.test(key)) return say(state, 'name a register')
  return { ...state, pending: null, macro: { ...state.macro, recording: key, slots: { ...state.macro.slots, [key]: [] } }, message: `recording @${key}` }
}

function playMacro(state: EditorState, key: string): EditorState {
  if (!/^[a-z]$/.test(key)) return say(state, 'name a register')
  const keys = state.macro.slots[key] ?? []
  if (!keys.length) return say(state, `register @${key} is empty`)
  let next: EditorState = { ...state, pending: null, macro: { ...state.macro, playing: true }, message: '' }
  for (const item of keys) next = reduceInner(next, item)
  return { ...next, macro: { ...next.macro, playing: false }, events: [...next.events, 'macro:play'], message: `played @${key}` }
}

function arrowKey(key: string): string | null {
  if (key === '<Up>') return 'k'
  if (key === '<Down>') return 'j'
  if (key === '<Left>') return 'h'
  if (key === '<Right>') return 'l'
  return null
}

function matchBracket(lines: string[], from: Pos): Pos | null {
  const line = lines[from.line] ?? ''
  let col = from.col
  let ch = line[col]
  if (!ch || !'()[]{}'.includes(ch)) {
    const idx = line.slice(col).search(/[()[\]{}]/)
    if (idx < 0) return null
    col += idx
    ch = line[col] ?? ''
  }
  const mate: Record<string, string> = { '(': ')', ')': '(', '{': '}', '}': '{', '[': ']', ']': '[' }
  const forward = '([{'.includes(ch)
  const other = mate[ch]
  let depth = 0
  if (forward) {
    for (let l = from.line; l < lines.length; l++) {
      const text = lines[l] ?? ''
      for (let c = l === from.line ? col : 0; c < text.length; c++) {
        if (text[c] === ch) depth++
        else if (text[c] === other) {
          depth--
          if (depth === 0) return { line: l, col: c }
        }
      }
    }
  } else {
    for (let l = from.line; l >= 0; l--) {
      const text = lines[l] ?? ''
      for (let c = l === from.line ? col : text.length - 1; c >= 0; c--) {
        if (text[c] === ch) depth++
        else if (text[c] === other) {
          depth--
          if (depth === 0) return { line: l, col: c }
        }
      }
    }
  }
  return null
}

function paragraphJump(lines: string[], line: number, dir: 1 | -1): number {
  if (dir > 0) {
    let i = line + 1
    while (i < lines.length && (lines[i] ?? '').trim() !== '') i++
    return clamp(i, 0, Math.max(0, lines.length - 1))
  }
  let i = line - 1
  while (i > 0 && (lines[i] ?? '').trim() !== '') i--
  return clamp(i, 0, Math.max(0, lines.length - 1))
}

export function modeLabel(state: EditorState): string {
  if (state.pending?.kind === 'op') return state.pending.op.toUpperCase()
  if (state.mode === 'visual') return 'VISUAL'
  if (state.mode === 'visual-line') return 'V-LINE'
  if (state.mode === 'insert') return 'INSERT'
  if (state.mode === 'command') return 'COMMAND'
  if (state.mode === 'search') return 'SEARCH'
  if (state.macro.recording) return 'RECORD'
  return 'NORMAL'
}

export function showcmd(state: EditorState): string {
  const count = state.countPrefix
  const pending = state.pending
  if (!pending) return count
  if (pending.kind === 'op') return `${count}${pending.op}${pending.motionCount}${pending.obj ?? ''}${pending.find ?? ''}${pending.g ? 'g' : ''}`
  if (pending.kind === 'leader') return ` ${pending.prefix}`
  if (pending.kind === 'find') return `${pending.motion}`
  if (pending.kind === 'g') return `${count}g`
  if (pending.kind === 'register') return '"'
  if (pending.kind === 'replace') return 'r'
  if (pending.kind === 'bracket') return pending.dir
  if (pending.kind === 'surround-add') return `ys${pending.motionCount}${pending.obj ?? ''}`
  if (pending.kind === 'surround-char') return 'ys'
  if (pending.kind === 'surround-change') return pending.from ? `cs${pending.from}` : 'cs'
  if (pending.kind === 'surround-del') return 'ds'
  if (pending.kind === 'flash-char' || pending.kind === 'flash-label') return 's'
  if (pending.kind === 'macro-reg') return 'q'
  if (pending.kind === 'macro-play') return '@'
  return count
}

export function whichKeyRows(state: EditorState): { key: string; desc: string }[] {
  if (state.pending?.kind !== 'leader') return []
  return leaderRows(state.features, state.pending.prefix)
}
