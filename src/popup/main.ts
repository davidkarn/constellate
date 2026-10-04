const button = document.querySelector<HTMLButtonElement>('#ping')!
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!

button.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'ping' })
  statusEl.textContent = `Background replied: ${response?.type}`
})
