import { getOpenRouterApiKey, setOpenRouterApiKey } from '../shared/settings'

const form = document.querySelector<HTMLFormElement>('#options')!
const input = document.querySelector<HTMLInputElement>('#api-key')!
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!

getOpenRouterApiKey().then((key) => {
  input.value = key ?? ''
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const key = input.value.trim()
  await setOpenRouterApiKey(key)
  statusEl.textContent = key.length > 0 ? 'API key saved.' : 'API key removed.'
})
