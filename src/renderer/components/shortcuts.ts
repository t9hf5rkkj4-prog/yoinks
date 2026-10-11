export type Shortcut = {key: string; label: string; onClick?: () => void}

/** Renders `key label · key label …`; items with an action become buttons. */
export function renderShortcuts(list: HTMLElement, items: Shortcut[]): void {
  list.replaceChildren(
    ...items.map(({key, label, onClick}) => {
      const item = document.createElement('li')
      const body = document.createElement(onClick ? 'button' : 'span')
      body.className = 'hint'
      if (onClick) {
        ;(body as HTMLButtonElement).type = 'button'
        body.addEventListener('click', onClick)
      }
      const kbd = document.createElement('kbd')
      kbd.textContent = key
      const text = document.createElement('span')
      text.className = 'secondary'
      text.textContent = label
      body.append(kbd, ' ', text)
      item.append(body)
      return item
    }),
  )
}