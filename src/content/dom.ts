export function createElement(className: string, text: string): HTMLElement {
  const element = document.createElement('div')
  element.className   = className
  element.textContent = text
  return element
}

export function createButton(className: string, text: string, label: string) {
  const button = document.createElement('button')
  button.type        = 'button'
  button.className   = className
  button.textContent = text
  button.setAttribute('aria-label', label)
  return button
}
