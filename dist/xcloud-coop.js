// ==UserScript==
// @name         xCloud Co-op (Tizen)
// @description  Alleen lokale co-op (meerdere controllers) voor xbox.com/play. Gebaseerd op de co-op-patch van Better xCloud (MIT, © redphx).
// @version      3.7.0
// @match        https://www.xbox.com/*/play*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  if (location.hostname !== 'www.xbox.com') return;
  if (!/^\/[a-zA-Z]{2}-[a-zA-Z]{2}\/play/.test(location.pathname)) return;
  if (window.__xcCoop) return;
  window.__xcCoop = true;

  var VERSION = '3.7.0';
  var TAG = '[xCloud co-op]';
  function log() { console.log.apply(console, [TAG].concat([].slice.call(arguments))); }

  // ---------------------------------------------------------------------------
  // Kleine melding in beeld (op een tv heb je geen console)
  // ---------------------------------------------------------------------------
  var toastTimer = null;
  function toast(text) {
    var show = function () {
      var el = document.getElementById('xc-coop-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'xc-coop-toast';
        el.style.cssText = 'position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:2147483647;' +
          'background:rgba(16,124,16,.92);color:#fff;font:600 20px/1.3 system-ui,sans-serif;' +
          'padding:10px 18px;border-radius:8px;pointer-events:none;transition:opacity .4s';
        document.documentElement.appendChild(el);
      }
      el.textContent = text;
      el.style.opacity = '1';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { el.style.opacity = '0'; }, 4000);
    };
    if (document.documentElement) show(); else document.addEventListener('DOMContentLoaded', show);
  }

  function connectedPads() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var out = [];
    for (var i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) out.push(pads[i]);
    return out;
  }

  window.addEventListener('gamepadconnected', function (e) {
    if (e.gamepad && e.gamepad._xcSilent) return;
    toast('Controller ' + (e.gamepad.index + 1) + ' verbonden (' + connectedPads().length + ' totaal)');
  });

  // ---------------------------------------------------------------------------
  // 1. Patch die in de inputmanager van xCloud wordt geïnjecteerd.
  //    Draait als `this` = de inputmanager, binnen de scope van de webpack-module.
  //    Origineel: elke controller wordt als GamepadIndex 0 doorgestuurd.
  //    Na patch: het echte controllernummer gaat naar de server.
  // ---------------------------------------------------------------------------
  function installCoop() {
    try {
      var self = this;
      var strip = function (s) { return s.indexOf('function ') === 0 ? s.substring(9) : s; };

      var changedStr = strip(self.onGamepadChanged.toString()).split('0').join('arguments[1]');
      var inputStr = strip(self.onGamepadInput.toString());
      var m = inputStr.match(/(\w+\.GamepadIndex)/);
      if (!m) { console.error('[xCloud co-op] GamepadIndex niet gevonden, patch niet toegepast'); return; }
      inputStr = inputStr.replace('this.gamepadStates.get(', 'this.gamepadStates.get(' + m[0] + ',');

      // eval hier (niet elders) zodat module-variabelen uit de originele functies bereikbaar blijven
      var patchedChanged = eval('(function ' + changedStr + ')');
      var patchedInput = eval('(function ' + inputStr + ')');

      window.__xcCoopEnable = function () {
        if (self.__xcEnabled) return false;
        self.__xcEnabled = true;
        self.onGamepadChanged = patchedChanged;
        self.onGamepadInput = patchedInput;
        // Controllers 2+ opnieuw aanmelden zodat ze met hun eigen nummer worden geregistreerd.
        // Controller 1 (index 0) slaan we over: die stond al goed, en hem afmelden laat
        // xCloud het scherm "sluit een controller aan" tonen.
        var pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (var i = 0; i < pads.length; i++) {
          var p = pads[i];
          if (!p || !p.connected || p.index === 0) continue;
          try { p._xcSilent = true; } catch (e) {}
          window.dispatchEvent(new GamepadEvent('gamepaddisconnected', { gamepad: p }));
          window.dispatchEvent(new GamepadEvent('gamepadconnected', { gamepad: p }));
        }
        return true;
      };
      // Xbox-knop (Nexus) nabootsen: op Tizen vangt de tv de echte Xbox-knop zelf af
      window.__xcSendNexus = function (padIndex) {
        var idx = self.__xcEnabled ? padIndex : 0;
        var base = { GamepadIndex: idx, A: 0, B: 0, X: 0, Y: 0, LeftShoulder: 0, RightShoulder: 0,
          LeftTrigger: 0, RightTrigger: 0, View: 0, Menu: 0, LeftThumb: 0, RightThumb: 0,
          DPadUp: 0, DPadDown: 0, DPadLeft: 0, DPadRight: 0, Nexus: 1,
          LeftThumbXAxis: 0, LeftThumbYAxis: 0, RightThumbXAxis: 0, RightThumbYAxis: 0,
          PhysicalPhysicality: 0, VirtualPhysicality: 0, Dirty: true, Virtual: false };
        self.onGamepadInput(performance.now(), [base]);
        setTimeout(function () {
          var up = Object.assign({}, base, { Nexus: 0 });
          self.onGamepadInput(performance.now(), [up]);
        }, 150);
      };
      console.log('[xCloud co-op] inputmanager gepatcht');
    } catch (err) {
      console.error('[xCloud co-op] patch mislukt', err);
    }
  }

  var MARKER = 'this.gamepadMappingsToSend=[],';
  var INJECT = 'true;(' + installCoop.toString() + ').call(this);true,';
  var patched = false; // co-op-patch toegepast
  var PATCHES = [
    { name: 'coop', find: MARKER, apply: function (src) { return src.replace(MARKER, MARKER + INJECT); } }
  ];
  var donePatches = {};

  function rebuild(src) {
    if (/^\d+\s*\(/.test(src)) return '(function ' + src.replace(/^\d+/, '') + ')';      // 123(e,t,n){...}
    if (/^function[\s(]/.test(src)) return '(' + src + ')';                              // function(e,t,n){...}
    if (/^[\w$]+\s*\(/.test(src)) return '(function ' + src.replace(/^[\w$]+/, '') + ')'; // naam(e,t,n){...}
    return '(' + src + ')';                                                                // (e,t,n)=>{...}
  }

  function patchModules(modules) {
    if (!modules) return;
    var todo = PATCHES.filter(function (p) { return !donePatches[p.name]; });
    if (!todo.length) return;
    for (var id in modules) {
      var fn = modules[id];
      if (typeof fn !== 'function') continue;
      var src = fn.toString();
      var applied = [];
      for (var i = 0; i < todo.length; i++) {
        if (!donePatches[todo[i].name] && src.indexOf(todo[i].find) >= 0) {
          src = todo[i].apply(src);
          applied.push(todo[i].name);
        }
      }
      if (!applied.length) continue;
      try {
        modules[id] = (0, eval)(rebuild(src));
        applied.forEach(function (n) { donePatches[n] = true; });
        if (donePatches.coop) patched = true;
        log('module ' + id + ' gepatcht: ' + applied.join(', '));
      } catch (err) {
        console.error(TAG, 'kon module ' + id + ' niet herschrijven', err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Webpack-chunks onderscheppen voordat ze worden uitgevoerd.
  //    a) Vroeg geladen: webpack registreert zijn chunk-handler met fn.bind(null, 0)
  //       en fn.bind(null, push); daar haken we in.
  //    b) Laat geladen (TizenBrew injecteert soms pas na de start van de pagina):
  //       de push-functie van de bestaande webpackChunk-arrays wordt omwikkeld,
  //       zodat later geladen chunks (zoals de streampagina) alsnog gepatcht worden.
  // ---------------------------------------------------------------------------
  function isChunk(item) {
    return Array.isArray(item) && item.length >= 2 && item[1] && typeof item[1] === 'object';
  }

  var nativeBind = Function.prototype.bind;
  Function.prototype.bind = function () {
    var valid = this.name.length <= 2 && arguments.length === 2 && arguments[0] === null &&
      (arguments[1] === 0 || typeof arguments[1] === 'function');
    if (!valid) return nativeBind.apply(this, arguments);
    if (typeof arguments[1] === 'function') Function.prototype.bind = nativeBind;
    var orgFunc = this;
    var wrapped = function (a, item) {
      try { if (isChunk(item)) patchModules(item[1]); } catch (e) { console.error(TAG, e); }
      return orgFunc.apply(this, arguments);
    };
    return nativeBind.apply(wrapped, arguments);
  };
  // Vangnet: na 20 s de originele bind sowieso terugzetten
  setTimeout(function () { if (Function.prototype.bind !== nativeBind) Function.prototype.bind = nativeBind; }, 20000);

  function hookChunkArrays() {
    for (var key in window) {
      if (key.indexOf('webpackChunk') !== 0) continue;
      var arr;
      try { arr = window[key]; } catch (e) { continue; }
      if (!Array.isArray(arr) || (arr.push && arr.push.__xc)) continue;
      var orgPush = arr.push;
      arr.push = function () {
        for (var i = 0; i < arguments.length; i++) {
          try { if (isChunk(arguments[i])) patchModules(arguments[i][1]); } catch (e) { console.error(TAG, e); }
        }
        return orgPush.apply(this, arguments);
      };
      arr.push.__xc = true;
      log('chunk-array ' + key + ' gekoppeld');
    }
  }
  hookChunkArrays();
  // webpack kan zijn push later nog vervangen; een poosje blijven controleren
  var hookChecks = 0;
  var hookTimer = setInterval(function () {
    hookChunkArrays();
    if (++hookChecks > 120 || patched) clearInterval(hookTimer);
  }, 500);

  // ---------------------------------------------------------------------------
  // 3. Streamconfiguratie: betrouwbare input aanzetten (zoals Better xCloud bij co-op)
  // ---------------------------------------------------------------------------
  var nativeFetch = window.fetch;
  window.fetch = async function (request, init) {
    var url = typeof request === 'string' ? request : (request && request.url) || '';
    var method = ((init && init.method) || (request && request.method) || 'GET').toUpperCase();
    if (method !== 'GET' || !/\/configuration$/.test(url) || url.indexOf('/sessions/') < 0) {
      return nativeFetch.apply(this, arguments);
    }
    var response = await nativeFetch.apply(this, arguments);
    try {
      var text = await response.clone().text();
      if (!text) return response;
      var obj = JSON.parse(text);
      var overrides = JSON.parse(obj.clientStreamingConfigOverrides || '{}') || {};
      overrides.inputConfiguration = overrides.inputConfiguration || {};
      overrides.inputConfiguration.useUnreliableInput = false;
      obj.clientStreamingConfigOverrides = JSON.stringify(overrides);
      var body = JSON.stringify(obj);
      response.json = function () { return Promise.resolve(obj); };
      response.text = function () { return Promise.resolve(body); };
      log('streamconfiguratie aangepast');
    } catch (err) {
      console.error(TAG, 'configuratie niet aangepast', err);
    }
    return response;
  };

  // ---------------------------------------------------------------------------
  // Nagebootste Xbox-knop (gebruikt door "Xbox-menu" in het co-op-menu).
  // De tv vangt de echte Xbox/PS-knop af, dus we laten xCloud even denken dat
  // knop 16 (Xbox-knop) wordt ingedrukt. Options lang vasthouden doet xCloud zelf al.
  // ---------------------------------------------------------------------------
  var nativeGetGamepads = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : function () { return []; };
  var NEXUS_MS = 200;
  var forceNexusUntil = {};

  function btn(pressed) { return { pressed: pressed, touched: pressed, value: pressed ? 1 : 0 }; }

  function withNexus(p) {
    var buttons = [];
    for (var b = 0; b < p.buttons.length; b++) buttons.push(p.buttons[b]);
    while (buttons.length < 17) buttons.push(btn(false));
    buttons[16] = btn(true);
    buttons[8] = btn(false);   // View/Share loslaten zodat de game niets extra's doet
    buttons[9] = btn(false);   // Menu/Options idem
    return {
      id: p.id, index: p.index, connected: p.connected, mapping: p.mapping,
      timestamp: performance.now(), axes: p.axes, buttons: buttons,
      vibrationActuator: p.vibrationActuator, hapticActuators: p.hapticActuators
    };
  }

  // De vervangende getGamepads wordt alleen tijdens de 0,2 s nep-Xbox-knop actief gezet,
  // zodat xCloud de rest van de tijd de echte, ongewijzigde functie ziet.
  function idlePad(p) {
    var buttons = [], axes = [];
    for (var b = 0; b < p.buttons.length; b++) buttons.push(btn(false));
    for (var a = 0; a < p.axes.length; a++) axes.push(0);
    return { id: p.id, index: p.index, connected: p.connected, mapping: p.mapping,
      timestamp: p.timestamp, axes: axes, buttons: buttons };
  }
  var testerOpen = false;
  var cursorOn = false;
  var menuOpen = false;
  function inputBlocked() { return testerOpen || cursorOn || menuOpen; }
  // Options-knop: kort drukken = gewone Options (pauze in de game),
  // 3 seconden vasthouden = Xbox-menu. Zolang Options ingedrukt is, houdt het script
  // de knop even voor xCloud achter; bij loslaten binnen 3 s wordt hij alsnog als
  // korte druk doorgegeven. Zo opent de game niet ook nog zijn eigen pauzemenu.
  var OPT_HOLD_MS = 3000, OPT_REPLAY_MS = 150;
  var opt = {};   // per controller: { down, fired, hint, replayUntil }

  function withButtons(p, changes) {
    var buttons = [];
    for (var b = 0; b < p.buttons.length; b++) buttons.push(p.buttons[b]);
    for (var k in changes) buttons[k] = btn(changes[k]);
    return { id: p.id, index: p.index, connected: p.connected, mapping: p.mapping,
      timestamp: performance.now(), axes: p.axes, buttons: buttons,
      vibrationActuator: p.vibrationActuator, hapticActuators: p.hapticActuators };
  }

  function patchedGetGamepads() {
    var pads = nativeGetGamepads();
    var now = Date.now();
    var out = [];
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (!p || !p.connected) { out.push(p); continue; }
      if (inputBlocked()) { out.push(idlePad(p)); continue; }          // menu/test/cursor
      if (forceNexusUntil[p.index] > now) { out.push(withNexus(p)); continue; }
      var o = opt[p.index];
      if (o && o.replayUntil > now) { out.push(withButtons(p, { 9: true })); continue; }  // korte druk alsnog doorgeven
      if (p.buttons && p.buttons[9] && p.buttons[9].pressed) { out.push(withButtons(p, { 9: false })); continue; } // achterhouden
      out.push(p);
    }
    return out;
  }
  // De vervanging staat nu altijd aan (nodig voor de Options-knop)
  function setGamepadOverride() {
    if (navigator.getGamepads === patchedGetGamepads) return;
    try { delete navigator.getGamepads; } catch (e) {}
    navigator.getGamepads = patchedGetGamepads;
  }
  setGamepadOverride();
  function pressNexus(index) {
    forceNexusUntil[index] = Date.now() + NEXUS_MS;
    setGamepadOverride();
  }

  setInterval(function () {
    var pads = nativeGetGamepads(), now = Date.now();
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (!p || !p.connected || !p.buttons || !p.buttons[9]) continue;
      var o = opt[p.index] || (opt[p.index] = { down: 0, fired: false, hint: false, replayUntil: 0 });
      var pressed = p.buttons[9].pressed;
      if (pressed && !inputBlocked()) {
        if (!o.down) { o.down = now; o.fired = false; o.hint = false; }
        var held = now - o.down;
        if (held >= 1000 && !o.hint) { o.hint = true; toast('Blijf vasthouden voor het Xbox-menu…'); }
        if (held >= OPT_HOLD_MS && !o.fired) {
          o.fired = true;
          pressNexus(p.index);
          toast('Xbox-menu');
        }
      } else if (o.down) {
        if (!o.fired && !inputBlocked()) o.replayUntil = now + OPT_REPLAY_MS;   // was een korte druk
        o.down = 0;
      }
    }
  }, 30);

  // ---------------------------------------------------------------------------
  // Scherm "Sluit je controller aan" automatisch wegklikken met "Toch doorgaan".
  // xCloud herkent op Tizen de controller niet in deze controle, ook al werkt hij wel.
  // ---------------------------------------------------------------------------
  var CONTINUE_RE = /^\s*(toch doorgaan|continue anyway|trotzdem fortfahren|continuer quand m[eê]me)\s*$/i;
  function autoContinue() {
    if (!document.body) return;
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (b.__xcClicked || !CONTINUE_RE.test(b.textContent || '')) continue;
      // Alleen klikken als de knop in een klein blok (dialoog) staat waarin "controller" voorkomt
      var el = b.parentElement, ok = false;
      for (var up = 0; el && el !== document.body && up < 6; up++, el = el.parentElement) {
        var txt = el.textContent || '';
        if (txt.length > 1500) break;
        if (/controller/i.test(txt)) { ok = true; break; }
      }
      if (!ok) continue;
      b.__xcClicked = true;
      log('controllerscherm automatisch overgeslagen');
      setTimeout(function (btn) { return function () { btn.click(); }; }(b), 300);
    }
  }
  setInterval(autoContinue, 500);

  // ---------------------------------------------------------------------------
  // Bijwerken + herladen (via het menu: "Nieuwe versie laden").
  // Haalt de nieuwste versie van GitHub op, zet die klaar voor de loader en herlaadt
  // de pagina, zodat de nieuwe versie meteen draait.
  // ---------------------------------------------------------------------------
  var REPO = 'WiDri/xcloud-coop-tizen';
  var CACHE_KEY = 'xcCoop.cachedScript';
  var reloading = false;

  function fetchText(url, headers) {
    return fetch(url, { cache: 'no-store', headers: headers || {} }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }

  function updateAndReload() {
    if (reloading) return;
    reloading = true;
    toast('Nieuwste versie ophalen…');
    fetchText('https://api.github.com/repos/' + REPO + '/commits/main', { Accept: 'application/vnd.github.sha' })
      .then(function (sha) {
        sha = sha.trim();
        if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('geen commit');
        return fetchText('https://raw.githubusercontent.com/' + REPO + '/' + sha + '/dist/xcloud-coop.js');
      })
      .catch(function () {
        return fetchText('https://raw.githubusercontent.com/' + REPO + '/main/dist/xcloud-coop.js?t=' + Date.now());
      })
      .then(function (code) {
        var m = code.match(/var VERSION = '([^']+)'/);
        try { window.localStorage.setItem(CACHE_KEY, code); } catch (e) {}
        toast('Herladen met v' + (m ? m[1] : '?') + '…');
      })
      .catch(function (e) {
        toast('Ophalen mislukt, gewoon herladen');
      })
      .then(function () {
        setTimeout(function () { location.reload(); }, 800);
      });
  }


  // ---------------------------------------------------------------------------
  // Controllertest (eigen overlay). Toont per controller alle knoppen met PS- en
  // Xbox-namen, sticks en triggers. xCloud krijgt zolang geen invoer.
  // Sluiten: houd ○ / B 1 seconde vast (of wacht 2 minuten).
  // ---------------------------------------------------------------------------
  var BTN_NAMES = ['✕ / A', '○ / B', '□ / X', '△ / Y', 'L1 / LB', 'R1 / RB', 'L2 / LT', 'R2 / RT',
    'Share / View', 'Options / Menu', 'L3', 'R3', '↑', '↓', '←', '→', 'PS / Xbox', 'Touchpad'];
  var testerTimer = null, testerCloseStart = 0, testerUntil = 0;

  // Laatste toetsen die de tv aan de pagina geeft (bijv. als de tv de D-pad
  // omzet in pijltjestoetsen van de afstandsbediening)
  var lastKeys = [];
  window.addEventListener('keydown', function (e) {
    lastKeys.unshift(e.keyCode + (e.key ? ' ' + e.key : ''));
    if (lastKeys.length > 8) lastKeys.length = 8;
  }, true);

  function stickBox(x, y) {
    var px = Math.round(50 + x * 40), py = Math.round(50 + y * 40);
    return '<div style="position:relative;width:70px;height:70px;border-radius:50%;border:2px solid #555;display:inline-block;margin-right:10px">' +
      '<div style="position:absolute;left:' + px + '%;top:' + py + '%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#7CFC7C"></div></div>';
  }

  function renderTester() {
    var el = document.getElementById('xc-coop-tester');
    if (!el) return;
    var pads = nativeGetGamepads(), html = [];
    var any = false;
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (!p || !p.connected) continue;
      any = true;
      var cells = [];
      var n = Math.max(p.buttons.length, 18);
      for (var b = 0; b < n; b++) {
        var bt = p.buttons[b];
        var exists = !!bt, v = exists ? bt.value : 0, on = exists && (bt.pressed || v > 0.05);
        var bg = !exists ? '#222' : (on ? 'rgba(16,124,16,' + (0.35 + 0.65 * Math.max(v, bt.pressed ? 1 : 0)) + ')' : '#333');
        cells.push('<div style="background:' + bg + ';border-radius:6px;padding:6px 4px;text-align:center;' +
          (exists ? '' : 'opacity:.45;') + '">' + b + '<br><span style="font-size:12px">' + (BTN_NAMES[b] || '') +
          (exists ? '' : '<br>niet doorgegeven') + '</span></div>');
      }
      var ax = p.axes;
      html.push('<div style="margin-bottom:16px"><div style="font-weight:700">Controller ' + (p.index + 1) + ' · ' +
        p.id.replace(/</g, '&lt;').slice(0, 60) + '</div><div style="font-size:13px;opacity:.75;margin-bottom:6px">' +
        (p.mapping || 'geen mapping') + ' · ' + p.buttons.length + ' knoppen · ' + ax.length + ' assen</div>' +
        '<div style="display:grid;grid-template-columns:repeat(9,1fr);gap:5px;margin-bottom:8px">' + cells.join('') + '</div>' +
        '<div>' + stickBox(ax[0] || 0, ax[1] || 0) + stickBox(ax[2] || 0, ax[3] || 0) +
        '<span style="font-size:13px;vertical-align:top">assen: ' + ax.map(function (v, k) { return k + ':' + v.toFixed(2); }).join('  ') + '</span></div></div>');
    }
    if (!any) html.push('<div>Geen controller gevonden. Druk op een knop van je controller.</div>');
    html.push('<div style="margin-bottom:10px">Toetsen van tv/afstandsbediening: ' +
      (lastKeys.length ? lastKeys.join(' · ').replace(/</g, '&lt;') : 'geen') + '</div>');
    var left = Math.ceil((testerUntil - Date.now()) / 1000);
    html.push('<div style="opacity:.75;font-size:13px">Sluiten: houd ○ / B 1 seconde vast · sluit vanzelf over ' + left + ' s</div>');
    el.innerHTML = '<div style="font-size:20px;font-weight:700;margin-bottom:10px">Controllertest</div>' + html.join('');

    // sluiten met ○ / B
    var holding = false;
    for (var j = 0; j < pads.length; j++) if (pads[j] && pads[j].connected && pads[j].buttons[1] && pads[j].buttons[1].pressed) holding = true;
    if (holding) { if (!testerCloseStart) testerCloseStart = Date.now(); else if (Date.now() - testerCloseStart > 1000) closeTester(); }
    else testerCloseStart = 0;
    if (Date.now() > testerUntil) closeTester();
  }

  function openTester() {
    if (testerOpen) return;
    testerOpen = true;
    testerUntil = Date.now() + 120000;
    testerCloseStart = 0;
    setGamepadOverride();
    var el = document.createElement('div');
    el.id = 'xc-coop-tester';
    // geen `inset`: die kent de browser van Tizen 6.5 (Chromium 85) nog niet
    el.style.cssText = 'position:fixed;top:5vh;bottom:5vh;left:5vw;right:5vw;z-index:2147483646;overflow:auto;background:rgba(10,10,10,.95);' +
      'color:#fff;font:15px/1.35 system-ui,sans-serif;padding:20px 24px;border-radius:14px;border:2px solid #444';
    document.documentElement.appendChild(el);
    renderTester();
    testerTimer = setInterval(renderTester, 50);
  }

  function closeTester() {
    if (!testerOpen) return;
    testerOpen = false;
    clearInterval(testerTimer);
    var el = document.getElementById('xc-coop-tester');
    if (el) el.remove();
    setTimeout(function () { /* vervanging blijft aan */ }, 300); // even wachten tot ○ is losgelaten
  }

  // ---------------------------------------------------------------------------
  // Muiscursor met de controller
  //  Aan/uit: houd beide sticks (L3 + R3) een halve seconde ingedrukt.
  //  Linkerstick = bewegen, ✕ / A = klikken, rechterstick = scrollen, ○ / B = cursor uit.
  //  Zolang de cursor aan staat, krijgt xCloud geen controllerinvoer.
  // ---------------------------------------------------------------------------
  var cur = { x: 0, y: 0, el: null, timer: null, aWas: false, comboStart: 0, comboFired: false };

  function cursorEl() {
    if (cur.el && document.documentElement.contains(cur.el)) return cur.el;
    var el = document.createElement('div');
    el.id = 'xc-coop-cursor';
    el.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    el.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;' +
      'filter:drop-shadow(0 1px 2px rgba(0,0,0,.7));will-change:transform';
    document.documentElement.appendChild(el);
    cur.el = el;
    return el;
  }

  function fireMouse(target, type, extra) {
    var opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: cur.x, clientY: cur.y,
      screenX: cur.x, screenY: cur.y, button: 0, buttons: extra || 0 };
    try {
      if (type.indexOf('pointer') === 0 && window.PointerEvent) {
        opts.pointerId = 1; opts.pointerType = 'mouse'; opts.isPrimary = true;
        target.dispatchEvent(new PointerEvent(type, opts));
      } else target.dispatchEvent(new MouseEvent(type, opts));
    } catch (e) {}
  }

  function cursorClick() {
    var t = document.elementFromPoint(cur.x, cur.y);
    if (!t) return;
    fireMouse(t, 'pointerover'); fireMouse(t, 'mouseover');
    fireMouse(t, 'pointerdown', 1); fireMouse(t, 'mousedown', 1);
    try { if (t.focus) t.focus({ preventScroll: true }); } catch (e) {}
    fireMouse(t, 'pointerup'); fireMouse(t, 'mouseup');
    fireMouse(t, 'click');
  }

  function scrollAt(dx, dy) {
    var t = document.elementFromPoint(cur.x, cur.y);
    while (t && t !== document.documentElement) {
      var cs = getComputedStyle(t);
      if ((dy && /(auto|scroll)/.test(cs.overflowY) && t.scrollHeight > t.clientHeight) ||
          (dx && /(auto|scroll)/.test(cs.overflowX) && t.scrollWidth > t.clientWidth)) { t.scrollBy(dx, dy); return; }
      t = t.parentElement;
    }
    window.scrollBy(dx, dy);
  }

  function cursorTick() {
    var pads = nativeGetGamepads(), lx = 0, ly = 0, rx = 0, ry = 0, a = false, b = false;
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (!p || !p.connected) continue;
      var ax = p.axes;
      if (Math.abs(ax[0]) > Math.abs(lx)) lx = ax[0];
      if (Math.abs(ax[1]) > Math.abs(ly)) ly = ax[1];
      if (Math.abs(ax[2] || 0) > Math.abs(rx)) rx = ax[2] || 0;
      if (Math.abs(ax[3] || 0) > Math.abs(ry)) ry = ax[3] || 0;
      if (p.buttons[0] && p.buttons[0].pressed) a = true;
      if (p.buttons[1] && p.buttons[1].pressed) b = true;
    }
    var dz = function (v) { return Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85; };
    var sp = function (v) { v = dz(v); return Math.sign(v) * Math.pow(Math.abs(v), 1.6) * 22; };
    cur.x = Math.max(0, Math.min(window.innerWidth - 2, cur.x + sp(lx)));
    cur.y = Math.max(0, Math.min(window.innerHeight - 2, cur.y + sp(ly)));
    cursorEl().style.transform = 'translate(' + Math.round(cur.x) + 'px,' + Math.round(cur.y) + 'px)';
    var t = document.elementFromPoint(cur.x, cur.y);
    if (t && t !== cur.hover) { if (cur.hover) fireMouse(cur.hover, 'mouseout'); fireMouse(t, 'mousemove'); fireMouse(t, 'mouseover'); cur.hover = t; }
    if (dz(rx) || dz(ry)) scrollAt(Math.round(dz(rx) * 25), Math.round(dz(ry) * 25));
    if (a && !cur.aWas) cursorClick();
    cur.aWas = a;
    if (b) setCursor(false);
  }

  function setCursor(on) {
    if (on === cursorOn) return;
    cursorOn = on;
    if (on) {
      if (!cur.x && !cur.y) { cur.x = window.innerWidth / 2; cur.y = window.innerHeight / 2; }
      cur.aWas = true; // eerst ✕ loslaten
      setGamepadOverride();
      cursorEl().style.display = 'block';
      cur.timer = setInterval(cursorTick, 16);
      toast('Cursor aan · linkerstick = bewegen · ✕ = klikken · ○ = uit');
    } else {
      clearInterval(cur.timer);
      if (cur.el) cur.el.style.display = 'none';
      setTimeout(function () { /* vervanging blijft aan */ }, 300);
      toast('Cursor uit');
    }
  }

  // L3 + R3 een halve seconde vasthouden = cursor aan/uit
  setInterval(function () {
    var pads = nativeGetGamepads(), held = false;
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (p && p.connected && p.buttons && p.buttons[10] && p.buttons[11] && p.buttons[10].pressed && p.buttons[11].pressed) held = true;
    }
    if (!held) { cur.comboStart = 0; cur.comboFired = false; return; }
    if (!cur.comboStart) cur.comboStart = Date.now();
    if (!cur.comboFired && Date.now() - cur.comboStart >= 500) { cur.comboFired = true; setCursor(!cursorOn); }
  }, 50);

  // ---------------------------------------------------------------------------
  // Kindvriendelijk menu rechts: openen door Share 3 seconden vast te houden.
  // "Xbox-menu" staat altijd als eerste geselecteerd. D-pad / linkerstick = kiezen,
  // ✕ / A = uitvoeren, ○ / B = sluiten. Gaat vanzelf dicht na 30 s niets doen.
  // Zolang het menu open is, krijgt xCloud geen controllerinvoer.
  // ---------------------------------------------------------------------------
  var menu = { sel: 0, pad: 0, el: null, timer: null, prev: {}, repeatAt: 0, comboStart: 0, waitRelease: false };

  // Kleuren van de PlayStation-knoppen, zodat kinderen ze herkennen
  var KEY_X = '<span style="display:inline-block;width:30px;height:30px;line-height:30px;border-radius:50%;background:#2b6bd6;color:#fff;text-align:center;font-weight:800">✕</span>';
  var KEY_O = '<span style="display:inline-block;width:30px;height:30px;line-height:30px;border-radius:50%;background:#d63b3b;color:#fff;text-align:center;font-weight:800">○</span>';

  function menuItems() {
    return [
      { icon: '🎮', label: 'Xbox-menu', big: true, run: function (pi) { closeMenu(); setTimeout(function () { pressNexus(pi); }, 350); } },
      { icon: '▶️', label: 'Verder spelen', big: true, run: function () { closeMenu(); } },
      { icon: '🖱️', label: 'Muis', extra: true, run: function () { closeMenu(); setTimeout(function () { setCursor(true); }, 350); } },
      { icon: '🔎', label: 'Controller testen', extra: true, run: function () { closeMenu(); setTimeout(openTester, 350); } },
      { icon: '🔄', label: 'Nieuwe versie laden', extra: true, run: function () { closeMenu(); updateAndReload(); } }
    ];
  }

  function renderMenu() {
    if (!menu.el) return;
    var items = menuItems(), html = [];
    var pads = connectedPads().length;
    html.push('<div style="font-size:26px;font-weight:800;margin-bottom:2px">Menu</div>' +
      '<div style="font-size:16px;opacity:.8;margin-bottom:16px">' + (pads === 1 ? '1 controller' : pads + ' controllers') + ' 🎮</div>');
    var extraShown = false;
    for (var i = 0; i < items.length; i++) {
      var it = items[i], on = i === menu.sel;
      if (it.extra && !extraShown) {
        extraShown = true;
        html.push('<div style="font-size:13px;opacity:.55;margin:16px 4px 6px;text-transform:uppercase;letter-spacing:.08em">Extra</div>');
      }
      var size = it.big ? 'font-size:24px;padding:18px 18px;border-radius:18px;' : 'font-size:16px;padding:10px 14px;border-radius:12px;';
      var look = on ? 'background:#107c10;color:#fff;box-shadow:0 0 0 4px #fff inset;transform:scale(1.03);'
                    : 'background:rgba(255,255,255,.10);color:#eee;';
      html.push('<div style="' + size + look + 'margin:6px 0;font-weight:700;display:flex;align-items:center;gap:12px;transition:transform .1s">' +
        '<span style="font-size:' + (it.big ? '30px' : '20px') + '">' + it.icon + '</span><span>' + it.label + '</span></div>');
    }
    html.push('<div style="display:flex;gap:18px;align-items:center;margin-top:18px;font-size:17px;font-weight:600">' +
      '<span style="display:flex;align-items:center;gap:8px">' + KEY_X + ' kiezen</span>' +
      '<span style="display:flex;align-items:center;gap:8px">' + KEY_O + ' terug</span></div>' +
      '<div style="font-size:12px;opacity:.45;margin-top:12px">co-op v' + VERSION + '</div>');
    menu.el.innerHTML = html.join('');
  }

  function menuTick() {
    var pads = nativeGetGamepads(), p = null;
    for (var i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected && pads[i].index === menu.pad) p = pads[i];
    if (!p) for (var j = 0; j < pads.length; j++) if (pads[j] && pads[j].connected) { p = pads[j]; break; }
    if (!p) return;
    var B = function (n) { return !!(p.buttons[n] && p.buttons[n].pressed); };
    var up = B(12) || p.axes[1] < -0.6, down = B(13) || p.axes[1] > 0.6, a = B(0), b = B(1);
    if (menu.waitRelease) {               // eerst de openingscombinatie loslaten
      if (!B(8) && !a) menu.waitRelease = false;
      menu.prev = { up: up, down: down, a: a, b: b };
      return;
    }
    var now = Date.now(), items = menuItems();
    if (up || down || a || b) menu.lastInput = now;
    else if (now - menu.lastInput > 30000) { closeMenu(); return; }   // vanzelf dicht na 30 s niets doen
    var dir = up ? -1 : (down ? 1 : 0);
    if (dir && (!(menu.prev.up || menu.prev.down) || now >= menu.repeatAt)) {
      menu.sel = (menu.sel + dir + items.length) % items.length;
      menu.repeatAt = now + ((menu.prev.up || menu.prev.down) ? 130 : 380);
      renderMenu();
    }
    if (a && !menu.prev.a) items[menu.sel].run(p.index);
    else if (b && !menu.prev.b) closeMenu();
    menu.prev = { up: up, down: down, a: a, b: b };
  }

  function openMenu(padIndex) {
    if (menuOpen || testerOpen) return;
    if (cursorOn) setCursor(false);
    menuOpen = true;
    menu.pad = padIndex; menu.sel = 0; menu.waitRelease = true; menu.prev = {}; menu.lastInput = Date.now();
    setGamepadOverride();
    var el = document.createElement('div');
    el.id = 'xc-coop-menu';
    el.style.cssText = 'position:fixed;top:6vh;right:3vw;width:400px;max-height:88vh;overflow:auto;z-index:2147483646;' +
      'background:linear-gradient(160deg,#1d1d2b,#101018);color:#fff;font:16px/1.35 system-ui,sans-serif;padding:22px 22px 18px;' +
      'border-radius:24px;border:3px solid #107c10;box-shadow:0 10px 40px rgba(0,0,0,.6)';
    document.documentElement.appendChild(el);
    menu.el = el;
    renderMenu();
    menu.timer = setInterval(menuTick, 30);
  }

  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    clearInterval(menu.timer);
    if (menu.el) menu.el.remove();
    menu.el = null;
    setTimeout(function () { /* vervanging blijft aan */ }, 300);
  }

  // Share 3 seconden vasthouden (zonder Options) = co-op-menu openen.
  // (Options lang vasthouden opent in xCloud zelf al het Xbox-menu.)
  var MENU_HOLD_MS = 3000;
  setInterval(function () {
    var pads = nativeGetGamepads(), who = -1;
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (!p || !p.connected || !p.buttons || p.buttons.length < 10) continue;
      if (p.buttons[8].pressed && !p.buttons[9].pressed) { who = p.index; break; }
    }
    if (who < 0 || menuOpen || testerOpen) { menu.comboStart = 0; menu.hintShown = false; return; }
    if (!menu.comboStart) { menu.comboStart = Date.now(); return; }
    if (menu.comboStart < 0) return; // pas opnieuw na loslaten
    var held = Date.now() - menu.comboStart;
    if (held >= 1000 && !menu.hintShown) { menu.hintShown = true; toast('Blijf vasthouden voor het co-op-menu…'); }
    if (held >= MENU_HOLD_MS) { menu.comboStart = -1; openMenu(who); }
  }, 50);

  // ---------------------------------------------------------------------------
  // Nieuwere JavaScript van xbox.com geschikt maken voor de tv-browser (Chromium 85).
  // Sommige stukken code (chunks) van xbox.com gebruiken "class static blocks"
  // (`static{...}`, pas vanaf Chromium 94). Zo'n chunk laadt dan niet en bijvoorbeeld
  // de launch-pagina blijft zwart. Daarom: chunk zelf ophalen, `static{...}` omzetten
  // naar een statisch veld (`static __xcS0=(()=>{...})();`, `this` blijft de klasse)
  // en uitvoeren. Chunks zonder static block laden gewoon zoals altijd.
  // ---------------------------------------------------------------------------
  var CHUNK_RE = /^https:\/\/assets\.play\.xbox\.com\/playxbox\/static\/js\/[\w.-]+\.chunk\.js$/;
  var STATIC_BLOCK_RE = /([;{}])static\s*\{/g;

  function lowerStaticBlocks(src) {
    var out = '', i = 0, n = 0, m;
    STATIC_BLOCK_RE.lastIndex = 0;
    while ((m = STATIC_BLOCK_RE.exec(src))) {
      var start = m.index + m[1].length;   // begin van "static"
      var open = src.indexOf('{', start);
      var depth = 0, j = open, q = null;
      for (; j < src.length; j++) {
        var c = src[j];
        if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
        if (c === '"' || c === "'" || c === '`') { q = c; continue; }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) break; }
      }
      if (depth !== 0) return null;          // einde niet gevonden: niet aanpassen
      out += src.slice(i, start) + 'static __xcS' + (n++) + '=(()=>' + src.slice(open, j + 1) + ')();';
      i = j + 1;
      STATIC_BLOCK_RE.lastIndex = i;
    }
    return n ? out + src.slice(i) : src;
  }

  function loadChunkCompat(script, loadOriginal) {
    var url = script.src;
    fetch(url, { credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (code) {
        STATIC_BLOCK_RE.lastIndex = 0;
        if (!STATIC_BLOCK_RE.test(code)) { loadOriginal(); return; }
        var fixed = lowerStaticBlocks(code);
        if (!fixed) { loadOriginal(); return; }
        (0, eval)(fixed + '\n//# sourceURL=' + url);
        log('chunk aangepast voor deze tv: ' + url.split('/').pop());
        if (typeof script.onload === 'function') script.onload({ type: 'load', target: script });
      })
      .catch(function (err) {
        console.error(TAG, 'chunk aanpassen mislukt, origineel laden', err);
        loadOriginal();
      });
  }

  var nativeAppendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function (node) {
    if (node && node.tagName === 'SCRIPT' && !node.__xcCompat && node.getAttribute('data-webpack') && CHUNK_RE.test(node.src)) {
      node.__xcCompat = true;
      var parent = this;
      loadChunkCompat(node, function () { nativeAppendChild.call(parent, node); });
      return node;
    }
    return nativeAppendChild.apply(this, arguments);
  };

  // ---------------------------------------------------------------------------
  // Controllernavigatie van xbox.com starten als xbox.com dat zelf niet doet.
  // Soms blijft de GamepadNavigation-bibliotheek van xbox.com uit; de controller
  // werkt dan wel in games, maar je kunt niet door de menu's bladeren.
  // De module wordt op tekst gezocht (niet op nummer), want de nummers veranderen
  // bij elke update van xbox.com.
  // ---------------------------------------------------------------------------
  var NAV_NEEDLE = 'Unable to initialize gamepad navigation in a non-browser environment';

  function findWebpackRequire() {
    var arr = window.__LOADABLE_LOADED_CHUNKS__;
    if (!arr || !arr.push) return null;
    var req = null;
    try { arr.push([['__xcNav' + Date.now()], {}, function (r) { req = r; }]); } catch (e) {}
    return req;
  }

  function findModule(req, needle) {
    var mods = req && req.m;
    if (!mods) return null;
    for (var id in mods) {
      try { if (mods[id].toString().indexOf(needle) >= 0) return req(id); } catch (e) {}
    }
    return null;
  }

  var navChecks = 0, navUiSeen = 0;
  var navTimer = setInterval(function () {
    if (++navChecks > 90) { clearInterval(navTimer); return; }           // na ±3 minuten stoppen
    if (!document.querySelector('[class*="BaseItem-module"]')) return;  // menu van xbox.com nog niet in beeld
    if (!navUiSeen) { navUiSeen = Date.now(); return; }                // xbox.com eerst zelf de kans geven
    if (Date.now() - navUiSeen < 1500) return;
    clearInterval(navTimer);
    var nav = findModule(findWebpackRequire(), NAV_NEEDLE);
    if (!nav || typeof nav.initializeGamepadNavigation !== 'function') {
      console.warn(TAG, 'navigatiebibliotheek van xbox.com niet gevonden');
      return;
    }
    if (nav.isLibraryInitialized()) { log('controllernavigatie al actief'); return; }
    try {
      nav.initializeGamepadNavigation({
        overrideDefaultScrollBehavior: true,
        defaultToFocusDrivenInputMode: true,
        defaults: { bumperBehavior: 'scroll', triggerBehavior: 'scroll', activeInputMode: 'gamepad', pollingMode: 'all' }
      });
      log('controllernavigatie gestart');
    } catch (err) {
      console.error(TAG, 'controllernavigatie starten mislukt', err);
    }
  }, 1000);

  // ---------------------------------------------------------------------------
  // 4. Co-op aanzetten zodra de stream echt speelt
  // ---------------------------------------------------------------------------
  // Let op: tijdens het laden speelt xCloud soms al een video (trailer/wachtscherm)
  // voordat de stream en de inputmanager bestaan. Daarom even blijven wachten.
  var enableTimer = null;
  document.addEventListener('playing', function (e) {
    if (!e.target || e.target.tagName !== 'VIDEO') return;
    if (enableTimer) return;
    var tries = 0;
    enableTimer = setInterval(function () {
      tries++;
      if (typeof window.__xcCoopEnable === 'function') {
        clearInterval(enableTimer); enableTimer = null;
        if (window.__xcCoopEnable()) toast('Lokale co-op aan · ' + connectedPads().length + ' controller(s)');
        return;
      }
      if (tries >= 120) { // ±60 seconden
        clearInterval(enableTimer); enableTimer = null;
        toast('Co-op-patch niet actief (xCloud is mogelijk gewijzigd)');
      }
    }, 500);
  }, true);

  log('geladen v' + VERSION);
})();
