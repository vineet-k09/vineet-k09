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

## 2. SAP Analytics Cloud (SAC) / Dashboard Changes

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

## Why React is Untouched:
- When the popup opens `https://your-cloud-run-app.run.app/auth-popup`, **IAP** handles the entire Google login flow.
- Once authenticated, Cloud Run serves only the 10-line HTML snippet from `/auth-popup`.
- The popup sends a message and calls `window.close()`.
- **Zero React JavaScript bundles are downloaded, executed, or rendered in the popup.**
