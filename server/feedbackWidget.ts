import {
  FEEDBACK_COPY,
  FEEDBACK_ENDPOINT,
  FEEDBACK_FALLBACK_SCALES,
  FEEDBACK_MAX_DATA_URL_CHARS,
  FEEDBACK_MAX_SCALE,
  FEEDBACK_NOTE_MAX,
} from '../shared/feedback'

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
 *  - `ignoreElements`'d DURING CAPTURE. The screenshot should show what the person saw, not the
 *    composer they are typing into. (It used to also hide the host; the composer now stays up while
 *    the preview renders, and the preview itself would show it if the exclusion ever failed.)
 *  - VIEWPORT-ONLY CAPTURE at a capped scale. A full-page PNG of a long dashboard on a phone
 *    (DPR 3) is tens of megabytes; the server refuses over 4 MB. The capture steps the scale down,
 *    and if it still will not fit — or the canvas is tainted, or html2canvas never loaded — the
 *    composer says so and offers a NOTE-ONLY send. A report with no picture beats no report, and a
 *    failed capture never blocks one.
 *  - ESCAPE IS CAPTURED AND SWALLOWED while the composer is open, so it does not also close one of
 *    his modals underneath. Keydown/keyup/keypress inside the widget stop propagating, so typing
 *    a note cannot trigger a shortcut in his page.
 *  - html2canvas is PINNED to 1.4.1 and carries a Subresource Integrity hash. This page runs with
 *    the tester's session cookie; an unpinned third-party script here would be a supply-chain hole.
 *    It is loaded lazily when the composer first opens, not on every page view.
 *
 * ── 🔴 PREVIEW BEFORE SEND — THIS IS THE PRIVACY CONTROL, NOT A NICETY ──────────────────────────
 * Anyone signed in may send; the tester allowlist is gone (reasoning in ./feedbackConfig). What
 * replaced it is this composer. It captures when it OPENS (or when the person asks again after
 * scrolling), shows the exact image large enough to read, says in one plain line where it goes, and
 * offers "send without screenshot". ⚠️ SEND NEVER CAPTURES. The bytes POSTed are the bytes that were
 * previewed; a capture at send time would make the preview decorative, since the page can change in
 * between. A later edit that "simplifies" this to capture-on-send, drops the copy, or removes the
 * remove-screenshot control reopens the hole the allowlist was closing: a coach's screen carries a
 * student's name, notes and intake answers. The copy lives in ../shared/feedback, shared with the
 * React button, so the two screens cannot say different things.
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

// No backticks and no dollar-brace below: this is a String.raw template and the JS inside must
// survive verbatim. (A backtick in a COMMENT closes it too; tsc then reports ',' expected, which does
// not say why.) Nor may the closing script tag ever appear in it — it would end the injected tag early.
// Copy, limits and the endpoint are NOT written here: they arrive as __FB__ from ../shared/feedback.
const WIDGET_JS = String.raw`(function () {
  if (window.__atlasFeedback) return;
  window.__atlasFeedback = true;
  var H2C_SRC = '__H2C_SRC__', H2C_SRI = '__H2C_SRI__';
  var FB = __FB__;
  var C = FB.copy;

  function start() {
    var host = document.createElement('div');
    host.id = 'atlas-feedback-root';
    host.style.cssText = 'all:initial;position:fixed;right:0;bottom:0;z-index:2147483000;';
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      ':host{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace}' +
      '*{box-sizing:border-box}[hidden]{display:none!important}' +
      '.fab,.panel{position:fixed;right:max(16px,env(safe-area-inset-right));}' +
      '.fab{bottom:max(16px,env(safe-area-inset-bottom));background:#c8a05e;color:#13110b;border:0;border-radius:999px;' +
      'padding:11px 16px;font:700 11px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;' +
      'cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.35)}' +
      '.panel{bottom:calc(max(16px,env(safe-area-inset-bottom)) + 52px);width:min(900px,calc(100vw - 32px));' +
      'max-height:calc(100vh - 100px);overflow:auto;background:#0e141b;' +
      'color:#ece7db;border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:14px;box-shadow:0 8px 32px rgba(0,0,0,.5)}' +
      '.t{font:700 10px/1 "IBM Plex Mono",monospace;letter-spacing:.2em;text-transform:uppercase;color:#c8a05e;margin:0 0 10px}' +
      'textarea{display:block;width:100%;height:90px;resize:vertical;background:#171f29;color:#ece7db;' +
      'border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:9px;font:14px/1.45 system-ui,sans-serif}' +
      'button:focus-visible,textarea:focus-visible{outline:2px solid #c8a05e;outline-offset:2px}' +
      '.pv{margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.12)}' +
      '.why{margin:0 0 8px;font:600 13px/1.4 system-ui,sans-serif;color:#ece7db}' +
      // The preview is DELIBERATELY LARGE, and shrinking it back would quietly remove the control
      // it exists to be. It replaced an allowlist: anyone may send, so the safeguard is that the
      // sender SEES what they are disclosing. At 440px wide a 1440x900 capture rendered at about
      // 0.29 scale, which makes 14px body text roughly 4px — present, unreadable, and therefore
      // consent in name only. A coach's screen carries a student's name and notes; they have to be
      // able to read it to decide.
      '.thumb{display:block;width:100%;padding:0;border:1px solid rgba(255,255,255,.22);border-radius:8px;background:#000;' +
      'cursor:zoom-in;overflow:hidden}' +
      '.thumb img{display:block;width:100%;max-height:min(60vh,560px);object-fit:contain;object-position:top left}' +
      '.warn,.pvmsg{margin:8px 0 0;font:12px/1.45 system-ui,sans-serif;color:#9aa5b1}' +
      '.pvmsg.err{color:#e8917a}' +
      '.row2{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}' +
      '.row{display:flex;align-items:center;gap:8px;margin-top:12px}' +
      '.s{flex:1;font:11px/1.35 system-ui,sans-serif;color:#9aa5b1;min-height:15px}' +
      '.s.err{color:#e8917a}' +
      '.b{background:transparent;color:#ece7db;border:1px solid rgba(255,255,255,.22);border-radius:8px;padding:8px 12px;' +
      'font:700 10px/1 "IBM Plex Mono",monospace;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}' +
      '.b.go{background:#c8a05e;color:#13110b;border-color:#c8a05e}' +
      '.b.go.noimg{background:transparent;color:#c8a05e}' +
      '.b[disabled]{opacity:.5;cursor:default}' +
      '.zoom{position:fixed;inset:0;overflow:auto;padding:16px;background:rgba(8,10,14,.9);cursor:zoom-out}' +
      '.zoom img{display:block;margin:0 auto;max-width:100%;height:auto;background:#000}' +
      '@media print{:host{display:none}}' +
      '</style>' +
      '<button type="button" class="fab" aria-haspopup="dialog" aria-expanded="false"></button>' +
      '<div class="panel" role="dialog" hidden>' +
      '<p class="t"></p>' +
      '<textarea></textarea>' +
      '<div class="pv">' +
      '<p class="why" hidden></p>' +
      '<button type="button" class="thumb" hidden><img alt=""></button>' +
      '<p class="warn" hidden></p>' +
      '<p class="pvmsg" role="status" aria-live="polite"></p>' +
      '<div class="row2"><button type="button" class="b recap"></button><button type="button" class="b rm"></button></div>' +
      '</div>' +
      '<div class="row"><span class="s" role="status" aria-live="polite"></span>' +
      '<button type="button" class="b cancel"></button><button type="button" class="b go"></button></div>' +
      '</div>' +
      '<div class="zoom" role="dialog" tabindex="-1" hidden><img alt=""></div>';

    var fab = root.querySelector('.fab');
    var panel = root.querySelector('.panel');
    var title = root.querySelector('.t');
    var ta = root.querySelector('textarea');
    var why = root.querySelector('.why');
    var thumb = root.querySelector('.thumb');
    var img = root.querySelector('.thumb img');
    var warn = root.querySelector('.warn');
    var pvmsg = root.querySelector('.pvmsg');
    var recap = root.querySelector('.recap');
    var rm = root.querySelector('.rm');
    var status = root.querySelector('.s');
    var cancel = root.querySelector('.cancel');
    var go = root.querySelector('.go');
    var zoom = root.querySelector('.zoom');
    var zimg = root.querySelector('.zoom img');
    var closeTimer = 0;

    // All copy is set as text, never as markup, so none of it can be read as HTML.
    fab.textContent = C.fab;
    panel.setAttribute('aria-label', C.title);
    title.textContent = C.title;
    ta.maxLength = FB.noteMax;
    ta.setAttribute('aria-label', C.noteLabel);
    ta.placeholder = C.notePlaceholder;
    why.textContent = C.whereItGoes;
    warn.textContent = C.othersWarning + ' ' + C.zoomHint;
    cancel.textContent = C.close;
    zoom.setAttribute('aria-label', C.zoomClose);
    thumb.setAttribute('aria-label', C.zoomHint);
    img.alt = C.whereItGoes;
    zimg.alt = C.whereItGoes;

    // PREVIEW STATE. 'capturing' | 'ready' | 'failed' | 'off' (the person chose to send without).
    // shot is the data URL that was SHOWN, and it is the only thing send() will ever attach.
    var shotState = 'capturing', shot = null, failKey = 'captureFailed', token = 0, busy = false;

    function say(msg, isErr) { status.textContent = msg || ''; status.className = 's' + (isErr ? ' err' : ''); }
    function isOpen() { return !panel.hidden; }

    function render() {
      var ready = shotState === 'ready';
      why.hidden = !ready; thumb.hidden = !ready; warn.hidden = !ready;
      pvmsg.className = 'pvmsg';
      if (shotState === 'capturing') pvmsg.textContent = C.capturing;
      else if (shotState === 'failed') { pvmsg.textContent = C[failKey] || C.captureFailed; pvmsg.className = 'pvmsg err'; }
      else if (shotState === 'off') pvmsg.textContent = C.noImage;
      else pvmsg.textContent = '';
      recap.hidden = shotState === 'capturing';
      recap.textContent = ready ? C.recapture : shotState === 'failed' ? C.retryCapture : C.attachShot;
      rm.hidden = !(ready || shotState === 'capturing');
      rm.textContent = C.removeShot;
      go.textContent = ready ? C.sendWithShot : C.sendNoteOnly;
      go.className = 'b go' + (ready ? '' : ' noimg');
      go.disabled = busy || shotState === 'capturing';
      cancel.disabled = busy; recap.disabled = busy; rm.disabled = busy;
    }

    function startCapture() {
      var mine = ++token;
      shot = null; shotState = 'capturing'; render();
      capture().then(function (r) {
        if (mine !== token) return; // superseded, cancelled, or the composer was closed
        if (r.url) { shot = r.url; img.src = shot; zimg.src = shot; shotState = 'ready'; }
        else { failKey = r.err; shotState = 'failed'; }
        render();
      }, function () {
        if (mine !== token) return;
        failKey = 'captureFailed'; shotState = 'failed'; render();
      });
    }
    function dropShot() {
      token++; shot = null; img.removeAttribute('src'); zimg.removeAttribute('src'); closeZoom();
    }
    function open() {
      clearTimeout(closeTimer);
      panel.hidden = false; fab.setAttribute('aria-expanded', 'true');
      say(''); ta.focus(); loadH2C(); startCapture();
    }
    function close() {
      clearTimeout(closeTimer);
      dropShot(); shotState = 'off';
      panel.hidden = true; fab.setAttribute('aria-expanded', 'false'); fab.focus();
    }
    function openZoom() { if (!shot) return; zoom.hidden = false; zoom.focus(); }
    function closeZoom() { if (zoom.hidden) return; zoom.hidden = true; if (isOpen() && !thumb.hidden) thumb.focus(); }

    fab.addEventListener('click', function () { if (isOpen()) close(); else open(); });
    cancel.addEventListener('click', close);
    go.addEventListener('click', send);
    recap.addEventListener('click', startCapture);
    rm.addEventListener('click', function () { dropShot(); shotState = 'off'; render(); recap.focus(); });
    thumb.addEventListener('click', openZoom);
    zoom.addEventListener('click', closeZoom);
    zoom.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') e.preventDefault(); // nothing else to reach while the preview is up
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeZoom(); }
    });

    // Escape: capture phase on document so it runs BEFORE his handlers, then stop it there. It closes
    // the full-size preview first, then the composer.
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!zoom.hidden) { e.stopPropagation(); e.preventDefault(); closeZoom(); return; }
      if (isOpen()) { e.stopPropagation(); e.preventDefault(); close(); }
    }, true);
    // Typing a note must not fire a keyboard shortcut in his page.
    ['keydown', 'keyup', 'keypress'].forEach(function (t) {
      host.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    // Keep Tab inside the open composer.
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!go.disabled) send(); return; }
      if (e.key !== 'Tab') return;
      var f = [ta, thumb, recap, rm, cancel, go].filter(function (n) { return !n.disabled && n.getClientRects().length > 0; });
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

    // Resolves { url } on success or { err } naming a key in the shared copy. Never rejects.
    // Called ONLY from startCapture (composer open, or the person pressing re-capture); send() never
    // calls it, so what is posted is what was previewed.
    async function capture() {
      var lib = await loadH2C();
      if (!lib) return { err: 'libFailed' };
      var first = Math.min(window.devicePixelRatio || 1, FB.maxScale);
      var scales = [first].concat(FB.fallbackScales.filter(function (s) { return s < first; }));
      var tooBig = false;
      for (var i = 0; i < scales.length; i++) {
        try {
          var canvas = await lib(document.body, {
            x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight,
            windowWidth: document.documentElement.clientWidth, windowHeight: window.innerHeight,
            scale: scales[i], useCORS: true, logging: false,
            ignoreElements: function (el) { return el === host; }
          });
          var url = canvas.toDataURL('image/png'); // a tainted canvas throws here
          if (url.length <= FB.maxDataUrl) return { url: url };
          tooBig = true;
        } catch (e) { return { err: 'captureFailed' }; }
      }
      return { err: tooBig ? 'captureTooLarge' : 'captureFailed' };
    }

    // His current view is not exposed (see the header). PATHNAME ONLY, never page text.
    // This used to send the first visible h1/h2 as the "screen", which reads nicely right up until
    // the tester is a COACH: on a player file that heading IS THE STUDENT'S NAME. It then lands in
    // the Slack message TEXT, not inside the image: searchable, indexed, and shown in push
    // notifications to everyone in the channel. The screenshot already says where they were, and the
    // image is at least one deliberate act to open. A heading is not.
    function currentScreen() {
      var where = location.pathname;
      try {
        // 'view' is the LANDING view from the injected payload: a fixed token like 'today' or
        // 'roster', not page content, so it cannot carry a person's name. Safe to send; the
        // heading text that used to be here was not.
        // (No backticks in this comment: the whole widget is a TS template literal and one would
        //  close it. tsc caught that; the error read ',' expected, which does not say so.)
        var v = window.__ATLAS_DATA__ && window.__ATLAS_DATA__.view;
        if (v && /^[a-z0-9_-]{1,40}$/i.test(String(v))) return String(v) + ' (landing view; ' + where + ')';
      } catch (e) {}
      return where;
    }

    function post(payload) {
      return fetch(FB.endpoint, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
    }

    async function send() {
      if (busy || shotState === 'capturing') return;
      var note = ta.value.trim();
      if (!note) { say(C.writeNote, true); ta.focus(); return; }
      busy = true; render();
      try {
        say(C.sending);
        // The pathname only, never the query string: it can carry an address (the ?as= demo link).
        var payload = {
          note: note, screen: currentScreen(),
          url: location.pathname.slice(0, 500),
          viewport: { w: window.innerWidth, h: window.innerHeight }
        };
        // Attach ONLY the image that is on screen in the preview. No capture here.
        var attached = shotState === 'ready' && !!shot;
        if (attached) payload.screenshot = shot;
        var res = await post(payload);
        // Too large for the server: send the note alone. The status line says so afterwards.
        if (res.status === 413 && attached) { delete payload.screenshot; attached = false; res = await post(payload); }
        if (res.ok) {
          var body = {};
          try { body = await res.json(); } catch (e) {}
          ta.value = '';
          say(body.screenshot === 'attached' ? C.sentWithShot
            : body.screenshot === 'failed' ? C.sentShotFailed
            : C.sentNoShot);
          closeTimer = setTimeout(function () { if (isOpen()) close(); }, 2200);
        } else if (res.status === 401 || res.status === 403) {
          say(C.sessionExpired, true);
        } else if (res.status === 429) {
          say(C.rateLimited, true);
        } else if (res.status === 503) {
          say(C.unavailable, true);
        } else {
          say(C.failed, true);
        }
      } catch (e) {
        say(C.offline, true);
      } finally {
        busy = false; render();
      }
    }

    render();
  }

  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();`

/**
 * Everything the widget needs from ../shared/feedback, serialised into the script. `<` is escaped so
 * no value can ever spell a closing script tag. The replacers are FUNCTIONS: a string replacement
 * would interpret dollar-sequences in the value.
 */
const FB_JSON = JSON.stringify({
  endpoint: FEEDBACK_ENDPOINT,
  noteMax: FEEDBACK_NOTE_MAX,
  maxDataUrl: FEEDBACK_MAX_DATA_URL_CHARS,
  maxScale: FEEDBACK_MAX_SCALE,
  fallbackScales: FEEDBACK_FALLBACK_SCALES,
  copy: FEEDBACK_COPY,
}).replace(/</g, '\\u003c')

export const WIDGET_SOURCE = WIDGET_JS
  .replace('__H2C_SRC__', () => H2C_SRC)
  .replace('__H2C_SRI__', () => H2C_SRI)
  .replace('__FB__', () => FB_JSON)

const WIDGET_TAG = `<script>${WIDGET_SOURCE}</script>\n`

/**
 * Insert the widget just before `</body>` (the LAST one, so a `</body>` inside a string in his
 * script is not mistaken for the real close). No `</body>` means the file is not the file we think
 * it is — append rather than throw, because losing the button is better than losing the page.
 */
export function injectFeedback(html: string): string {
  const end = html.toLowerCase().lastIndexOf('</body>')
  return end === -1 ? html + WIDGET_TAG : html.slice(0, end) + WIDGET_TAG + html.slice(end)
}
