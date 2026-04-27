// Service worker: handles OAuth token vending and proxies Sheets API requests.

const log  = (...a) => console.log('[STG bg]',  ...a);
const warn = (...a) => console.warn('[STG bg]', ...a);
const oops = (...a) => console.error('[STG bg]',...a);

// Open the side panel when the extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
log('service worker started');

// ── Auth ───────────────────────────────────────────────────────────────────────

function getAuthToken(interactive) {
  log('getAuthToken: interactive?', interactive);
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        warn('getAuthToken error:', chrome.runtime.lastError.message);
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        log('getAuthToken: token obtained?', !!token);
        resolve(token);
      }
    });
  });
}

function removeCachedToken(token) {
  log('removeCachedToken');
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

// ── Sheets API proxy ───────────────────────────────────────────────────────────

async function sheetsRequest(url, method, body) {
  log('sheetsRequest:', method, url);

  // Use non-interactive token first; only prompt user when needed
  let token;
  try {
    token = await getAuthToken(false);
  } catch (e) {
    warn('sheetsRequest: non-interactive token failed, trying interactive:', e.message);
    token = await getAuthToken(true);
  }

  if (!token) {
    oops('sheetsRequest: no token available');
    throw new Error('Not authenticated');
  }

  const doFetch = (t) =>
    fetch(url, {
      method: method || 'GET',
      headers: {
        Authorization:  `Bearer ${t}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  let res = await doFetch(token);
  log('sheetsRequest: response status', res.status, 'ok?', res.ok);

  // Token might be stale — refresh once and retry
  if (res.status === 401) {
    warn('sheetsRequest: 401 — removing cached token and retrying');
    await removeCachedToken(token);
    token = await getAuthToken(true);
    res = await doFetch(token);
    log('sheetsRequest: retry status', res.status);
  }

  let data;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    data = await res.json();
  } else {
    const text = await res.text();
    data = text ? { _text: text } : {};
  }

  if (!res.ok) {
    warn('sheetsRequest: HTTP error —', res.status, data?.error?.message ?? JSON.stringify(data).slice(0, 200));
  }

  return { data, status: res.status, ok: res.ok };
}

// ── Message listener ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  log('onMessage:', message.type);

  if (message.type === 'GET_AUTH_TOKEN') {
    const interactive = message.interactive !== false;
    getAuthToken(interactive)
      .then((token) => { log('GET_AUTH_TOKEN: success'); sendResponse({ token }); })
      .catch((err)  => { warn('GET_AUTH_TOKEN error:', err.message); sendResponse({ error: err.message }); });
    return true;
  }

  if (message.type === 'REMOVE_AUTH_TOKEN') {
    getAuthToken(false)
      .then((token) => (token ? removeCachedToken(token) : Promise.resolve()))
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'SHEETS_API') {
    sheetsRequest(message.url, message.method, message.body)
      .then((result) => sendResponse(result))
      .catch((err)  => {
        oops('SHEETS_API error:', err.message);
        sendResponse({ error: err.message, ok: false });
      });
    return true;
  }

  warn('onMessage: unhandled type', message.type);
});
