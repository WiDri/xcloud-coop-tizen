// xCloud Co-op loader
// TizenBrew laadt dit kleine bestand (vastgezet via een tag). Het haalt bij elke start van
// de pagina de nieuwste dist/xcloud-coop.js van de main-branch op GitHub en voert die uit.
// Updaten = nieuw script naar GitHub uploaden en de module op de tv opnieuw openen.
(function () {
  'use strict';
  if (location.hostname !== 'www.xbox.com') return;
  if (!/^\/[a-zA-Z]{2}-[a-zA-Z]{2}\/play/.test(location.pathname)) return;
  if (window.__xcCoopLoader) return;
  window.__xcCoopLoader = true;

  var REPO = 'WiDri/xcloud-coop-tizen';
  var BRANCH = 'main';
  var FILE = 'dist/xcloud-coop.js';

  function fail(msg) {
    console.error('[xCloud co-op loader]', msg);
    var show = function () {
      var el = document.createElement('div');
      el.textContent = 'Co-op-script niet geladen: ' + msg;
      el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647;pointer-events:none;' +
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
      (0, eval)(code + '\n//# sourceURL=xcloud-coop.js');
    })
    .catch(function (e) {
      fail(e && e.message ? e.message : String(e));
    });
})();
