import { describe, expect, it } from 'vitest'
import { applyKeys } from '../editor/reduce'
import { isComplete } from './grade'
import { LESSONS } from './catalog'
import { stateForLesson } from './setup'

describe('lesson catalog', () => {
  it('has a unique id for every lesson', () => {
    const ids = LESSONS.map((lesson) => lesson.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(LESSONS.length).toBeGreaterThan(30)
  })

  it.each(LESSONS.map((lesson) => [lesson.id, lesson] as const))('%s is unfinished at the start and solved by its keys', (_id, lesson) => {
    const initial = stateForLesson(lesson)
    expect(isComplete(initial, lesson.goal)).toBe(false)
    const done = applyKeys(initial, lesson.keys)
    expect(isComplete(done, lesson.goal), `${lesson.id} buffer:\n${done.lines.join('\n')}\nevents=${done.events.join(',')}\nfile=${done.file} @${done.cursor.line}:${done.cursor.col} mode=${done.mode} msg=${done.message}`).toBe(true)
  })
})
