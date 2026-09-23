import type { EditorState, Mode } from '../editor/types'

export type Goal =
  | { type: 'cursor'; line: number; col: number }
  | { type: 'mode'; mode: Mode }
  | { type: 'buffer'; text: string }
  | { type: 'includes'; text: string }
  | { type: 'excludes'; text: string }
  | { type: 'file'; path: string }
  | { type: 'event'; name: string }
  | { type: 'fileExists'; path: string }
  | { type: 'fileMissing'; path: string }
  | { type: 'all'; of: Goal[] }

export function isComplete(state: EditorState, goal: Goal): boolean {
  switch (goal.type) {
    case 'cursor':
      return state.cursor.line === goal.line && state.cursor.col === goal.col
    case 'mode':
      return state.mode === goal.mode
    case 'buffer':
      return state.lines.join('\n') === goal.text
    case 'includes':
      return state.lines.join('\n').includes(goal.text)
    case 'excludes':
      return !state.lines.join('\n').includes(goal.text)
    case 'file':
      return state.file === goal.path
    case 'event':
      return state.events.includes(goal.name)
    case 'fileExists':
      return state.files.some((file) => file.path === goal.path)
    case 'fileMissing':
      return state.files.every((file) => file.path !== goal.path)
    case 'all':
      return goal.of.every((item) => isComplete(state, item))
  }
}
