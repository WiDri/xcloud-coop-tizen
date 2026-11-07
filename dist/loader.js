// xCloud Co-op loader (2.3)
// 0. Nieuwe site (play.xbox.com, "preview"): Microsoft stuurt gemigreerde accounts daarheen,
//    maar die site werkt niet in de browser van oudere Samsung-tv's (Chromium 85).
//    Daarom via de officiële uitgang /migration/clear terug naar de klassieke site.
//    Lukt dat niet (2x binnen 5 minuten weer hier), dan polyfills laden zodat de nieuwe
//    site in elk geval werkt (zonder co-op).
(function () {
  'use strict';
  if (location.hostname !== 'play.xbox.com') return;
  if (window.__xcPreviewHandled) return;
  window.__xcPreviewHandled = true;

  var KEY = 'xcCoop.leavePreview';
  var CLASSIC = 'https://www.xbox.com/nl-NL/play';
  var now = Date.now(), tries = [];
  try { tries = JSON.parse(window.sessionStorage.getItem(KEY) || '[]').filter(function (t) { return now - t < 300000; }); } catch (e) {}

  if (tries.length < 2 && location.pathname.indexOf('/migration/') !== 0) {
    tries.push(now);
    try { window.sessionStorage.setItem(KEY, JSON.stringify(tries)); } catch (e) {}
    location.replace('https://play.xbox.com/migration/clear?returnUrl=' + encodeURIComponent(CLASSIC));
    return;
  }

  // Terug lukt niet: nieuwe site laten werken op Chromium 85
  var log = [];
  if (typeof window.structuredClone !== 'function') {
    window.structuredClone = function structuredClone(value) {
      var seen = new Map();
      function clone(v) {
        if (v === null || typeof v !== 'object') {
          if (typeof v === 'function' || typeof v === 'symbol') throw new DOMException('could not be cloned', 'DataCloneError');
          return v;
        }
        if (seen.has(v)) return seen.get(v);
        // Net als de echte structuredClone: pagina-elementen, vensters, events e.d. zijn niet te kopiëren
        if ((typeof Node !== 'undefined' && v instanceof Node) || v === window || (typeof Event !== 'undefined' && v instanceof Event) ||
            v instanceof Promise || v instanceof WeakMap || v instanceof WeakSet) {
          throw new DOMException('could not be cloned', 'DataCloneError');
        }
        var out;
        if (v instanceof Date) out = new Date(v.getTime());
        else if (v instanceof RegExp) out = new RegExp(v.source, v.flags);
        else if (v instanceof Map) { out = new Map(); seen.set(v, out); v.forEach(function (val, key) { out.set(clone(key), clone(val)); }); return out; }
        else if (v instanceof Set) { out = new Set(); seen.set(v, out); v.forEach(function (val) { out.add(clone(val)); }); return out; }
        else if (v instanceof ArrayBuffer) out = v.slice(0);
        else if (ArrayBuffer.isView(v)) out = new v.constructor(clone(v.buffer), v.byteOffset, v.length !== undefined ? v.length : v.byteLength);
        else if (v instanceof Blob) return v;
        else if (Array.isArray(v)) { out = new Array(v.length); seen.set(v, out); for (var i = 0; i < v.length; i++) out[i] = clone(v[i]); return out; }
        else if (v instanceof Error) { out = new v.constructor(v.message); out.name = v.name; out.stack = v.stack; }
        else {
          out = {};
          seen.set(v, out);
          Object.keys(v).forEach(function (k) { if (typeof v[k] !== 'function') out[k] = clone(v[k]); });
          return out;
        }
        seen.set(v, out);
        return out;
      }
      return clone(value);
    };
    log.push('structuredClone');
  }
  function def(obj, name, fn) {
    if (!obj[name]) { Object.defineProperty(obj, name, { value: fn, writable: true, configurable: true }); log.push(name); }
  }
  function at(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; return n < 0 || n >= this.length ? undefined : this[n]; }
  def(Array.prototype, 'at', at);
  def(String.prototype, 'at', at);
  [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array].forEach(function (T) { def(T.prototype, 'at', at); });
  def(Object, 'hasOwn', function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); });
  def(Array.prototype, 'findLast', function (f, t) { for (var i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return this[i]; });
  def(Array.prototype, 'findLastIndex', function (f, t) { for (var i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return i; return -1; });
  if (window.crypto && !crypto.randomUUID) def(crypto, 'randomUUID', function () {
    var b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = [].map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  });
  if (window.AbortController && !('reason' in AbortSignal.prototype)) {
    var nativeAbort = AbortController.prototype.abort;
    AbortController.prototype.abort = function (reason) {
      var sig = this.signal;
      if (!sig.aborted && reason !== undefined) Object.defineProperty(sig, '__xcReason', { value: reason, configurable: true });
      return nativeAbort.call(this);
    };
    Object.defineProperty(AbortSignal.prototype, 'reason', {
      configurable: true,
      get: function () {
        if (!this.aborted) return undefined;
        if (this.__xcReason === undefined) Object.defineProperty(this, '__xcReason', { value: new DOMException('signal is aborted without reason', 'AbortError'), configurable: true });
        return this.__xcReason;
      }
    });
    log.push('AbortSignal.reason');
  }
  if (window.AbortSignal && !AbortSignal.abort) def(AbortSignal, 'abort', function (reason) { var c = new AbortController(); c.abort(reason); return c.signal; });
  if (window.AbortSignal && !AbortSignal.any) def(AbortSignal, 'any', function (signals) {
    var c = new AbortController();
    for (var i = 0; i < signals.length; i++) if (signals[i].aborted) { c.abort(signals[i].reason); return c.signal; }
    [].forEach.call(signals, function (s) { s.addEventListener('abort', function () { c.abort(s.reason); }, { once: true }); });
    return c.signal;
  });
  if (window.AbortSignal && !AbortSignal.timeout) def(AbortSignal, 'timeout', function (ms) { var c = new AbortController(); setTimeout(function () { c.abort(new DOMException('signal timed out', 'TimeoutError')); }, ms); return c.signal; });
  if (window.AbortSignal && !AbortSignal.prototype.throwIfAborted) def(AbortSignal.prototype, 'throwIfAborted', function () { if (this.aborted) throw this.reason; });
  // Chromium 85 geeft bij getGamepads() een GamepadList; de nieuwe site verwacht een Array
  if (navigator.getGamepads && !Array.isArray(navigator.getGamepads())) {
    var nativeGetGamepads = navigator.getGamepads.bind(navigator);
    Object.defineProperty(navigator, 'getGamepads', {
      value: function getGamepads() { return Array.prototype.slice.call(nativeGetGamepads()); },
      writable: true, configurable: true
    });
    log.push('getGamepads-array');
  }
  window.__xcPolyfills = log;
  console.log('[xCloud co-op loader] nieuwe site: terug naar klassiek lukt niet, polyfills geladen: ' + log.join(', '));
})();

// (bestaande loader voor de klassieke site, ongewijzigd)
// 1. Voert direct (synchroon) de laatst bewaarde versie van het script uit, zodat het
//    script zo vroeg mogelijk draait, nog voordat xCloud zelf opstart.
// 2. Haalt daarna de nieuwste dist/xcloud-coop.js van GitHub op en bewaart die voor de
//    volgende keer. Was er nog niets bewaard, dan wordt de gedownloade versie meteen uitgevoerd.
// Updaten = nieuw script naar GitHub uploaden en de module op de tv twee keer openen
// (eerste keer downloaden, tweede keer draait de nieuwe versie).
(function () {
  'use strict';
  if (location.hostname !== 'www.xbox.com') return;
  if (!/^\/[a-zA-Z]{2}-[a-zA-Z]{2}\/play/.test(location.pathname)) return;
  if (window.__xcCoopLoader) return;
  window.__xcCoopLoader = true;

  var REPO = 'WiDri/xcloud-coop-tizen';
  var BRANCH = 'main';
  var FILE = 'dist/xcloud-coop.js';
  var KEY = 'xcCoop.cachedScript';

  var ranCached = false;
  try {
    var cached = window.localStorage.getItem(KEY);
    if (cached) {
      (0, eval)(cached + '\n//# sourceURL=xcloud-coop-cached.js');
      ranCached = true;
    }
  } catch (e) {
    console.error('[xCloud co-op loader] bewaarde versie mislukt', e);
  }

  function note(msg) {
    var show = function () {
      var el = document.createElement('div');
      el.textContent = msg;
      el.style.cssText = 'position:fixed;left:48px;top:60px;z-index:2147483647;pointer-events:none;' +
        'background:rgba(16,124,16,.9);color:#fff;font:600 14px/1.3 system-ui,sans-serif;padding:6px 10px;border-radius:5px';
      document.documentElement.appendChild(el);
      setTimeout(function () { el.remove(); }, 8000);
    };
    if (document.documentElement && document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  }

  function fail(msg) {
    console.error('[xCloud co-op loader]', msg);
    var show = function () {
      var el = document.createElement('div');
      el.textContent = 'Co-op-script niet geladen: ' + msg;
      el.style.cssText = 'position:fixed;left:48px;top:60px;z-index:2147483647;pointer-events:none;' +
        'background:rgba(180,0,0,.85);color:#fff;font:600 14px/1.3 system-ui,sans-serif;padding:6px 10px;border-radius:5px';
      document.documentElement.appendChild(el);
      setTimeout(function () { el.remove(); }, 10000);
    };
    if (document.documentElement) show(); else document.addEventListener('DOMContentLoaded', show);
  }

  function getText(url, headers) {
    return fetch(url, { cache: 'no-store', headers: headers || {} }).then(function (r) {
      if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
      return r.text();
    });
  }

  // 1) nieuwste commit opvragen en het script van precies die commit laden (nooit verouderd)
  // 2) lukt de GitHub-API niet (bijv. limiet van 60 per uur), dan raw van main met cache-buster
  // 3) als laatste redmiddel jsDelivr
  getText('https://api.github.com/repos/' + REPO + '/commits/' + BRANCH, { Accept: 'application/vnd.github.sha' })
    .then(function (sha) {
      sha = sha.trim();
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('onverwacht antwoord van GitHub-API');
      return getText('https://raw.githubusercontent.com/' + REPO + '/' + sha + '/' + FILE);
    })
    .catch(function (e) {
      console.warn('[xCloud co-op loader] API-route mislukt, probeer raw', e);
      return getText('https://raw.githubusercontent.com/' + REPO + '/' + BRANCH + '/' + FILE + '?t=' + Date.now());
    })
    .catch(function (e) {
      console.warn('[xCloud co-op loader] raw mislukt, probeer jsDelivr', e);
      return getText('https://cdn.jsdelivr.net/gh/' + REPO + '@' + BRANCH + '/' + FILE);
    })
    .then(function (code) {
      var changed = true;
      try {
        changed = window.localStorage.getItem(KEY) !== code;
        if (changed) window.localStorage.setItem(KEY, code);
      } catch (e) { console.warn('[xCloud co-op loader] kon script niet bewaren', e); }
      if (!ranCached) {
        (0, eval)(code + '\n//# sourceURL=xcloud-coop.js');
      } else if (changed) {
        note('Nieuwe co-op-versie gedownload: open de module opnieuw');
      }
    })
    .catch(function (e) {
      fail(e && e.message ? e.message : String(e));
    });
})();
