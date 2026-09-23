import { useEffect, useRef, useState } from 'react'
import { eventToKey } from './editor/keys'
import { reduce, type EditorState } from './editor/reduce'
import { lessonById, lessonIndex, LESSONS } from './lessons/catalog'
import { isComplete } from './lessons/grade'
import { stateForLesson } from './lessons/setup'
import type { Lesson } from './lessons/types'
import { loadSaved, saveSaved } from './progress'
import { askTutor, type ChatMessage } from './tutor/openrouter'
import { Frame } from './view'

export function App() {
  const saved = useRef(loadSaved())
  const [lessonId, setLessonId] = useState(saved.current.lessonId)
  const [completed, setCompleted] = useState(saved.current.completed)
  const [apiKey, setApiKey] = useState(saved.current.apiKey)
  const [model, setModel] = useState(saved.current.model)
  const [view, setView] = useState<'edit' | 'tutor'>('edit')
  const [tutorIndex, setTutorIndex] = useState(() => lessonIndex(saved.current.lessonId))
  const [nudge, setNudge] = useState(0)
  const [done, setDone] = useState(false)
  const [settings, setSettings] = useState(false)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState('')
  const lesson = lessonById(lessonId)
  const [editor, setEditor] = useState<EditorState>(() => stateForLesson(lesson))
  const editorRef = useRef(editor)
  const focusRef = useRef<HTMLDivElement>(null)
  const askRef = useRef<HTMLTextAreaElement>(null)
  const recent = useRef<string[]>([])
  const viewRef = useRef(view)
  const tutorRef = useRef(tutorIndex)
  const settingsRef = useRef(settings)
  editorRef.current = editor
  viewRef.current = view
  tutorRef.current = tutorIndex
  settingsRef.current = settings

  useEffect(() => {
    saveSaved({ lessonId, completed, apiKey, model })
  }, [lessonId, completed, apiKey, model])

  useEffect(() => {
    focusRef.current?.focus()
  }, [view, lessonId])

  function load(id: string) {
    const next = lessonById(id)
    const state = stateForLesson(next)
    editorRef.current = state
    setLessonId(next.id)
    setEditor(state)
    setNudge(0)
    setDone(false)
    setChat([])
    setDraft('')
    setAskError('')
    setView('edit')
    recent.current = []
  }

  function move(delta: number) {
    const index = Math.min(LESSONS.length - 1, Math.max(0, lessonIndex(lessonId) + delta))
    load(LESSONS[index].id)
  }

  function onEditorKey(key: string) {
    recent.current = [...recent.current, key].slice(-24)
    const next = reduce(editorRef.current, key)
    if (next.nav) {
      move(next.nav === 'next' ? 1 : -1)
      return
    }
    const cleared = { ...next, nav: null, effect: null }
    editorRef.current = cleared
    setEditor(cleared)
    if (next.effect === 'tutor') {
      setTutorIndex(lessonIndex(lessonId))
      setView('tutor')
      return
    }
    const current = lessonById(lessonId)
    if (isComplete(cleared, current.goal)) {
      setDone(true)
      setCompleted((items) => (items.includes(current.id) ? items : [...items, current.id]))
    }
  }

  function onTutorKey(key: string) {
    if (key === 'j' || key === '<Down>') setTutorIndex((index) => Math.min(LESSONS.length - 1, index + 1))
    else if (key === 'k' || key === '<Up>') setTutorIndex((index) => Math.max(0, index - 1))
    else if (key === '<CR>') load(LESSONS[tutorRef.current].id)
    else if (key === '<Esc>' || key === 'q') setView('edit')
    else if (key === 'G') setTutorIndex(LESSONS.length - 1)
    else if (key === 'g') setTutorIndex(0)
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea')) return
      const key = eventToKey(event)
      if (!key) return
      event.preventDefault()
      if (settingsRef.current && key === '<Esc>') {
        setSettings(false)
        return
      }
      if (key === '<F1>') {
        askRef.current?.focus()
        return
      }
      if (key === '<F2>' && viewRef.current === 'edit') {
        setNudge((count) => count + 1)
        return
      }
      if (viewRef.current === 'tutor') onTutorKey(key)
      else onEditorKey(key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function onAsk() {
    const question = draft.trim()
    if (!question || !apiKey || asking) return
    const current = lessonById(lessonId)
    const snapshot = editorRef.current
    setAsking(true)
    setAskError('')
    setDraft('')
    setChat((items) => [...items, { role: 'user', content: question }])
    try {
      const answer = await askTutor({
        apiKey,
        model,
        question,
        history: chat,
        context: contextFor(current, snapshot, recent.current),
      })
      setChat((items) => [...items, { role: 'assistant', content: answer }])
    } catch (error) {
      setAskError(error instanceof Error ? error.message : 'The tutor could not answer.')
    } finally {
      setAsking(false)
      focusRef.current?.focus()
    }
  }

  const shown: Lesson = view === 'tutor' ? LESSONS[tutorIndex] ?? lesson : lesson
  return (
    <Frame
      state={editor}
      view={view}
      shown={shown}
      nudge={nudge}
      done={done}
      completed={completed}
      tutorIndex={tutorIndex}
      settings={settings}
      apiKey={apiKey}
      model={model}
      chat={chat}
      draft={draft}
      asking={asking}
      askError={askError}
      focusRef={focusRef}
      askRef={askRef}
      onNudge={() => {
        setNudge((count) => count + 1)
        focusRef.current?.focus()
      }}
      onNext={() => move(1)}
      onPrev={() => move(-1)}
      onOpenTutor={() => {
        setTutorIndex(lessonIndex(lessonId))
        setView('tutor')
      }}
      onCloseTutor={() => setView('edit')}
      onPick={(index) => load(LESSONS[index].id)}
      onOpenSettings={() => setSettings(true)}
      onCloseSettings={() => {
        setSettings(false)
        focusRef.current?.focus()
      }}
      onApiKey={setApiKey}
      onModel={setModel}
      onDraft={setDraft}
      onAsk={() => void onAsk()}
    />
  )
}

function contextFor(lesson: Lesson, state: EditorState, keys: string[]): string {
  const buffer = state.lines.map((line, index) => `${String(index + 1).padStart(3, ' ')} ${line}`).join('\n')
  return [
    `Lesson: ${lesson.title}`,
    `Objective: ${lesson.objective}`,
    `Explanation: ${lesson.explanation}`,
    `Mode: ${state.mode}`,
    `File: ${state.file}`,
    `Cursor: line ${state.cursor.line + 1}, column ${state.cursor.col + 1}`,
    `Recent keys: ${keys.join(' ') || '(none)'}`,
    'Buffer:',
    buffer,
  ].join('\n')
}
