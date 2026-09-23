# Neovim tutor

A keyboard-first Neovim tutor that opens into a Neovim-like window. Lessons run in a guided simulator. The help text is a split inside that window. Progress and the OpenRouter key stay in this browser.

## Run

```bash
npm install
npm test
npm run dev
```

Open the URL Vite prints. The window starts on the last lesson you practiced, or the first one. `npm run build` writes a static site to `dist/`.

Practice needs a physical keyboard. Under 900px the help split stacks under the buffer.

## How a lesson works

The right split states the objective. Type in the buffer. When the goal matches, the command line says the lesson is complete and the split offers the next one.

- `]t` and `[t` move between lessons.
- `:Tutor` opens the outline. `j` and `k` move, Enter opens the lesson, Esc returns.
- Nudge (or F2) reveals the next canonical key. The keyboard stays free.
- An unknown key echoes `not in this tutor yet`.

## Lessons

Modes: moving, insert and escape, append, replace and undo.

Motions: words, find a character, counts, search.

Grammar: operator and motion, lines and put, dot-repeat, visual, indent, substitute.

Objects: quotes, parens, inner word, paragraphs.

Power: named registers, macros.

Finding: which-key, Telescope files, live grep, buffers.

Files: oil rename, oil create.

Editing: surround add, change, and delete; flash.

Git: gitsigns hunks.

LSP: hover, definition, references, rename, diagnostics.

Syntax: blink.cmp, function object, argument object.

The project files are `src/main.ts`, `src/util.ts`, and `src/user.ts`. Plugin lessons use the real keymaps (`space ff`, `-`, `ysiw"`, `s`, `]c`, `K`, `gd`, `space rn`, and so on).

## OpenRouter

The bottom of the help split is the stuck tutor. It explains a miss. It does not type into the buffer.

Add a key with **Add key** in that split. The key and model are stored in `localStorage` under `nvim-tutor-v1` and are sent only to `https://openrouter.ai/api/v1/chat/completions` when you ask. The default model is `openai/gpt-4.1-mini`. Lessons work with no key.
