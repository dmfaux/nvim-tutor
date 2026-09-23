import { createState, type EditorState } from '../editor/reduce'
import { EMPTY_FEATURES, type Features } from '../editor/types'
import { lessonIndex, LESSONS } from './catalog'
import { COMPLETION, projectFiles, SYMBOLS } from './project'
import type { Lesson } from './types'

export function featuresFor(index: number): Features {
  const features = { ...EMPTY_FEATURES }
  for (let i = 0; i <= index; i++) Object.assign(features, LESSONS[i]?.enable)
  return features
}

export function stateForLesson(lesson: Lesson, features: Features = featuresFor(lessonIndex(lesson.id))): EditorState {
  const files = lesson.project
    ? projectFiles()
    : [{ path: lesson.file, content: lesson.content ?? '' }]
  return createState({
    files,
    file: lesson.file,
    cursor: lesson.cursor,
    mode: lesson.mode,
    features,
    buffers: lesson.buffers ?? [lesson.file],
    symbols: SYMBOLS,
    completionItems: COMPLETION,
  })
}
