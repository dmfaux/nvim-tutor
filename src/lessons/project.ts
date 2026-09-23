import type { FnRange, Span, SymbolInfo, VFile } from '../editor/types'
import { locate } from '../editor/text'

export const USER_TS = `export type User = {
  id: string
  name: string
  email: string
}
`

export const UTIL_TS = `import type { User } from "./user"

export function formatName(user: User) {
  return user.name.trim()
}

export function greet(user: User) {
  const message = formatName(user)
  return "Hello, " + message
}
`

export const MAIN_TS = `import { greet } from "./util"
import type { User } from "./user"

const user: User = {
  id: "1",
  name: "Ada",
  email: "ada@example.com",
}

const unused = 1

console.log(greet(user))
`

export const README = `# Notes

A tiny project used by the tutor.
`

function positionAt(content: string, index: number) {
  const before = content.slice(0, index)
  return {
    line: before.split('\n').length - 1,
    col: before.length - (before.lastIndexOf('\n') + 1),
  }
}

export function locateNth(content: string, needle: string, nth: number) {
  let from = 0
  for (let i = 0; i <= nth; i++) {
    const idx = content.indexOf(needle, from)
    if (idx < 0) throw new Error(`missing ${needle} #${nth}`)
    if (i === nth) return positionAt(content, idx)
    from = idx + needle.length
  }
  throw new Error(`missing ${needle}`)
}

function lineSpan(content: string, startNeedle: string, endLineTrim: string): Span {
  const lines = content.split('\n')
  const start = locate(content, startNeedle).line
  let end = start
  while (end < lines.length && (lines[end] ?? '').trim() !== endLineTrim) end++
  return {
    start: { line: start, col: 0 },
    end: { line: end, col: Math.max(0, (lines[end] ?? '').length - 1) },
    linewise: true,
  }
}

function functionRange(content: string, signature: string): FnRange {
  const outer = lineSpan(content, signature, '}')
  const lines = content.split('\n')
  const innerEnd = Math.max(outer.start.line, outer.end.line - 1)
  return {
    name: signature,
    outer,
    inner: {
      start: { line: outer.start.line + 1, col: 0 },
      end: { line: innerEnd, col: Math.max(0, (lines[innerEnd] ?? '').length - 1) },
      linewise: true,
    },
  }
}

function parameterRange(content: string, signature: string) {
  const at = locate(content, signature)
  const line = content.split('\n')[at.line] ?? ''
  const open = line.indexOf('(')
  const close = line.indexOf(')', open)
  return {
    outer: { start: { line: at.line, col: open }, end: { line: at.line, col: close }, linewise: false },
    inner: { start: { line: at.line, col: open + 1 }, end: { line: at.line, col: close - 1 }, linewise: false },
  }
}

const formatFn = functionRange(UTIL_TS, 'export function formatName')
const greetFn = functionRange(UTIL_TS, 'export function greet')
const formatParam = parameterRange(UTIL_TS, 'formatName(user: User)')
const greetParam = parameterRange(UTIL_TS, 'greet(user: User)')

const formatDef = locate(UTIL_TS, 'function formatName')
const greetDef = locate(UTIL_TS, 'function greet')
const formatRef = locateNth(UTIL_TS, 'formatName(', 1)
const greetCall = locate(MAIN_TS, 'greet(user)')
const unused = locate(MAIN_TS, 'const unused')
const hello = locate(UTIL_TS, 'return "Hello')

export const POS = {
  formatDef: { line: formatDef.line, col: formatDef.col + 'function '.length },
  greetDef: { line: greetDef.line, col: greetDef.col + 'function '.length },
  formatRef,
  greetCall,
  unused,
  hello,
  formatBody: locate(UTIL_TS, 'return user.name.trim()'),
  formatParam: { line: formatParam.inner.start.line, col: formatParam.inner.start.col },
}

export const SYMBOLS: SymbolInfo[] = [
  {
    name: 'formatName',
    signature: 'function formatName(user: User): string',
    file: 'src/util.ts',
    line: POS.formatDef.line,
    col: POS.formatDef.col,
    refs: [{ file: 'src/util.ts', line: formatRef.line, col: formatRef.col, text: 'const message = formatName(user)' }],
  },
  {
    name: 'greet',
    signature: 'function greet(user: User): string',
    file: 'src/util.ts',
    line: POS.greetDef.line,
    col: POS.greetDef.col,
    refs: [{ file: 'src/main.ts', line: greetCall.line, col: greetCall.col, text: 'console.log(greet(user))' }],
  },
  {
    name: 'User',
    signature: 'type User = { id: string; name: string; email: string }',
    file: 'src/user.ts',
    line: 0,
    col: 12,
    refs: [
      { file: 'src/main.ts', line: locate(MAIN_TS, 'const user: User').line, col: locate(MAIN_TS, 'User =').col, text: 'const user: User = {' },
    ],
  },
]

export const COMPLETION = ['forEach', 'formatName', 'forward', 'greet', 'User']

export function projectFiles(): VFile[] {
  return [
    { path: 'README.md', content: README },
    {
      path: 'src/user.ts',
      content: USER_TS,
    },
    {
      path: 'src/util.ts',
      content: UTIL_TS,
      functions: [formatFn, greetFn],
      parameters: [formatParam, greetParam],
      hunks: [{ line: hello.line, kind: 'change', preview: '- return "Hi, " + message\n+ return "Hello, " + message' }],
    },
    {
      path: 'src/main.ts',
      content: MAIN_TS,
      diagnostics: [
        {
          line: unused.line,
          col: unused.col,
          endCol: unused.col + 'const unused'.length,
          message: "'unused' is declared but its value is never read.",
          severity: 'warn',
        },
      ],
    },
  ]
}
