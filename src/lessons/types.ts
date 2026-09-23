import type { Features, Mode, Pos } from '../editor/types'
import type { Goal } from './grade'

export type Lesson = {
  id: string
  chapter: string
  title: string
  objective: string
  explanation: string
  keys: string[]
  file: string
  content?: string
  cursor: Pos
  mode?: Mode
  buffers?: string[]
  project: boolean
  enable: Partial<Features>
  goal: Goal
}
