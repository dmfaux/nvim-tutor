const STORAGE = 'nvim-tutor-v1'

export type Saved = {
  lessonId: string
  completed: string[]
  apiKey: string
  model: string
}

const EMPTY: Saved = {
  lessonId: 'move',
  completed: [],
  apiKey: '',
  model: 'openai/gpt-4.1-mini',
}

export function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE)
    if (!raw) return { ...EMPTY }
    const parsed = JSON.parse(raw) as Partial<Saved>
    return {
      lessonId: typeof parsed.lessonId === 'string' ? parsed.lessonId : EMPTY.lessonId,
      completed: Array.isArray(parsed.completed) ? parsed.completed.filter((id) => typeof id === 'string') : [],
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: typeof parsed.model === 'string' && parsed.model ? parsed.model : EMPTY.model,
    }
  } catch {
    return { ...EMPTY }
  }
}

export function saveSaved(saved: Saved) {
  localStorage.setItem(STORAGE, JSON.stringify(saved))
}
