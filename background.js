// Service worker: handles OAuth token vending and proxies Sheets API requests
// from the content script (which can't use chrome.identity directly).

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

async function sheetsRequest(url, method, body) {
  let token = await getAuthToken(true);

  const doFetch = (t) =>
    fetch(url, {
      method: method || 'GET',
      headers: {
        Authorization: `Bearer ${t}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  let res = await doFetch(token);

  // Token might be stale — refresh once and retry
  if (res.status === 401) {
    await removeCachedToken(token);
    token = await getAuthToken(true);
    res = await doFetch(token);
  }

  const data = await res.json();
  return { data, status: res.status, ok: res.ok };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_AUTH_TOKEN') {
    getAuthToken(message.interactive !== false)
      .then((token) => sendResponse({ token }))
      .catch((err) => sendResponse({ error: err.message }));
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
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});
