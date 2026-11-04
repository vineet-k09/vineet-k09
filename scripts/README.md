# IAP Iframe Authentication Helper

A helper script for applications hosted on Google Cloud Run protected by Identity-Aware Proxy (IAP) and embedded inside cross-origin iframes (e.g. SAP Analytics Cloud / SAC dashboards).

## The Problem
Google IAP cannot directly authenticate within an `iframe` because:
1. Google OAuth redirects are blocked inside iframes (`X-Frame-Options: SAMEORIGIN` / CSP `frame-ancestors 'none'`).
2. Third-party cookie policies prevent the IAP auth cookies from being established or read in cross-origin iframes without prior top-level user authentication.
3. You cannot allow users to run or view the application outside the dashboard iframe.

## The Solution
`scripts/iapAuth.js` provides a dual mechanism:
1. **Server Route (`setupIAPAuthRoute`)**: Registers `/auth-popup` in Express. When accessed, IAP intercepts the unauthenticated request and handles Google OAuth in the popup. Once authenticated, Cloud Run serves a minimal self-closing HTML page with **zero React UI** loaded.
2. **Client Helper (`authenticateIAP`)**: Opens the popup, catches the completion signal, and closes the window immediately to refresh or load the iframe.

---

## Usage

### 1. In your Express backend (`server.js` or `app.js`)
```javascript
const express = require('express');
const { setupIAPAuthRoute } = require('./scripts/iapAuth');

const app = express();

// Register the /auth-popup endpoint before static React routes
setupIAPAuthRoute(app, '/auth-popup');

// ... your regular express and react static routes
```

### 2. In your SAC Dashboard / Parent Wrapper
```javascript
// Include iapAuth.js or import { authenticateIAP } from './iapAuth.js'

const APP_URL = 'https://your-cloud-run-service.a.run.app';
const iframe = document.getElementById('my-app-iframe');

function startAuth() {
  IAPAuth.authenticateIAP({
    appUrl: APP_URL,
    onComplete: function () {
      console.log('IAP authentication succeeded! Reloading iframe...');
      iframe.src = APP_URL;
    },
    onError: function (err) {
      alert(err.message);
    }
  });
}
```

### Alternative: Pure Client-Side in React (`public/index.html`)
If you cannot modify the Express server, add this at the very top of `<head>` in `public/index.html` before any bundles load:
```html
<script>
  if (new URLSearchParams(window.location.search).get('auth_popup') === '1') {
    if (window.opener) {
      window.opener.postMessage({ type: 'IAP_AUTH_SUCCESS' }, '*');
    }
    window.close();
  }
</script>
```
And launch the popup with `APP_URL + '/?auth_popup=1'`.
