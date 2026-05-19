/**
 * Plan 03-01 Task A.1 — extension popup.
 *
 * Single button "Capture this profile". On click:
 *   1. Read the active tab; verify it's a LinkedIn /in/* URL.
 *   2. Inject the content script's `scrapeLinkedInProfile()` into the page.
 *   3. POST the result to the background worker which adds the bearer token
 *      and forwards to `/api/linkedin/ingest`.
 *   4. Render status text from the worker's response.
 *
 * NO direct fetch from the popup — the bearer-from-cookie lookup happens in
 * the background worker (D3-02 + RESEARCH §Pattern 1). The popup is pure UI.
 */

const LINKEDIN_PROFILE_RE = /^https:\/\/(www\.)?linkedin\.com\/in\//i

function setStatus(text: string, tone: 'ok' | 'error' | 'info' = 'info') {
  const el = document.getElementById('status')
  if (!el) return
  el.textContent = text
  el.setAttribute('data-tone', tone)
}

function setBusy(busy: boolean) {
  const btn = document.getElementById('capture') as HTMLButtonElement | null
  if (!btn) return
  btn.disabled = busy
  btn.textContent = busy ? 'Capturing…' : 'Capture this profile'
}

async function onCaptureClick() {
  setBusy(true)
  setStatus('Reading profile…')
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !tab.url || !LINKEDIN_PROFILE_RE.test(tab.url)) {
      setStatus('Open a LinkedIn /in/ profile, then try again.', 'error')
      return
    }
    const response = await chrome.runtime.sendMessage({
      type: 'CAPTURE_PROFILE',
      tabId: tab.id,
      url: tab.url,
    })
    if (!response || !response.ok) {
      const msg = (response && typeof response.error === 'string')
        ? response.error
        : 'Capture failed. Try again.'
      setStatus(msg, 'error')
      return
    }
    setStatus(
      response.updated ? 'Updated existing candidate.' : 'New candidate saved.',
      'ok',
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    setStatus(`Capture failed: ${msg}`, 'error')
  } finally {
    setBusy(false)
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('capture')
  btn?.addEventListener('click', onCaptureClick)
})
