/**
 * ============================================================================
 * Robust IAP (Identity-Aware Proxy) Iframe Authentication Solution
 * ============================================================================
 * 
 * Target Architecture:
 * - SAP Analytics Cloud (SAC) Dashboard -> Hosts iframe
 * - Google Cloud Run (Express.js) -> Hosts backend and serves React static build
 * - Google Cloud IAP -> Protects Cloud Run service
 * - React -> ZERO CHANGES REQUIRED
 *
 * How this works:
 * 1. User opens SAC Dashboard. If IAP cookie is missing, iframe shows 403.
 * 2. SAC script triggers `authenticateIAP()`, opening a centered popup to `/auth-popup`.
 * 3. IAP intercepts the popup at GCP edge and conducts Google SSO.
 * 4. Once Google SSO passes, IAP forwards the request to Cloud Run (`/auth-popup`).
 * 5. Express serves a minimal HTML snippet (NO React bundle downloaded).
 * 6. The snippet signals the SAC dashboard via postMessage and kills the popup immediately.
 * 7. SAC script receives the signal and reloads the iframe with authenticated cookies.
 * ============================================================================
 */

// ============================================================================
// PART 1: EXPRESS.JS BACKEND (Add this to your server.js / app.js)
// ============================================================================

/**
 * Registers the lightweight /auth-popup endpoint in Express.
 * Place this BEFORE any static file serving (express.static) or React catch-all routes!
 *
 * @param {import('express').Application} app - The Express app instance
 * @param {string} [routePath='/auth-popup'] - The route path to register
 */
function setupIAPAuthRoute(app, routePath = '/auth-popup') {
  app.get(routePath, (req, res) => {
    // Prevent any browser or intermediary caching
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Authenticating...</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: #f8fafc;
      color: #334155;
      text-align: center;
    }
    .box {
      padding: 24px;
      background: #ffffff;
      border-radius: 8px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
  </style>
</head>
<body>
  <div class="box">
    <p>Authentication complete. Closing window...</p>
    <button onclick="window.close()" style="margin-top: 10px; padding: 6px 14px; cursor: pointer;">Close Window</button>
  </div>
  <script>
    (function() {
      // 1. Notify opener window
      try {
        if (window.opener) {
          window.opener.postMessage({ type: 'IAP_AUTH_SUCCESS' }, '*');
        }
      } catch (e) {
        console.error('Failed to notify opener:', e);
      }

      // 2. Self-terminate immediately
      window.close();
    })();
  </script>
</body>
</html>`);
  });
}


// ============================================================================
// PART 2: SAP ANALYTICS CLOUD (SAC) / CLIENT JAVASCRIPT
// ============================================================================

/**
 * Opens an IAP authentication popup and executes a callback or resolves a Promise
 * when authentication is confirmed.
 *
 * @param {Object} options Configuration options
 * @param {string} options.appUrl Base URL of Cloud Run app (e.g. "https://my-app.run.app")
 * @param {string} [options.authRoute='/auth-popup'] Dedicated auth route
 * @param {number} [options.width=520] Width of popup window
 * @param {number} [options.height=640] Height of popup window
 * @param {number} [options.timeoutMs=120000] Timeout in milliseconds (default 2 minutes)
 * @param {Function} [options.onComplete] Callback called on success
 * @param {Function} [options.onError] Callback called on failure or popup blocked
 * @returns {Promise<void>} Resolves when authentication succeeds
 */
function authenticateIAP(options) {
  return new Promise(function(resolve, reject) {
    var appUrl = (options.appUrl || '').replace(/\/+$/, '');
    var authRoute = options.authRoute || '/auth-popup';
    var width = options.width || 520;
    var height = options.height || 640;
    var timeoutMs = options.timeoutMs || 120000;
    var onComplete = options.onComplete || function() {};
    var onError = options.onError || function(err) { console.error('[IAPAuth]', err); };

    if (!appUrl) {
      var err = new Error('IAPAuth: appUrl is required');
      onError(err);
      return reject(err);
    }

    // Calculate center of current screen
    var dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : window.screenX;
    var dualScreenTop = window.screenTop !== undefined ? window.screenTop : window.screenY;
    var screenWidth = window.innerWidth || document.documentElement.clientWidth || screen.width;
    var screenHeight = window.innerHeight || document.documentElement.clientHeight || screen.height;

    var left = dualScreenLeft + (screenWidth - width) / 2;
    var top = dualScreenTop + (screenHeight - height) / 2;

    var targetUrl = appUrl + (authRoute.startsWith('/') ? authRoute : '/' + authRoute);

    var windowFeatures = [
      'width=' + width,
      'height=' + height,
      'top=' + top,
      'left=' + left,
      'menubar=no',
      'toolbar=no',
      'location=yes',
      'status=no',
      'resizable=yes',
      'scrollbars=yes'
    ].join(',');

    // Open popup
    var popup = window.open(targetUrl, 'IAP_Auth_Popup', windowFeatures);

    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      var blockedErr = new Error('Popup blocked! Please allow popups for this dashboard to authenticate.');
      onError(blockedErr);
      return reject(blockedErr);
    }

    var isResolved = false;
    var pollTimer = null;
    var timeoutTimer = null;

    function cleanup() {
      if (isResolved) return;
      isResolved = true;

      window.removeEventListener('message', handleMessage);
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);

      onComplete();
      resolve();
    }

    // Listener 1: Fast postMessage signal from popup script
    function handleMessage(event) {
      if (event.data && event.data.type === 'IAP_AUTH_SUCCESS') {
        cleanup();
      }
    }

    window.addEventListener('message', handleMessage);

    // Listener 2: Fallback polling in case postMessage is dropped or user closes window manually
    pollTimer = setInterval(function() {
      if (popup.closed) {
        cleanup();
      }
    }, 400);

    // Listener 3: Timeout guard to prevent memory leaks if user abandons popup
    timeoutTimer = setTimeout(function() {
      if (!isResolved) {
        isResolved = true;
        window.removeEventListener('message', handleMessage);
        if (pollTimer) clearInterval(pollTimer);
        try { popup.close(); } catch(e) {}
        var timeoutErr = new Error('IAP authentication timed out.');
        onError(timeoutErr);
        reject(timeoutErr);
      }
    }, timeoutMs);
  });
}

/**
 * Convenience helper to reload or set an iframe's source URL safely.
 *
 * @param {HTMLIFrameElement|string} iframeOrId DOM element or ID of the iframe
 * @param {string} url The target URL to set or reload
 */
function reloadIframe(iframeOrId, url) {
  var el = typeof iframeOrId === 'string' ? document.getElementById(iframeOrId) : iframeOrId;
  if (!el) {
    console.warn('[IAPAuth] Iframe not found:', iframeOrId);
    return;
  }
  // Adding cache-busting timestamp ensures the iframe drops cached 403 responses
  var separator = url.indexOf('?') === -1 ? '?' : '&';
  el.src = url + separator + '_auth_sync=' + Date.now();
}


// ============================================================================
// PART 3: UNIVERSAL MODULE EXPORTS
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    setupIAPAuthRoute: setupIAPAuthRoute,
    authenticateIAP: authenticateIAP,
    reloadIframe: reloadIframe
  };
} else if (typeof window !== 'undefined') {
  window.IAPAuth = {
    authenticateIAP: authenticateIAP,
    reloadIframe: reloadIframe
  };
}
