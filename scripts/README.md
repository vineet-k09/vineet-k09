# Robust IAP Iframe Authentication (SAC + Express)

A complete solution for embedding a Google Cloud Run application protected by Identity-Aware Proxy (IAP) inside an iframe (e.g. SAP Analytics Cloud dashboard), **without touching React at all**.

---

## 1. Express Changes (`server.js`)

Add this endpoint **before** your React static routes / catch-all handlers.

```javascript
// In server.js / app.js

// 1. Import helper or paste setupIAPAuthRoute directly
const { setupIAPAuthRoute } = require('./scripts/iapAuth');

// 2. Register the endpoint (must be BEFORE express.static or app.get('*'))
setupIAPAuthRoute(app, '/auth-popup');

// (Your existing code follows)
// app.use(express.static(path.join(__dirname, 'build')));
// app.get('*', (req, res) => res.sendFile(...));
```

### Or paste the inline route directly into `server.js`:
```javascript
app.get('/auth-popup', (req, res) => {
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
  });
  res.send(`<!DOCTYPE html>
<html>
<body>
  <p>Authenticating... This window will close automatically.</p>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'IAP_AUTH_SUCCESS' }, '*');
    }
    window.close();
  </script>
</body>
</html>`);
});
```

---

## 2. SAP Analytics Cloud (SAC) / Dashboard Changes (Full Module Version)

Use this script in your SAC dashboard (widget script, custom widget, or page script):

```javascript
// Include iapAuth.js or copy-paste authenticateIAP & reloadIframe

const APP_URL = 'https://your-cloud-run-app.run.app';
const IFRAME_ID = 'my-react-iframe'; // ID of the iframe in SAC

function loginAndLoadApp() {
  IAPAuth.authenticateIAP({
    appUrl: APP_URL,
    onComplete: function () {
      console.log('IAP authentication succeeded!');
      // Reload iframe with fresh auth cookies
      IAPAuth.reloadIframe(IFRAME_ID, APP_URL);
    },
    onError: function (err) {
      alert(err.message);
    }
  });
}
```

### Using Async / Await:
```javascript
async function onDashboardInit() {
  try {
    await IAPAuth.authenticateIAP({ appUrl: 'https://your-cloud-run-app.run.app' });
    IAPAuth.reloadIframe('my-react-iframe', 'https://your-cloud-run-app.run.app');
  } catch (err) {
    console.error('Failed to authenticate with IAP:', err);
  }
}
```

---

## 3. Quick 5-Second Test Script (Window Open -> 5s Interval -> Window Close)

Run this directly in your browser DevTools Console or wire it to a test button. It opens the popup, checks on a 1-second interval, and forces the window closed after 5 seconds:

```javascript
// Quick 5-Second Test Script
(function testIAPAuth() {
  var APP_URL = 'https://your-cloud-run-app.run.app/auth-popup';
  console.log('[Test] Opening auth window...');

  var popup = window.open(
    APP_URL,
    'IAP_Test_Window',
    'width=500,height=600,menubar=no,toolbar=no'
  );

  if (!popup) {
    alert('Popup was blocked by your browser! Please allow popups.');
    return;
  }

  var secondsLeft = 5;
  var interval = setInterval(function () {
    secondsLeft--;
    console.log('[Test] Checking popup... ' + secondsLeft + 's remaining');

    // If user closed the popup or /auth-popup closed itself
    if (popup.closed) {
      clearInterval(interval);
      console.log('[Test] Popup closed successfully. Authentication finished!');
      return;
    }

    // Force close after 5 seconds
    if (secondsLeft <= 0) {
      clearInterval(interval);
      popup.close();
      console.log('[Test] 5 seconds elapsed: Closed popup window. Test complete!');
    }
  }, 1000);
})();
```

---

## 4. Plain JavaScript Version (No `IAPAuth` Wrapper / Zero Dependencies)

If you are writing raw JavaScript (e.g. inside a SAC Custom Widget or a plain HTML host page) and do not want any `IAPAuth` object or wrapper, use this single standalone function:

```javascript
/**
 * Plain, standalone JavaScript function - no external library or IAPAuth object.
 * @param {string} appUrl - e.g. "https://your-cloud-run-app.run.app"
 * @param {string} iframeId - DOM ID of the iframe in your page
 */
function authenticateAndReload(appUrl, iframeId) {
  var targetUrl = appUrl.replace(/\/+$/, '') + '/auth-popup';
  var popup = window.open(targetUrl, 'IAP_Auth', 'width=520,height=640');

  if (!popup) {
    alert('Popup was blocked. Please allow popups for this site.');
    return;
  }

  var isDone = false;

  function finish() {
    if (isDone) return;
    isDone = true;
    window.removeEventListener('message', onMessage);
    clearInterval(pollTimer);

    // Reload the iframe with a cache-buster query
    var iframe = document.getElementById(iframeId);
    if (iframe) {
      var sep = appUrl.indexOf('?') === -1 ? '?' : '&';
      iframe.src = appUrl + sep + '_auth_sync=' + Date.now();
    }
    console.log('IAP Auth complete: iframe reloaded.');
  }

  // Option A: Instant notification from Express /auth-popup
  function onMessage(event) {
    if (event.data && event.data.type === 'IAP_AUTH_SUCCESS') {
      finish();
    }
  }
  window.addEventListener('message', onMessage);

  // Option B: Fallback check every 500ms if the popup closed itself
  var pollTimer = setInterval(function () {
    if (popup.closed) {
      finish();
    }
  }, 500);
}

// Usage:
// authenticateAndReload('https://your-cloud-run-app.run.app', 'my-react-iframe');
```

---

## 5. Native SAC Scripting Version (`NavigationUtils`)

In **native SAP Analytics Cloud (Stories & Analytics Designer)**, standard browser DOM APIs (`window.open`, `document.getElementById`, `IAPAuth`) are not permitted by the SAC script compiler.

Instead, use SAC's built-in **`NavigationUtils`** and **`WebPage` widget**:

### Step 1: In SAC "Login" Button (`onClick`)
```javascript
// Native SAC Scripting
// Opens /auth-popup in a new browser tab/window.
// Google IAP intercepts, user logs in, and /auth-popup self-closes via window.close().
NavigationUtils.openUrl("https://your-cloud-run-app.run.app/auth-popup", true);
```

### Step 2: In SAC "Refresh" Button (`onClick`)
```javascript
// Native SAC Scripting
// Tells the Web Page widget to reload the application with the new IAP cookie
WebPage_1.setAddress("https://your-cloud-run-app.run.app");
```

---

## Why React is Untouched:
- When the popup opens `https://your-cloud-run-app.run.app/auth-popup`, **IAP** handles the entire Google login flow.
- Once authenticated, Cloud Run serves only the 10-line HTML snippet from `/auth-popup`.
- The popup sends a message and calls `window.close()`.
- **Zero React JavaScript bundles are downloaded, executed, or rendered in the popup.**
