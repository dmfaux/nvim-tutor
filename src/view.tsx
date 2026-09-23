import { useEffect, useRef, type RefObject } from 'react'
import { formatKey } from './editor/keys'
import { modeLabel, showcmd, whichKeyRows, type EditorState } from './editor/reduce'
import { cmp, findMatches } from './editor/text'
import type { Diagnostic, Hunk } from './editor/types'
import { LESSONS } from './lessons/catalog'
import type { Lesson } from './lessons/types'
import type { ChatMessage } from './tutor/openrouter'

export function Frame({
  state,
  view,
  shown,
  nudge,
  done,
  completed,
  tutorIndex,
  settings,
  apiKey,
  model,
  chat,
  draft,
  asking,
  askError,
  focusRef,
  askRef,
  onNudge,
  onNext,
  onPrev,
  onOpenTutor,
  onCloseTutor,
  onPick,
  onOpenSettings,
  onCloseSettings,
  onApiKey,
  onModel,
  onDraft,
  onAsk,
}: {
  state: EditorState
  view: 'edit' | 'tutor'
  shown: Lesson
  nudge: number
  done: boolean
  completed: string[]
  tutorIndex: number
  settings: boolean
  apiKey: string
  model: string
  chat: ChatMessage[]
  draft: string
  asking: boolean
  askError: string
  focusRef: RefObject<HTMLDivElement | null>
  askRef: RefObject<HTMLTextAreaElement | null>
  onNudge: () => void
  onNext: () => void
  onPrev: () => void
  onOpenTutor: () => void
  onCloseTutor: () => void
  onPick: (index: number) => void
  onOpenSettings: () => void
  onCloseSettings: () => void
  onApiKey: (value: string) => void
  onModel: (value: string) => void
  onDraft: (value: string) => void
  onAsk: () => void
}) {
  const number = LESSONS.findIndex((item) => item.id === shown.id) + 1
  const echo = view === 'tutor'
    ? 'j k move   Enter open   Esc return'
    : state.mode === 'command' || state.mode === 'search'
      ? state.cmdline
      : done
        ? 'Lesson complete — ]t for the next lesson'
        : state.message
  return (
    <div className="nvim">
      <div className="tabline">
        <button className={view === 'edit' ? 'tab active' : 'tab'} onClick={onCloseTutor}>
          {state.file}
        </button>
        <button className={view === 'tutor' ? 'tab active' : 'tab'} onClick={onOpenTutor}>
          Tutor
        </button>
      </div>
      <div className="workspace">
        <div className="editor-pane" ref={focusRef} tabIndex={0}>
          <div className="editor">
            {view === 'tutor' ? (
              <Outline tutorIndex={tutorIndex} completed={completed} onPick={onPick} />
            ) : (
              <Buffer state={state} />
            )}
            {view === 'edit' && <Floats state={state} />}
            {settings && (
              <div className="float settings" role="dialog" aria-label="OpenRouter settings">
                <header>OpenRouter</header>
                <p>The key stays in this browser. It is sent only to OpenRouter when you ask the tutor.</p>
                <label>
                  API key
                  <input type="password" value={apiKey} autoComplete="off" onChange={(event) => onApiKey(event.target.value)} />
                </label>
                <label>
                  Model
                  <input value={model} onChange={(event) => onModel(event.target.value)} />
                </label>
                <div className="row">
                  <button onClick={onCloseSettings}>Done</button>
                </div>
              </div>
            )}
          </div>
          <div className={`statusline`}>
            <span className={`mode ${modeClass(state, view)}`}>{view === 'tutor' ? 'TUTOR' : modeLabel(state)}</span>
            <span className="file">{view === 'tutor' ? 'Tutor' : state.file}</span>
            <span className="spacer" />
            <span className="pos">{state.cursor.line + 1}:{state.cursor.col + 1}</span>
          </div>
          <div className="cmdline">
            <span>{echo}</span>
            <span className="showcmd">{view === 'edit' ? showcmd(state) : ''}</span>
          </div>
        </div>
        <aside className="help">
          <div className="winbar">
            <span>{shown.chapter}</span>
            <span>{number} / {LESSONS.length}{completed.includes(shown.id) ? '  ✓' : ''}</span>
          </div>
          <div className="help-body">
            <h2>{shown.title}</h2>
            <p className="objective">{shown.objective}</p>
            <p>{shown.explanation}</p>
            {view === 'edit' && (
              <>
                <div className="keys" aria-label="Canonical keys">
                  {shown.keys.slice(0, nudge).map((key, index) => (
                    <kbd key={`${key}-${index}`}>{formatKey(key)}</kbd>
                  ))}
                  {nudge < shown.keys.length && <span className="rest">{'·'.repeat(Math.min(8, shown.keys.length - nudge))}</span>}
                </div>
                <div className="help-actions">
                  <button onClick={onNudge}>Nudge</button>
                  <button onClick={onPrev}>[t</button>
                  <button onClick={onNext}>{done ? 'Next' : ']t'}</button>
                </div>
                {done && <p className="done-note">Lesson complete.</p>}
              </>
            )}
            {view === 'tutor' && <p>Press Enter to practice this lesson.</p>}
            <p className="keyboard-note">Practice needs a physical keyboard.</p>
          </div>
          <div className="ask">
            <h3>Ask the tutor</h3>
            {!apiKey && (
              <p>
                Add an OpenRouter key to ask why a motion missed. The lessons still work without it.
              </p>
            )}
            {chat.map((message, index) => (
              <p className={`bubble ${message.role}`} key={index}>
                <Rich text={message.content} />
              </p>
            ))}
            {askError && <p className="bubble user">{askError}</p>}
            <textarea
              ref={askRef}
              value={draft}
              placeholder={apiKey ? 'Why did that miss?' : 'Key required'}
              disabled={!apiKey || asking}
              onChange={(event) => onDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  onAsk()
                }
              }}
            />
            <div className="row">
              <button onClick={onOpenSettings}>{apiKey ? 'Key' : 'Add key'}</button>
              <button onClick={onAsk} disabled={!apiKey || asking || !draft.trim()}>
                {asking ? 'Thinking…' : 'Ask'}
              </button>
            </div>
            <p className="foot">]t next · [t previous · :Tutor outline · F2 nudge · F1 ask</p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function modeClass(state: EditorState, view: 'edit' | 'tutor'): string {
  if (view === 'tutor') return 'normal'
  if (state.macro.recording) return 'record'
  if (state.pending?.kind === 'op' || state.pending?.kind === 'surround-add') return 'op'
  if (state.mode === 'visual' || state.mode === 'visual-line') return 'visual'
  return state.mode
}

function Rich({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part, index) =>
    part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : <span key={index}>{part}</span>,
  )
}

function Outline({ tutorIndex, completed, onPick }: { tutorIndex: number; completed: string[]; onPick: (index: number) => void }) {
  const selected = useRef<HTMLDivElement>(null)
  useEffect(() => {
    selected.current?.scrollIntoView({ block: 'nearest' })
  }, [tutorIndex])
  let chapter = ''
  return (
    <div>
      {LESSONS.map((lesson, index) => {
        const header = lesson.chapter !== chapter
        if (header) chapter = lesson.chapter
        const line = (
          <div
            key={lesson.id}
            ref={index === tutorIndex ? selected : undefined}
            className={index === tutorIndex ? 'line current' : 'line'}
            onClick={() => onPick(index)}
          >
            <span className="sign">{completed.includes(lesson.id) ? <span className="mark">✓</span> : ''}</span>
            <span className="num">{index + 1}</span>
            <span className="code">{lesson.title}</span>
          </div>
        )
        return header ? (
          <div key={lesson.chapter}>
            <div className="line">
              <span className="sign" />
              <span className="num" />
              <span className="code dim">{lesson.chapter}</span>
            </div>
            {line}
          </div>
        ) : (
          line
        )
      })}
    </div>
  )
}

function Buffer({ state }: { state: EditorState }) {
  const cursorRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    cursorRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [state.cursor.line, state.cursor.col, state.file, state.mode])
  const query = state.mode === 'search' ? state.cmdline.slice(1) : state.searchQuery
  const hits = new Set<string>()
  if (query) {
    for (const pos of findMatches(state.lines, query)) {
      for (let i = 0; i < query.length; i++) hits.add(`${pos.line}:${pos.col + i}`)
    }
  }
  const flash = new Map<string, string>()
  if (state.pending?.kind === 'flash-label') {
    for (const hit of state.pending.hits) flash.set(`${hit.pos.line}:${hit.pos.col}`, hit.label)
  }
  const file = state.files.find((item) => item.path === state.file)
  return (
    <div>
      {state.lines.map((text, line) => (
        <BufferLine
          key={line}
          line={line}
          text={text}
          state={state}
          hits={hits}
          flash={flash}
          diagnostics={state.features.lsp ? file?.diagnostics ?? [] : []}
          hunks={state.features.gitsigns ? file?.hunks ?? [] : []}
          cursorRef={cursorRef}
        />
      ))}
    </div>
  )
}

function BufferLine({
  line,
  text,
  state,
  hits,
  flash,
  diagnostics,
  hunks,
  cursorRef,
}: {
  line: number
  text: string
  state: EditorState
  hits: Set<string>
  flash: Map<string, string>
  diagnostics: Diagnostic[]
  hunks: Hunk[]
  cursorRef: RefObject<HTMLSpanElement | null>
}) {
  const current = state.cursor.line === line
  const rel = current ? String(line + 1) : String(Math.abs(line - state.cursor.line))
  const hunk = hunks.find((item) => item.line === line)
  const diag = diagnostics.find((item) => item.line === line)
  const sign = diag ? diag.severity : hunk?.kind
  const signText = diag ? (diag.severity === 'error' ? 'E' : 'W') : hunk ? (hunk.kind === 'add' ? '+' : hunk.kind === 'delete' ? '_' : '~') : ''
  const cols = Math.max(text.length, 1)
  return (
    <div className={current ? 'line current' : 'line'}>
      <span className={`sign ${sign ?? ''}`}>{signText}</span>
      <span className="num">{rel}</span>
      <span className="code">
        {Array.from({ length: cols }, (_, col) => {
          const ch = text[col] ?? ' '
          const key = `${line}:${col}`
          const label = flash.get(key)
          const cursor = current && state.cursor.col === col && state.mode !== 'insert'
          const insert = current && state.mode === 'insert' && state.cursor.col === col
          const classes = [
            cursor ? 'cursor' : '',
            insert ? 'cursor insert' : '',
            hits.has(key) ? 'search-hit' : '',
            selected(state, line, col) ? 'selected' : '',
            diag && col >= diag.col && col < diag.endCol ? `diag ${diag.severity}` : '',
            label ? 'flash' : '',
          ].filter(Boolean).join(' ')
          return (
            <span key={col} className={classes} ref={cursor || insert ? cursorRef : undefined}>
              {label ?? (ch === ' ' ? ' ' : ch)}
            </span>
          )
        })}
        {current && state.mode === 'insert' && state.cursor.col >= text.length && text.length > 0 && (
          <span className="cursor insert" ref={cursorRef}> </span>
        )}
      </span>
    </div>
  )
}

function selected(state: EditorState, line: number, col: number): boolean {
  if (state.mode !== 'visual' && state.mode !== 'visual-line') return false
  const anchor = state.anchor ?? state.cursor
  if (state.mode === 'visual-line') {
    return line >= Math.min(anchor.line, state.cursor.line) && line <= Math.max(anchor.line, state.cursor.line)
  }
  const start = cmp(anchor, state.cursor) <= 0 ? anchor : state.cursor
  const end = cmp(anchor, state.cursor) <= 0 ? state.cursor : anchor
  const pos = { line, col }
  return cmp(pos, start) >= 0 && cmp(pos, end) <= 0
}

function Floats({ state }: { state: EditorState }) {
  const rows = whichKeyRows(state)
  const float = state.float
  const top = 28 + state.cursor.line * 22
  return (
    <>
      {rows.length > 0 && (
        <div className="float whichkey">
          <header>{state.pending?.kind === 'leader' && state.pending.prefix ? `space ${state.pending.prefix}` : 'space'}</header>
          {rows.map((row) => (
            <div className="wk-row" key={row.key}>
              <b>{row.key}</b>
              <span>{row.desc}</span>
            </div>
          ))}
        </div>
      )}
      {float?.type === 'telescope' && (
        <div className="float telescope">
          <header>
            <span>{float.mode === 'files' ? 'Files' : float.mode === 'grep' ? 'Live grep' : 'Buffers'}</span>
            <span className="prompt">{float.query}</span>
            <span className="caret" />
          </header>
          <ul>
            {float.items.length === 0 && <li className="dim">No matches</li>}
            {float.items.slice(0, 12).map((item, index) => (
              <li key={`${item.path}-${index}`} className={index === float.selected ? 'on' : ''}>{item.label}</li>
            ))}
          </ul>
        </div>
      )}
      {float?.type === 'references' && (
        <div className="float references">
          <header>References</header>
          <ul>
            {float.items.map((item, index) => (
              <li key={`${item.label}-${index}`} className={index === float.selected ? 'on' : ''}>{item.label}</li>
            ))}
          </ul>
        </div>
      )}
      {float?.type === 'rename' && (
        <div className="float rename">
          <header>Rename {float.original}</header>
          <p className="value">{float.value}<span className="caret" /></p>
          <p>Enter to apply · Esc to cancel · Ctrl-u clears</p>
        </div>
      )}
      {float?.type === 'completion' && (
        <div className="float completion" style={{ top, left: '8ch' }}>
          {float.items.map((item, index) => (
            <div key={item} className={index === float.selected ? 'on' : ''}>{item}</div>
          ))}
        </div>
      )}
      {float?.type === 'hover' && (
        <div className="float hover" style={{ top }}>
          <strong>{float.title}</strong>
          <p>{float.body}</p>
        </div>
      )}
      {(float?.type === 'diagnostic' || float?.type === 'blame' || float?.type === 'preview') && (
        <div className="float note" style={{ top }}>
          <strong>{float.type === 'preview' ? float.title : float.type === 'blame' ? 'Blame' : 'Diagnostic'}</strong>
          <p>{float.body}</p>
        </div>
      )}
    </>
  )
}
