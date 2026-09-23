export function eventToKey(event: KeyboardEvent): string | null {
  if (event.metaKey || event.altKey) return null
  if (event.key === 'F1') return '<F1>'
  if (event.key === 'F2') return '<F2>'
  const named: Record<string, string> = {
    Escape: '<Esc>',
    Enter: '<CR>',
    Backspace: '<BS>',
    ArrowUp: '<Up>',
    ArrowDown: '<Down>',
    ArrowLeft: '<Left>',
    ArrowRight: '<Right>',
    Tab: '<Tab>',
  }
  if (event.ctrlKey) {
    const k = event.key.length === 1 ? event.key.toLowerCase() : ''
    if (k) return `<C-${k}>`
    return null
  }
  if (named[event.key]) return named[event.key]
  if (event.key === ' ') return '<Space>'
  if (event.key.length === 1) return event.key
  return null
}

export function formatKey(key: string): string {
  const named: Record<string, string> = {
    '<Space>': 'Space',
    '<CR>': 'Enter',
    '<Esc>': 'Esc',
    '<BS>': 'BS',
    '<Tab>': 'Tab',
    '<Up>': 'Up',
    '<Down>': 'Down',
    '<Left>': 'Left',
    '<Right>': 'Right',
  }
  if (named[key]) return named[key]
  const ctrl = /^<C-(.)>$/.exec(key)
  if (ctrl) return `Ctrl-${ctrl[1]}`
  return key
}
