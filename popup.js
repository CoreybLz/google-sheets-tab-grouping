const signedIn  = document.getElementById('signed-in-view');
const signedOut = document.getElementById('signed-out-view');
const btnSignIn  = document.getElementById('btn-signin');
const btnSignOut = document.getElementById('btn-signout');
const avatar     = document.getElementById('user-avatar');
const userName   = document.getElementById('user-name');
const userEmail  = document.getElementById('user-email');
const syncDot    = document.getElementById('sync-dot');
const statusText = document.getElementById('status-text');

async function getToken(interactive) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_AUTH_TOKEN', interactive }, resolve);
  });
}

async function removeToken() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'REMOVE_AUTH_TOKEN' }, resolve);
  });
}

async function fetchUserInfo(token) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok ? res.json() : null;
}

async function init() {
  const { token, error } = await getToken(false);
  if (!token || error) {
    showSignedOut();
    return;
  }
  const info = await fetchUserInfo(token);
  showSignedIn(info);
}

function showSignedIn(info) {
  signedOut.style.display = 'none';
  signedIn.style.display  = 'block';

  if (info) {
    const initials = (info.name || info.email || '?')
      .split(' ')
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
    avatar.textContent = initials;
    userName.textContent  = info.name  || info.email;
    userEmail.textContent = info.email || '';
  }

  syncDot.className    = 'dot green';
  statusText.textContent = 'Connected — groups sync every 30s';
}

function showSignedOut() {
  signedIn.style.display  = 'none';
  signedOut.style.display = 'block';
}

btnSignIn.addEventListener('click', async () => {
  btnSignIn.textContent = 'Signing in…';
  btnSignIn.disabled = true;
  const { token, error } = await getToken(true);
  if (token) {
    const info = await fetchUserInfo(token);
    showSignedIn(info);
  } else {
    btnSignIn.textContent = 'Sign in with Google';
    btnSignIn.disabled = false;
    statusText.textContent = error || 'Sign-in failed';
    syncDot.className = 'dot yellow';
  }
});

btnSignOut.addEventListener('click', async () => {
  await removeToken();
  showSignedOut();
});

init();
