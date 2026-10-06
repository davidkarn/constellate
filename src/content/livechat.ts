import type { SendOutcome } from './composer'

// The chat box YouTube shows signed-in viewers, inside the live chat iframe.
const INPUT_SELECTOR = 'yt-live-chat-text-input-field-renderer #input'
// YouTube has used each of these for the send button.
const SEND_SELECTORS = ['#send-button button', '#send-button #button', '#send-button']
// How long YouTube gets to accept a message before it counts as not sent.
const SEND_CHECK_MS = 600

interface ChatInput {
  doc: Document
  input: HTMLElement
  send: HTMLElement
}

function findSendButton(doc: Document): HTMLElement | null {
  const buttons =
    SEND_SELECTORS.map((selector) => doc.querySelector<HTMLElement>(selector))
  return buttons.find((button) => button !== null) ?? null
}

function findChatInput(docs: readonly Document[]): ChatInput | null {
  const inputs = docs.flatMap((doc) => {
    const input = doc.querySelector<HTMLElement>(INPUT_SELECTOR)
    const send  = findSendButton(doc)
    return input === null || send === null ? [] : [{ doc, input, send }]
  })
  return inputs[0] ?? null
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

// Types `text` into YouTube's own chat box and presses its send button.
// YouTube only notices real edits, so the text goes in through execCommand
// rather than by setting the box's contents.
export async function postToLiveChat(
  docs: readonly Document[],
  text: string,
): Promise<SendOutcome> {
  const target = findChatInput(docs)
  if (target === null) {
    return {
      ok: false,
      reason: "YouTube's chat box isn't available. Are you signed in, with chat open?",
    }
  }
  else {
    const { doc, input, send } = target
    input.focus()
    doc.execCommand('selectAll', false)
    doc.execCommand('insertText', false, text)
    // Let YouTube enable its send button for the new text.
    await wait(50)
    send.click()
    await wait(SEND_CHECK_MS)

    // YouTube empties its box once it accepts a message.
    if ((input.textContent ?? '').trim().length > 0) {
      return {
        ok: false,
        reason:
          "YouTube didn't send the message. Chat may be in slow mode or restricted.",
      }
    }
    else {
      return { ok: true }
    }
  }
}
