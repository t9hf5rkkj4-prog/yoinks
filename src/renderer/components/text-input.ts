/**
 * Readline-style behavior for a native <input>, replacing text-input.tsx.
 *
 * The browser input already handles cursor movement, word jumps (⌥←/→, or
 * ^←/→ on Windows/Linux), ⌥⌫ word delete, shift-selection, home/end and
 * horizontal scrolling. This adds what it lacks: ^a/^e, ^u/^k/^w, ⌥b/⌥f,
 * ↑/↓ history recall, the ⇥ hook, control-char stripping and paste-to-submit.
 */
type Options = {
  input: HTMLInputElement
  /** newest-first entries recalled with ↑/↓ */
  history: () => string[]
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  /** when a paste into an empty field satisfies this, submit immediately */
  submitOnPaste?: (value: string) => boolean
  /** tab pressed — accept a suggestion, etc. */
  onTab?: () => void
}

export type TextInput = {setValue(value: string): void}

const wordLeft = (text: string, from: number) => {
  let i = from
  while (i > 0 && !/\w/.test(text[i - 1]!)) i--
  while (i > 0 && /\w/.test(text[i - 1]!)) i--
  return i
}

const wordRight = (text: string, from: number) => {
  let i = from
  while (i < text.length && !/\w/.test(text[i]!)) i++
  while (i < text.length && /\w/.test(text[i]!)) i++
  return i
}

export function attachTextInput({input, history, onChange, onSubmit, submitOnPaste, onTab}: Options): TextInput {
  let historyPos: number | null = null
  let draft = ''

  const place = (position: number) => {
    const p = Math.max(0, Math.min(input.value.length, position))
    input.setSelectionRange(p, p)
  }
  const setText = (text: string, position: number) => {
    input.value = text
    place(position)
  }
  const edit = (next: string, position: number) => {
    setText(next, position)
    historyPos = null // editing a recalled entry turns it into a fresh draft
    onChange(next)
  }
  const recall = (text: string) => {
    setText(text, text.length)
    onChange(text)
  }
  const removeRange = (start: number, end: number) =>
    edit(input.value.slice(0, start) + input.value.slice(end), start)

  const handleKey = (event: KeyboardEvent): boolean => {
    const value = input.value
    const start = input.selectionStart ?? 0
    const end = input.selectionEnd ?? 0
    const selection = start !== end ? ([start, end] as const) : null
    const cursor = input.selectionDirection === 'backward' ? start : end

    switch (event.key) {
      case 'Enter':
        onSubmit(value)
        return true
      case 'Tab':
        onTab?.()
        return true
      case 'Escape':
        place(cursor) // drop the selection
        return false
      case 'ArrowUp':
      case 'ArrowDown': {
        const entries = history()
        if (entries.length === 0) return true
        if (event.key === 'ArrowUp') {
          if (historyPos === null) draft = value
          const next = historyPos === null ? 0 : Math.min(historyPos + 1, entries.length - 1)
          if (next === historyPos) return true
          historyPos = next
          recall(entries[next]!)
        } else if (historyPos !== null) {
          const next = historyPos - 1
          historyPos = next < 0 ? null : next
          recall(next < 0 ? draft : entries[next]!)
        }
        return true
      }
    }

    if (event.ctrlKey && !event.metaKey && !event.altKey) {
      switch (event.key.toLowerCase()) {
        case 'a':
          place(0)
          return true
        case 'e':
          place(value.length)
          return true
        case 'u':
          removeRange(0, selection ? selection[1] : cursor)
          return true
        case 'k':
          removeRange(selection ? selection[0] : cursor, value.length)
          return true
        case 'w':
          removeRange(wordLeft(value, selection ? selection[0] : cursor), selection ? selection[1] : cursor)
          return true
      }
      return false // ^t, ^c etc. belong to the app
    }

    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      // by key code — on macOS, ⌥b / ⌥f would otherwise type ∫ / ƒ
      if (event.code === 'KeyB') {
        place(wordLeft(value, cursor))
        return true
      }
      if (event.code === 'KeyF') {
        place(wordRight(value, cursor))
        return true
      }
    }
    return false
  }

  input.addEventListener('keydown', event => {
    if (event.isComposing) return
    if (handleKey(event)) event.preventDefault()
  })

  // typed text
  input.addEventListener('input', () => {
    historyPos = null
    onChange(input.value)
  })

  // pasted text — strip control chars and newlines, replace the selection
  input.addEventListener('paste', event => {
    event.preventDefault()
    // eslint-disable-next-line no-control-regex
    const clean = (event.clipboardData?.getData('text/plain') ?? '').replace(/[\x00-\x1f\x7f]/g, '')
    if (!clean) return
    const wasEmpty = input.value === ''
    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? start
    const next = input.value.slice(0, start) + clean + input.value.slice(end)
    edit(next, start + clean.length)
    // a paste that completes an empty field submits right away
    if (clean.length > 1 && wasEmpty && submitOnPaste?.(next.trim())) onSubmit(next)
  })

  return {
    setValue(value: string) {
      historyPos = null
      setText(value, value.length)
    },
  }
}