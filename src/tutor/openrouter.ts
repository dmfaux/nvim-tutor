export type ChatMessage = { role: 'user' | 'assistant'; content: string }

const SYSTEM = `You are a Neovim tutor sitting beside a student in a practice editor.
You can see the lesson, the buffer, the cursor, and recent keys.
Explain why a motion or command works, or why their attempt missed.
Compare alternatives briefly when asked.
Do not dump a full key sequence that solves the lesson.
Do not claim you edited the buffer.
Keep the answer under 120 words.
Use backticks for keys.`

export async function askTutor(input: {
  apiKey: string
  model: string
  question: string
  history: ChatMessage[]
  context: string
}): Promise<string> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Neovim tutor',
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: input.context },
        ...input.history,
        { role: 'user', content: input.question },
      ],
    }),
  })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(body.slice(0, 280) || `OpenRouter returned ${response.status}`)
  }
  const data = JSON.parse(body) as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content?.trim() || 'No answer came back.'
}
