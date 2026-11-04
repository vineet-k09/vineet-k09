/**
 * IAP Iframe Authentication Helper
 *
 * Solves Google Identity-Aware Proxy (IAP) 403 / unauthenticated iframe issues
 * when embedding a Cloud Run React/Express app inside an iframe (e.g., SAC dashboard).
 *
 * Why this is needed:
 * Google IAP blocks embedding the login page in an iframe (X-Frame-Options: SAMEORIGIN)
 * and cross-origin iframes cannot establish/receive IAP session cookies without top-level navigation.
 *
 * This script provides:
 * 1. authenticateIAP() - Client-side launcher that opens a popup, waits for IAP auth, and closes it.
 * 2. setupIAPAuthRoute() - Express.js route handler serving a lightweight self-closing page (no React UI exposed).
 * 3. handlePopupAuth() - Popup-side script if embedding directly into an HTML page or React index.html.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.IAPAuth = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  /**
   * Client-Side: Opens a popup window to complete IAP authentication.
   *
   * @param {Object|string} options - Configuration object or appUrl string.
   * @param {string} options.appUrl - Base URL of the IAP-protected Cloud Run app.
   * @param {string} [options.authRoute='/auth-popup'] - Route path on the app that triggers IAP and auto-closes.
   * @param {number} [options.width=500] - Popup window width.
   * @param {number} [options.height=600] - Popup window height.
   * @param {Function} [options.onComplete] - Callback executed when authentication completes.
   * @param {Function} [options.onError] - Callback executed if popup is blocked or fails.
   * @param {Function} [onCompleteCallback] - Callback shorthand if options is passed as a string.
   * @returns {Window|null} The popup window instance.
   */
  function authenticateIAP(options, onCompleteCallback) {
    var config = {};
    if (typeof options === 'string') {
      config.appUrl = options;
      config.onComplete = onCompleteCallback;
    } else {
      config = options || {};
    }

    var appUrl = (config.appUrl || '').replace(/\/+$/, '');
    var authRoute = config.authRoute || '/auth-popup';
    var width = config.width || 500;
    var height = config.height || 600;
    var onComplete = config.onComplete || function () {};
    var onError = config.onError || function (err) { console.error('[IAPAuth]', err); };

    if (!appUrl) {
      onError(new Error('appUrl is required for authenticateIAP'));
      return null;
    }

    var left = window.screenLeft !== undefined ? window.screenLeft : window.screenX;
    var top = window.screenTop !== undefined ? window.screenTop : window.screenY;
    var screenWidth = window.innerWidth || document.documentElement.clientWidth || screen.width;
    var screenHeight = window.innerHeight || document.documentElement.clientHeight || screen.height;

    var popupLeft = left + (screenWidth - width) / 2;
    var popupTop = top + (screenHeight - height) / 2;

    var targetUrl = appUrl + (authRoute.startsWith('/') ? authRoute : '/' + authRoute);
    var windowFeatures = [
      'width=' + width,
      'height=' + height,
      'top=' + popupTop,
      'left=' + popupLeft,
      'menubar=no',
      'toolbar=no',
      'location=yes',
      'status=no',
      'resizable=yes',
      'scrollbars=yes'
    ].join(',');

    var popup = window.open(targetUrl, 'IAP_Auth_Window', windowFeatures);

    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      onError(new Error('Popup was blocked by the browser. Please allow popups for this site.'));
      return null;
    }

    var isResolved = false;

    function cleanup() {
      if (isResolved) return;
      isResolved = true;
      window.removeEventListener('message', handleMessage);
      if (pollTimer) clearInterval(pollTimer);
      onComplete();
    }

    function handleMessage(event) {
      if (event.data && event.data.type === 'IAP_AUTH_SUCCESS') {
        cleanup();
      }
    }

    window.addEventListener('message', handleMessage);

    // Fallback: poll if popup window closed manually or closed via script
    var pollTimer = setInterval(function () {
      if (popup.closed) {
        cleanup();
      }
    }, 500);

    return popup;
  }

  /**
   * Popup-Side: Executes inside the popup window to notify the parent/opener and close itself.
   * Can be used inside public/index.html <head> if query parameter matching is desired.
   *
   * @param {Object} [options]
   * @param {string} [options.targetOrigin='*'] - Target origin for window.postMessage.
   */
  function handlePopupAuth(options) {
    var targetOrigin = (options && options.targetOrigin) || '*';
    if (window.opener) {
      try {
        window.opener.postMessage({ type: 'IAP_AUTH_SUCCESS' }, targetOrigin);
      } catch (err) {
        console.error('[IAPAuth] Failed to postMessage to opener:', err);
      }
    }
    window.close();
  }

  /**
   * Server-Side (Express.js): Registers a lightweight authentication endpoint.
   * This endpoint is protected by IAP. Once the user passes IAP, this serves a minimal HTML
   * response that signals the opener window and terminates immediately without rendering the React UI.
   *
   * @param {Object} app - Express application instance.
   * @param {string} [routePath='/auth-popup'] - Route path to register.
   */
  function setupIAPAuthRoute(app, routePath) {
    var path = routePath || '/auth-popup';
    app.get(path, function (req, res) {
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      });
      res.send([
        '<!DOCTYPE html>',
        '<html>',
        '<head>',
        '  <title>Authenticating...</title>',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <style>',
        '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #334155; }',
        '    .card { text-align: center; padding: 24px; }',
        '  </style>',
        '</head>',
        '<body>',
        '  <div class="card">',
        '    <p>Authenticating session... This window will close automatically.</p>',
        '  </div>',
        '  <script>',
        '    if (window.opener) {',
        '      window.opener.postMessage({ type: "IAP_AUTH_SUCCESS" }, "*");',
        '    }',
        '    window.close();',
        '  </script>',
        '</body>',
        '</html>'
      ].join('\n'));
    });
  }

  return {
    authenticateIAP: authenticateIAP,
    handlePopupAuth: handlePopupAuth,
    setupIAPAuthRoute: setupIAPAuthRoute
  };
});
