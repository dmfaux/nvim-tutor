export type Pos = { line: number; col: number }

export type Mode = 'normal' | 'insert' | 'visual' | 'visual-line' | 'command' | 'search'

export type Span = {
  start: Pos
  end: Pos
  linewise: boolean
  /** When set, `end` is the first character that is not part of the span. */
  exclusiveEnd?: boolean
}

export type Register = { text: string; linewise: boolean }

export type Hunk = {
  line: number
  kind: 'add' | 'change' | 'delete'
  preview: string
}

export type Diagnostic = {
  line: number
  col: number
  endCol: number
  message: string
  severity: 'error' | 'warn'
}

export type FnRange = {
  name: string
  outer: Span
  inner: Span
}

export type ParamRange = {
  outer: Span
  inner: Span
}

export type SymbolRef = {
  file: string
  line: number
  col: number
  text: string
}

export type SymbolInfo = {
  name: string
  signature: string
  file: string
  line: number
  col: number
  refs: SymbolRef[]
}

export type VFile = {
  path: string
  content: string
  hunks?: Hunk[]
  diagnostics?: Diagnostic[]
  functions?: FnRange[]
  parameters?: ParamRange[]
}

export type Features = {
  leader: boolean
  telescope: boolean
  oil: boolean
  surround: boolean
  flash: boolean
  gitsigns: boolean
  lsp: boolean
  blink: boolean
  treesitter: boolean
}

export type TelescopeMode = 'files' | 'grep' | 'buffers'

export type TelescopeItem = {
  label: string
  path: string
  line?: number
  col?: number
}

export type Float =
  | { type: 'hover'; title: string; body: string }
  | { type: 'diagnostic'; body: string }
  | { type: 'blame'; body: string }
  | { type: 'preview'; title: string; body: string }
  | { type: 'telescope'; mode: TelescopeMode; query: string; items: TelescopeItem[]; selected: number }
  | { type: 'rename'; value: string; original: string }
  | { type: 'references'; items: TelescopeItem[]; selected: number }
  | { type: 'completion'; items: string[]; selected: number; startCol: number }

export type MotionState = {
  motionCount: string
  obj?: 'i' | 'a'
  find?: 'f' | 't' | 'F' | 'T'
  g?: boolean
}

export type Pending =
  | ({ kind: 'op'; op: 'd' | 'c' | 'y' | '>' | '<'; count: number } & MotionState)
  | ({ kind: 'surround-add'; count: number } & MotionState)
  | { kind: 'surround-char'; span: Span }
  | { kind: 'surround-change'; from?: string }
  | { kind: 'surround-del' }
  | { kind: 'g' }
  | { kind: 'register' }
  | { kind: 'replace' }
  | { kind: 'find'; motion: 'f' | 't' | 'F' | 'T'; count: number }
  | { kind: 'bracket'; dir: ']' | '[' }
  | { kind: 'leader'; prefix: string }
  | { kind: 'macro-reg' }
  | { kind: 'macro-play' }
  | { kind: 'flash-char' }
  | { kind: 'flash-label'; hits: { pos: Pos; label: string }[] }

export type Change = { keys: string[]; count: number }

export type FileMemory = {
  file: string
  lines: string[]
  cursor: Pos
}

export type Snap = {
  lines: string[]
  cursor: Pos
  anchor: Pos | null
  file: string
  files: VFile[]
  registers: Record<string, Register>
  oilDir: string | null
  oilOriginal: string[] | null
  previous: FileMemory | null
  buffers: string[]
}

export type EditorState = {
  mode: Mode
  lines: string[]
  cursor: Pos
  anchor: Pos | null
  wantCol: number
  countPrefix: string
  pending: Pending | null
  registerName: string | null
  registers: Record<string, Register>
  undo: Snap[]
  redo: Snap[]
  inChange: boolean
  cmdline: string
  searchQuery: string
  searchOrigin: Pos | null
  lastFind: { motion: 'f' | 't' | 'F' | 'T'; ch: string } | null
  message: string
  float: Float | null
  files: VFile[]
  file: string
  buffers: string[]
  features: Features
  macro: { recording: string | null; playing: boolean; slots: Record<string, string[]> }
  lastChange: Change | null
  chord: string[]
  chordOrigin: string | null
  events: string[]
  nav: 'next' | 'prev' | null
  effect: 'tutor' | null
  oilDir: string | null
  oilOriginal: string[] | null
  previous: FileMemory | null
  replaying: boolean
  symbols: SymbolInfo[]
  completionItems: string[]
}

export const EMPTY_FEATURES: Features = {
  leader: false,
  telescope: false,
  oil: false,
  surround: false,
  flash: false,
  gitsigns: false,
  lsp: false,
  blink: false,
  treesitter: false,
}
