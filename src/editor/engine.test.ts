import { describe, expect, it } from 'vitest'
import { applyKeys, createState } from './reduce'
import { EMPTY_FEATURES, type EditorState, type Features } from './types'

function editor(text: string, extra: Partial<Features> = {}, cursor = { line: 0, col: 0 }, mode: EditorState['mode'] = 'normal') {
  return createState({
    files: [{ path: 'scratch.ts', content: text }],
    file: 'scratch.ts',
    cursor,
    mode,
    features: { ...EMPTY_FEATURES, ...extra },
    completionItems: ['forEach', 'formatName', 'forward'],
  })
}

function text(state: EditorState) {
  return state.lines.join('\n')
}

describe('motions and operators', () => {
  it('moves by words and finds characters', () => {
    const state = applyKeys(editor('alpha beta gamma'), ['w'])
    expect(state.cursor).toEqual({ line: 0, col: 6 })
    const found = applyKeys(editor('the quick brown fox'), ['f', 'q'])
    expect(found.cursor).toEqual({ line: 0, col: 4 })
  })

  it('deletes a word and changes one like ce', () => {
    expect(text(applyKeys(editor('one two three'), ['d', 'w']))).toBe('two three')
    const changed = applyKeys(editor('one two three'), ['w', 'c', 'w', 'b', 'o', 't', 'h', '<Esc>'])
    expect(text(changed)).toBe('one both three')
    expect(changed.mode).toBe('normal')
  })

  it('repeats a change with dot', () => {
    const state = applyKeys(editor('foo foo foo'), ['c', 'w', 'b', 'a', 'r', '<Esc>', 'w', '.', 'w', '.'])
    expect(text(state)).toBe('bar bar bar')
    expect(state.events).toContain('dot')
  })

  it('changes inside quotes and parens', () => {
    expect(text(applyKeys(editor('const name = "Ada"'), ['f', 'A', 'c', 'i', '"', 'L', 'y', 'n', 'n', '<Esc>']))).toBe('const name = "Lynn"')
    expect(text(applyKeys(editor('greet(Ada)'), ['f', 'A', 'c', 'i', '(', 'L', 'y', 'n', 'n', '<Esc>']))).toBe('greet(Lynn)')
  })

  it('yanks, puts, and uses a named register', () => {
    expect(text(applyKeys(editor('red\nblue\ngreen'), ['y', 'y', 'p']))).toBe('red\nred\nblue\ngreen')
    const named = applyKeys(editor('alpha\nbeta\ngamma'), ['"', 'a', 'y', 'y', 'j', 'j', '"', 'a', 'p'])
    expect(text(named)).toBe('alpha\nbeta\ngamma\nalpha')
    expect(named.events).toContain('reg:a')
  })

  it('undoes a replacement', () => {
    const replaced = applyKeys(editor('colur'), ['3', 'l', 'r', 'o'])
    expect(text(replaced)).toBe('color')
    expect(text(applyKeys(replaced, ['u']))).toBe('colur')
  })

  it('indents and deletes a visual line', () => {
    expect(text(applyKeys(editor('function greet() {\nconst message = "hi"\n}'), ['j', '>', '>']))).toBe('function greet() {\n  const message = "hi"\n}')
    expect(text(applyKeys(editor('alpha\nbeta\ngamma'), ['j', 'V', 'd']))).toBe('alpha\ngamma')
  })

  it('deletes inner words and paragraphs', () => {
    expect(text(applyKeys(editor('alpha BETA gamma'), ['w', 'd', 'i', 'w']))).toBe('alpha  gamma')
    const para = 'keep me\n\ndrop this\nparagraph\n\ntail'
    expect(text(applyKeys(editor(para), ['}', 'd', 'a', 'p']))).toBe('keep me\n\ntail')
  })

  it('records a macro and substitutes', () => {
    const macro = applyKeys(editor('foo alpha\nfoo beta\nfoo gamma'), ['q', 'a', 'd', 'w', 'j', 'q', '@', 'a', '@', 'a'])
    expect(text(macro)).toBe('alpha\nbeta\ngamma')
    expect(macro.events).toContain('macro:play')
    const sub = applyKeys(editor('foo foo foo'), [':', 's', '/', 'f', 'o', 'o', '/', 'b', 'a', 'r', '/', '<CR>'])
    expect(text(sub)).toBe('bar foo foo')
    expect(sub.events).toContain('cmd:s')
  })

  it('searches forward', () => {
    const state = applyKeys(editor('one target\ntwo\nthree target'), ['/', 't', 'a', 'r', 'g', 'e', 't', '<CR>', 'n'])
    expect(state.cursor).toEqual({ line: 2, col: 6 })
  })
})

describe('plugins', () => {
  const project = [
    { path: 'README.md', content: 'notes' },
    { path: 'src/main.ts', content: 'export const greet = formatName\nconst label = for' },
    { path: 'src/util.ts', content: 'export function formatName(user: User) {\n  return user.name.trim()\n}\n' },
    { path: 'src/user.ts', content: 'export type User = { name: string }\n' },
  ]

  function projectState(features: Partial<Features>, file = 'src/main.ts') {
    return createState({
      files: project,
      file,
      features: { ...EMPTY_FEATURES, leader: true, telescope: true, ...features },
      buffers: ['src/main.ts', 'src/util.ts', 'src/user.ts'],
      symbols: [
        {
          name: 'formatName',
          signature: 'function formatName(user: User): string',
          file: 'src/util.ts',
          line: 0,
          col: 16,
          refs: [{ file: 'src/main.ts', line: 0, col: 22, text: 'export const greet = formatName' }],
        },
      ],
      completionItems: ['forEach', 'formatName', 'forward'],
    })
  }

  it('opens telescope files and grep', () => {
    const opened = applyKeys(projectState({}), ['<Space>', 'f', 'f'])
    expect(opened.events).toContain('telescope:files')
    const picked = applyKeys(opened, ['u', 't', 'i', 'l', '<CR>'])
    expect(picked.file).toBe('src/util.ts')
    expect(picked.events).toContain('telescope:open:src/util.ts')
    const grep = applyKeys(projectState({}), ['<Space>', 'f', 'g', 'f', 'o', 'r', 'm', 'a', 't', 'N', 'a', 'm', 'e', '<CR>'])
    expect(grep.events).toContain('telescope:grep')
    expect(grep.file).toBe('src/main.ts')
  })

  it('renames through oil and creates a file', () => {
    const renamed = applyKeys(projectState({ oil: true }), ['-', 'j', 'j', 'c', 'c', 'p', 'e', 'r', 's', 'o', 'n', '.', 't', 's', '<Esc>', ':', 'w', '<CR>'])
    expect(renamed.files.some((file) => file.path === 'src/person.ts')).toBe(true)
    expect(renamed.files.some((file) => file.path === 'src/user.ts')).toBe(false)
    const created = applyKeys(projectState({ oil: true }), ['-', 'o', 'n', 'o', 't', 'e', 's', '.', 't', 's', '<Esc>', ':', 'w', '<CR>'])
    expect(created.files.some((file) => file.path === 'src/notes.ts')).toBe(true)
  })

  it('surrounds, flashes, and stages a hunk', () => {
    const added = applyKeys(editor('const name = Ada', { surround: true }), ['f', 'A', 'y', 's', 'i', 'w', '"'])
    expect(text(added)).toBe('const name = "Ada"')
    expect(added.events).toContain('surround:add')
    const changed = applyKeys(added, ['c', 's', '"', "'"])
    expect(text(changed)).toBe("const name = 'Ada'")
    const deleted = applyKeys(changed, ['d', 's', "'"])
    expect(text(deleted)).toBe('const name = Ada')

    const flashed = applyKeys(editor('alpha beta TARGET gamma', { flash: true }), ['s', 'T', 'a'])
    expect(text(flashed).charAt(flashed.cursor.col)).toBe('T')

    const git = createState({
      files: [{ path: 'src/util.ts', content: 'one\ntwo\nthree', hunks: [{ line: 2, kind: 'change', preview: '+ three' }] }],
      file: 'src/util.ts',
      features: { ...EMPTY_FEATURES, leader: true, gitsigns: true },
    })
    const staged = applyKeys(git, [']', 'c', '<Space>', 'h', 's'])
    expect(staged.cursor.line).toBe(2)
    expect(staged.events).toContain('gitsigns:stage')
    expect(staged.files[0]?.hunks).toEqual([])
  })

  it('hovers, jumps, renames, and completes', () => {
    const lsp = projectState({ lsp: true })
    const hovered = applyKeys(lsp, ['f', 'f', 'K'])
    expect(hovered.events).toContain('lsp:hover')
    const defined = applyKeys(lsp, ['f', 'f', 'g', 'd'])
    expect(defined.file).toBe('src/util.ts')
    expect(defined.cursor.line).toBe(0)

    const renamed = applyKeys(
      createState({
        files: project,
        file: 'src/util.ts',
        cursor: { line: 0, col: 16 },
        features: { ...EMPTY_FEATURES, leader: true, lsp: true },
        symbols: projectState({}).symbols,
      }),
      ['<Space>', 'r', 'n', '<C-u>', 'w', 'e', 'l', 'c', 'o', 'm', 'e', '<CR>'],
    )
    expect(text(renamed)).toContain('function welcome')
    expect(renamed.events).toContain('lsp:rename')

    const done = applyKeys(
      createState({
        files: [{ path: 'scratch.ts', content: 'const label = for' }],
        file: 'scratch.ts',
        mode: 'insert',
        cursor: { line: 0, col: 'const label = for'.length },
        features: { ...EMPTY_FEATURES, blink: true },
        completionItems: ['forEach', 'formatName', 'forward'],
      }),
      ['<C-n>', '<C-y>'],
    )
    expect(text(done)).toBe('const label = formatName')
    expect(done.events).toContain('complete:accept')
  })
})
