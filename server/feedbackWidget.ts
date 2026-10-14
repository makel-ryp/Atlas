/**
 * The feedback button, as one <script> injected into Luke's served page at serve time.
 *
 * ── INJECTED, NEVER ADDED TO HIS FILE ───────────────────────────────────────────────────────────
 * Same principle as `injectData` / `injectBanner` in routes/proto.ts: this is a statement about how
 * Atlas HOSTS the page (a Testing build collecting feedback), not part of Luke's design. It must
 * never be copied into `proto/Dashboard.dc.html`, and `proto/support.js` stays untouched. When
 * Testing ends, deleting the one call in proto.ts removes the feature completely.
 *
 * ── WHY IT IS BUILT THE WAY IT IS (each of these is a bug it avoids) ─────────────────────────────
 *  - ATTACHED TO document.body, in a SHADOW ROOT. His mini-React re-renders inside its own tree;
 *    a node in that tree would be wiped by the next render. The shadow root also keeps his global
 *    CSS (resets on button/textarea/h2) out of the widget and the widget's CSS out of his page. A
 *    MutationObserver re-attaches the host if something does remove it from <body>.
 *  - z-index ABOVE EVERYTHING of his. His banner is 9999, his modals 90-310. A feedback button
 *    that disappears behind the screen the tester is trying to report on is useless.
 *  - HIDDEN DURING CAPTURE AND `ignoreElements`'d. The screenshot should show what the tester saw,
 *    not the composer they were typing into.
 *  - VIEWPORT-ONLY CAPTURE at a capped scale. A full-page PNG of a long dashboard on a phone
 *    (DPR 3) is tens of megabytes; the server refuses over 4 MB. The capture steps the scale down,
 *    and if it still will not fit — or the canvas is tainted, or html2canvas never loaded — it
 *    sends the NOTE ALONE. A report with no picture beats no report.
 *  - ESCAPE IS CAPTURED AND SWALLOWED while the composer is open, so it does not also close one of
 *    his modals underneath. Keydown/keyup/keypress inside the widget stop propagating, so typing
 *    a note cannot trigger a shortcut in his page.
 *  - html2canvas is PINNED to 1.4.1 and carries a Subresource Integrity hash. This page runs with
 *    the tester's session cookie; an unpinned third-party script here would be a supply-chain hole.
 *    It is loaded lazily when the composer first opens, not on every page view.
 *
 * ⚠️ `screen` IS BEST-EFFORT. His current view lives in a closure inside support.js and is not
 * exposed, and `__ATLAS_DATA__.view` is only the LANDING view. The widget reports the first visible
 * h1/h2 plus the path. If his headings change, this gets vaguer; it never gets wrong in a way that
 * loses a report.
 *
 * ⚠️ UNTESTED IN A REAL BROWSER AGAINST HIS PAGE when this was written (no browser in the build
 * environment). html2canvas's rendering of his CSS (backdrop-filter, custom fonts) is the unknown.
 */
const H2C_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
const H2C_SRI =
  'sha512-BNaRQnYJYiPSqHHDb58B0yaPfCu+Wgds8Gp/gU33kqBtgNS4tSPHuGibyoeqMV/TJlSKda6FXzoEyYGjTe+vXA=='

// No backticks and no `${` below: this is a String.raw template and the JS inside must survive
// verbatim. Nor may the text `</script>` ever appear in it — it would close the injected tag early.
const WIDGET_JS = String.raw`(function () {
  if (window.__atlasFeedback) return;
  window.__atlasFeedback = true;
  var H2C_SRC = '__H2C_SRC__', H2C_SRI = '__H2C_SRI__';
  var MAX_DATA_URL = 5300000; // chars; the server's ceiling is 4 MiB of decoded PNG (~5.59M chars)

  function start() {
    var host = document.createElement('div');
    host.id = 'atlas-feedback-root';
    host.style.cssText = 'all:initial;position:fixed;right:0;bottom:0;z-index:2147483000;';
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      ':host{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace}' +
      '*{box-sizing:border-box}' +
      '.fab,.panel{position:fixed;right:max(16px,env(safe-area-inset-right));}' +
      '.fab{bottom:max(16px,env(safe-area-inset-bottom));background:#c8a05e;color:#13110b;border:0;border-radius:999px;' +
      'padding:11px 16px;font:700 11px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;' +
      'cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.35)}' +
      '.panel{bottom:calc(max(16px,env(safe-area-inset-bottom)) + 52px);width:min(340px,calc(100vw - 32px));background:#0e141b;' +
      'color:#ece7db;border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:14px;box-shadow:0 8px 32px rgba(0,0,0,.5)}' +
      '.panel[hidden]{display:none}' +
      '.t{font:700 10px/1 "IBM Plex Mono",monospace;letter-spacing:.2em;text-transform:uppercase;color:#c8a05e;margin:0 0 10px}' +
      'textarea{display:block;width:100%;height:110px;resize:vertical;background:#171f29;color:#ece7db;' +
      'border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:9px;font:14px/1.45 system-ui,sans-serif}' +
      'button:focus-visible,textarea:focus-visible{outline:2px solid #c8a05e;outline-offset:2px}' +
      '.row{display:flex;align-items:center;gap:8px;margin-top:10px}' +
      '.s{flex:1;font:11px/1.35 system-ui,sans-serif;color:#9aa5b1;min-height:15px}' +
      '.s.err{color:#e8917a}' +
      '.b{background:transparent;color:#ece7db;border:1px solid rgba(255,255,255,.22);border-radius:8px;padding:8px 12px;' +
      'font:700 10px/1 "IBM Plex Mono",monospace;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}' +
      '.b.go{background:#c8a05e;color:#13110b;border-color:#c8a05e}' +
      '.b[disabled]{opacity:.5;cursor:default}' +
      '@media print{:host{display:none}}' +
      '</style>' +
      '<button type="button" class="fab" aria-haspopup="dialog" aria-expanded="false">Feedback</button>' +
      '<div class="panel" role="dialog" aria-label="Send feedback" hidden>' +
      '<p class="t">Send feedback</p>' +
      '<textarea maxlength="2000" aria-label="What happened, or what would you change?" placeholder="What happened, or what would you change? A screenshot of this page is attached."></textarea>' +
      '<div class="row"><span class="s" role="status" aria-live="polite"></span>' +
      '<button type="button" class="b cancel">Close</button><button type="button" class="b go">Send</button></div>' +
      '</div>';

    var fab = root.querySelector('.fab');
    var panel = root.querySelector('.panel');
    var ta = root.querySelector('textarea');
    var status = root.querySelector('.s');
    var cancel = root.querySelector('.cancel');
    var go = root.querySelector('.go');
    var closeTimer = 0;

    function say(msg, isErr) { status.textContent = msg || ''; status.className = 's' + (isErr ? ' err' : ''); }
    function isOpen() { return !panel.hidden; }
    function open() {
      clearTimeout(closeTimer);
      panel.hidden = false; fab.setAttribute('aria-expanded', 'true');
      say(''); ta.focus(); loadH2C();
    }
    function close() {
      clearTimeout(closeTimer);
      panel.hidden = true; fab.setAttribute('aria-expanded', 'false'); fab.focus();
    }
    fab.addEventListener('click', function () { if (isOpen()) close(); else open(); });
    cancel.addEventListener('click', close);
    go.addEventListener('click', send);

    // Escape: capture phase on document so it runs BEFORE his handlers, then stop it there.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); e.preventDefault(); close(); }
    }, true);
    // Typing a note must not fire a keyboard shortcut in his page.
    ['keydown', 'keyup', 'keypress'].forEach(function (t) {
      host.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    // Keep Tab inside the open composer.
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); return; }
      if (e.key !== 'Tab') return;
      var f = [ta, cancel, go].filter(function (n) { return !n.disabled; });
      var i = f.indexOf(root.activeElement);
      var next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
      e.preventDefault(); f[next].focus();
    });

    function attach() { if (document.body && !host.isConnected) document.body.appendChild(host); }
    attach();
    // His mini-React re-renders; if anything ever removes the host from <body>, put it back.
    new MutationObserver(attach).observe(document.documentElement, { childList: true });
    new MutationObserver(attach).observe(document.body, { childList: true });

    var h2c = null;
    function loadH2C() {
      if (window.html2canvas) return Promise.resolve(window.html2canvas);
      if (h2c) return h2c;
      h2c = new Promise(function (resolve) {
        var s = document.createElement('script');
        var t = setTimeout(fail, 8000);
        function fail() { clearTimeout(t); h2c = null; resolve(null); }
        s.src = H2C_SRC; s.integrity = H2C_SRI; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer';
        s.onload = function () { clearTimeout(t); resolve(window.html2canvas || null); };
        s.onerror = fail;
        document.head.appendChild(s);
      });
      return h2c;
    }

    // Returns a PNG data URL, or null when there is no picture to send (never throws).
    async function capture() {
      var lib = await loadH2C();
      if (!lib) return null;
      var dpr = window.devicePixelRatio || 1;
      var scales = [Math.min(dpr, 1.5), 1, 0.6];
      var prev = host.style.display;
      host.style.display = 'none';
      try {
        for (var i = 0; i < scales.length; i++) {
          try {
            var canvas = await lib(document.body, {
              x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight,
              windowWidth: document.documentElement.clientWidth, windowHeight: window.innerHeight,
              scale: scales[i], useCORS: true, logging: false,
              ignoreElements: function (el) { return el === host; }
            });
            var url = canvas.toDataURL('image/png'); // a tainted canvas throws here
            if (url.length <= MAX_DATA_URL) return url;
          } catch (e) { return null; }
        }
        return null;
      } finally {
        host.style.display = prev;
      }
    }

    // His current view is not exposed (see the header); the first visible heading is the best proxy.
    // ⚠️ PATHNAME ONLY. This used to send the first visible h1/h2 as the "screen", which reads
    // nicely right up until the tester is a COACH — on a player file that heading IS THE STUDENT'S
    // NAME. It then lands in the Slack message TEXT, not inside the image: searchable, indexed, and
    // shown in push notifications to everyone in the channel. The screenshot already says where they
    // were, and the image is at least one deliberate act to open. A heading is not.
    function currentScreen() {
      var where = location.pathname;
      try {
        // 'view' is the LANDING view from the injected payload — a fixed token like 'today' or
        // 'roster', not page content — so it cannot carry a person's name. Safe to send; the
        // heading text that used to be here was not.
        // (No backticks in this comment: the whole widget is a TS template literal and one would
        //  close it. tsc caught that; the error read ',' expected, which does not say so.)
        var v = window.__ATLAS_DATA__ && window.__ATLAS_DATA__.view;
        if (v && /^[a-z0-9_-]{1,40}$/i.test(String(v))) return String(v) + ' (landing view; ' + where + ')';
      } catch (e) {}
      return where;
    }

    function post(payload) {
      return fetch('/api/feedback', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
    }

    var busy = false;
    async function send() {
      if (busy) return;
      var note = ta.value.trim();
      if (!note) { say('Write a note first.', true); ta.focus(); return; }
      busy = true; go.disabled = true; cancel.disabled = true;
      try {
        say('Capturing the page…');
        var shot = null;
        try { shot = await capture(); } catch (e) { shot = null; }
        say('Sending…');
        var payload = {
          note: note, screen: currentScreen(),
          url: (location.pathname + location.search).slice(0, 500),
          viewport: { w: window.innerWidth, h: window.innerHeight }
        };
        if (shot) payload.screenshot = shot;
        var res = await post(payload);
        if (res.status === 413 && shot) { delete payload.screenshot; shot = null; res = await post(payload); }
        if (res.ok) {
          var body = {};
          try { body = await res.json(); } catch (e) {}
          ta.value = '';
          say(body.screenshot === 'attached' ? 'Sent, with a screenshot. Thank you.'
            : body.screenshot === 'failed' ? 'Sent. The screenshot did not attach.'
            : 'Sent, without a screenshot. Thank you.');
          closeTimer = setTimeout(function () { if (isOpen()) close(); }, 2200);
        } else if (res.status === 401 || res.status === 403) {
          say('Your session has expired. Reload the page and sign in again. Your note is still here.', true);
        } else if (res.status === 429) {
          say('Too many reports in a short time. Try again in a few minutes. Your note is still here.', true);
        } else if (res.status === 503) {
          say('Feedback is not set up on this server.', true);
        } else {
          say('Could not send that. Your note is still here; try again.', true);
        }
      } catch (e) {
        say('Could not send. Check your connection. Your note is still here.', true);
      } finally {
        busy = false; go.disabled = false; cancel.disabled = false;
      }
    }
  }

  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();`

const WIDGET_TAG = `<script>${WIDGET_JS.replace('__H2C_SRC__', H2C_SRC).replace('__H2C_SRI__', H2C_SRI)}</script>\n`

/**
 * Insert the widget just before `</body>` (the LAST one, so a `</body>` inside a string in his
 * script is not mistaken for the real close). No `</body>` means the file is not the file we think
 * it is — append rather than throw, because losing the button is better than losing the page.
 */
export function injectFeedback(html: string): string {
  const end = html.toLowerCase().lastIndexOf('</body>')
  return end === -1 ? html + WIDGET_TAG : html.slice(0, end) + WIDGET_TAG + html.slice(end)
}
