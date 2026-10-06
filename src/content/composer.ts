import type { ChatMessage } from '../shared/chat'
import { createButton, createElement } from './dom'
import { mentionFor } from './format'

// YouTube's limit for a live chat message.
const MAX_MESSAGE_LENGTH = 200

export type SendOutcome = { ok: true } | { ok: false; reason: string }

// Posts a message to the live chat, as a reply to `replyTo` when given.
export type SendMessage = (
  text: string,
  replyTo: ChatMessage | null,
) => Promise<SendOutcome>

export interface Composer {
  element: HTMLElement
  // Starts a reply: prefills an @mention of the author and focuses the box.
  startReply(message: ChatMessage): void
}

export const COMPOSER_STYLE = `
.composer {
  flex: none;
  padding: 10px 16px 14px;
  border-top: 1px solid rgb(34, 37, 43);
}
.reply-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: rgb(127, 132, 141);
}
.reply-bar[hidden] {
  display: none;
}
.reply-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cancel-reply {
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.cancel-reply:hover {
  color: rgb(233, 234, 237);
}
.composer-row {
  display: flex;
  gap: 8px;
}
.composer-input {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  height: 36px;
  padding: 0 14px;
  border: 1px solid rgb(34, 37, 43);
  border-radius: 18px;
  outline: none;
  background: rgb(25, 27, 31);
  color: rgb(233, 234, 237);
  font: inherit;
}
.composer-input:focus {
  border-color: rgb(68, 77, 111);
}
.composer-input::placeholder {
  color: rgb(127, 132, 141);
}
.send-button {
  flex: none;
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 18px;
  background: rgb(149, 171, 255);
  color: rgb(17, 19, 21);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.send-button:disabled {
  opacity: 0.5;
  cursor: default;
}
.composer-status {
  margin-top: 6px;
  color: rgb(243, 176, 102);
}
.composer-status:empty {
  display: none;
}
`

export function createComposer(send: SendMessage): Composer {
  const form       = document.createElement('form')
  const replyBar   = createElement('reply-bar', '')
  const replyLabel = createElement('reply-label', '')
  const cancel     = createButton('cancel-reply', '×', 'Cancel reply')
  const row        = createElement('composer-row', '')
  const input      = document.createElement('input')
  const submit     = createButton('send-button', 'Send', 'Send message')
  const status     = createElement('composer-status', '')

  form.className    = 'composer'
  input.className   = 'composer-input'
  input.type        = 'text'
  input.placeholder = 'Chat…'
  input.maxLength   = MAX_MESSAGE_LENGTH
  input.autocomplete = 'off'
  submit.type       = 'submit'
  status.setAttribute('role', 'status')
  replyBar.hidden   = true
  replyBar.append(replyLabel, cancel)
  row.append(input, submit)
  form.append(replyBar, row, status)

  let replyTo: ChatMessage | null = null

  function setReply(message: ChatMessage | null) {
    replyTo                = message
    replyBar.hidden        = message === null
    replyLabel.textContent = message === null ? '' : `Replying to ${message.author}`
  }

  // YouTube's keyboard shortcuts listen on the page, and would otherwise
  // pause or seek the video while the viewer types.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    input.addEventListener(type, (event) => event.stopPropagation())
  }

  // Deleting the @mention turns the reply back into a plain message.
  input.addEventListener('input', () => {
    status.textContent = ''
    if (replyTo !== null && !input.value.includes(mentionFor(replyTo.author).trim())) {
      setReply(null)
    }
  })

  cancel.addEventListener('click', () => {
    setReply(null)
    input.focus()
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const text = input.value.trim()
    if (text.length === 0 || submit.disabled) {
      return
    }
    else {
      submit.disabled    = true
      status.textContent = ''
      const outcome = await send(text, replyTo)
      submit.disabled = false
      if (outcome.ok) {
        input.value = ''
        setReply(null)
      }
      else {
        status.textContent = outcome.reason
      }
      input.focus()
    }
  })

  return {
    element: form,
    startReply(message: ChatMessage) {
      // Swap any earlier reply's @mention for this one, keeping other text.
      const previous = replyTo === null ? '' : mentionFor(replyTo.author)
      const rest     = input.value.replace(previous, '').trimStart()
      setReply(message)
      input.value = mentionFor(message.author) + rest
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    },
  }
}
