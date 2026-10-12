// ==UserScript==
// @name         xCloud Co-op (Tizen)
// @description  Alleen lokale co-op (meerdere controllers) voor xbox.com/play. Gebaseerd op de co-op-patch van Better xCloud (MIT, © redphx).
// @version      2.6.0
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

  var VERSION = '2.6.0';

  // ---------------------------------------------------------------------------
  // 0. Browser vermommen als Windows/Edge, zodat xCloud niet de route van de
  //    officiële Samsung-app kiest (die controllers via Samsung zelf herkent).
  //    Werkt alleen als dit script vroeg genoeg draait (via de cache van de loader).
  //    Zet UA_SPOOF op false om dit uit te schakelen.
  // ---------------------------------------------------------------------------
  var UA_SPOOF = true;
  var uaSpoofed = false;
  if (UA_SPOOF && /Tizen|SMART-TV/i.test(navigator.userAgent)) {
    try {
      var m = navigator.userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/) ||
              navigator.userAgent.match(/(\d{2,3}\.\d+\.\d+\.\d+)\/[\d.]+ TV/);
      var cv = m ? m[1] : '120.0.0.0';
      var fakeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' +
        cv + ' Safari/537.36 Edg/' + cv;
      var orgUA = navigator.userAgent;
      Object.defineProperty(navigator, 'orgUserAgent', { get: function () { return orgUA; }, configurable: true });
      Object.defineProperty(navigator, 'userAgent', { get: function () { return fakeUA; }, configurable: true });
      Object.defineProperty(navigator, 'appVersion', { get: function () { return fakeUA.replace('Mozilla/', ''); }, configurable: true });
      Object.defineProperty(navigator, 'platform', { get: function () { return 'Win32'; }, configurable: true });
      if ('userAgentData' in navigator) {
        Object.defineProperty(navigator, 'userAgentData', { get: function () { return undefined; }, configurable: true });
      }
      uaSpoofed = true;
    } catch (e) { console.error('[xCloud co-op] UA-vermomming mislukt', e); }
  }
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
  var COMBINED = 'this.useCombinedAudioVideoStream=!!this.deviceInformation.isTizen';
  var PATCHES = [
    { name: 'coop', find: MARKER, apply: function (src) { return src.replace(MARKER, MARKER + INJECT); } },
    // Met een vermomde browser denkt xCloud dat het geen Tizen is; de tv heeft de
    // gecombineerde audio/videostream wel nodig, dus die zetten we vast aan.
    { name: 'combined', find: COMBINED, apply: function (src) { return src.replace(COMBINED, 'this.useCombinedAudioVideoStream=true'); } }
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
    var todo = PATCHES.filter(function (p) { return !donePatches[p.name] && (p.name !== 'combined' || uaSpoofed); });
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
  // Vervanging voor de Xbox-knop: houd View + Menu 1 seconde ingedrukt
  // (PS-stijl: Share + Options). De tv vangt de echte Xbox/PS-knop af, dus
  // we laten xCloud zelf denken dat knop 16 (Xbox-knop) wordt ingedrukt door
  // de controllerstatus die xCloud uitleest heel even aan te passen.
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
  function patchedGetGamepads() {
    var pads = nativeGetGamepads();
    var now = Date.now();
    var out = [];
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      out.push(p && p.connected && forceNexusUntil[p.index] > now ? withNexus(p) : p);
    }
    return out;
  }
  var restoreTimer = null;
  function pressNexus(index) {
    forceNexusUntil[index] = Date.now() + NEXUS_MS;
    try { delete navigator.getGamepads; } catch (e) {}
    navigator.getGamepads = patchedGetGamepads;
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(function () {
      try { delete navigator.getGamepads; } catch (e) {}
      if (navigator.getGamepads === patchedGetGamepads) navigator.getGamepads = Navigator.prototype.getGamepads;
    }, NEXUS_MS + 100);
  }

  var HOLD_MS = 1000;
  var holdStart = {};
  var holdFired = {};
  setInterval(function () {
    var pads = nativeGetGamepads();
    var now = Date.now();
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (!p || !p.connected || !p.buttons || p.buttons.length < 10) continue;
      var held = p.buttons[8].pressed && p.buttons[9].pressed;
      if (!held) { holdStart[p.index] = 0; holdFired[p.index] = false; continue; }
      if (!holdStart[p.index]) holdStart[p.index] = now;
      if (!holdFired[p.index] && now - holdStart[p.index] >= HOLD_MS) {
        holdFired[p.index] = true;
        pressNexus(p.index);
        toast('Xbox-knop (controller ' + (p.index + 1) + ')');
      }
    }
  }, 50);

  // ---------------------------------------------------------------------------
  // Diagnose: buiten een stream laat een paneel zien welke knopnummers de tv doorgeeft
  // ---------------------------------------------------------------------------
  var streaming = false;
  ['pause', 'ended', 'emptied'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { if (e.target && e.target.tagName === 'VIDEO') streaming = false; }, true);
  });
  document.addEventListener('playing', function (e) { if (e.target && e.target.tagName === 'VIDEO') streaming = true; }, true);

  var dbgHide = null;
  var dbgEvents = [];
  function showDebug(text) {
    if (!document.body) return;
    var el = document.getElementById('xc-coop-debug');
    if (!el) {
      el = document.createElement('pre');
      el.id = 'xc-coop-debug';
      el.style.cssText = 'position:fixed;left:24px;bottom:24px;z-index:2147483647;margin:0;max-width:70vw;' +
        'background:rgba(0,0,0,.85);color:#7CFC7C;font:18px/1.4 monospace;padding:10px 14px;' +
        'border-radius:8px;pointer-events:none;white-space:pre-wrap';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.display = 'block';
    clearTimeout(dbgHide);
    dbgHide = setTimeout(function () { el.style.display = 'none'; dbgEvents = []; }, 4000);
  }

  // Andere invoer die het touchpad zou kunnen sturen (muis, aanraking, toetsen)
  ['keydown', 'mousedown', 'mousemove', 'pointerdown', 'touchstart', 'click', 'wheel', 'contextmenu'].forEach(function (type) {
    window.addEventListener(type, function (e) {
      if (streaming) return;
      var info = type;
      if (e.keyCode !== undefined && type === 'keydown') info += ' keyCode=' + e.keyCode + ' key=' + e.key;
      if (e.button !== undefined && type !== 'keydown' && type !== 'mousemove') info += ' button=' + e.button;
      if (e.pointerType) info += ' pointerType=' + e.pointerType;
      if (type === 'mousemove' && dbgEvents[dbgEvents.length - 1] === info) return;
      dbgEvents.push(info);
      if (dbgEvents.length > 6) dbgEvents.shift();
      showDebug('Overige invoer:\n' + dbgEvents.join('\n'));
    }, true);
  });

  setInterval(function () {
    if (streaming || !document.body) return;
    var pads = nativeGetGamepads();
    var lines = [];
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (!p || !p.connected) continue;
      var pressed = [];
      for (var b = 0; b < p.buttons.length; b++) if (p.buttons[b] && p.buttons[b].pressed) pressed.push(b);
      if (pressed.length) {
        lines.push('Controller ' + (p.index + 1) + ' (' + (p.mapping || 'geen mapping') + ', ' +
          p.buttons.length + ' knoppen): ' + pressed.join(', ') + '\n' + p.id);
      }
    }
    if (!lines.length) return;
    showDebug(lines.join('\n\n') + (dbgEvents.length ? '\n\nOverige invoer:\n' + dbgEvents.join('\n') : ''));
  }, 100);

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
  // Bijwerken + herladen: houd LB + RB + View (PS: L1 + R1 + Share) 2 seconden vast.
  // Haalt de nieuwste versie van GitHub op, zet die klaar voor de loader en herlaadt
  // de pagina, zodat de nieuwe versie meteen draait.
  // ---------------------------------------------------------------------------
  var REPO = 'WiDri/xcloud-coop-tizen';
  var CACHE_KEY = 'xcCoop.cachedScript';
  var RELOAD_MS = 2000;
  var reloadStart = 0, reloading = false;

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

  setInterval(function () {
    if (reloading) return;
    var pads = nativeGetGamepads();
    var held = false;
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (p && p.connected && p.buttons && p.buttons.length > 8 &&
          p.buttons[4].pressed && p.buttons[5].pressed && p.buttons[8].pressed) { held = true; break; }
    }
    if (!held) { reloadStart = 0; return; }
    if (!reloadStart) { reloadStart = Date.now(); toast('Blijf vasthouden om te herladen…'); return; }
    if (Date.now() - reloadStart >= RELOAD_MS) updateAndReload();
  }, 100);

  // ---------------------------------------------------------------------------
  // Uitgebreide diagnose (ook tijdens een game): houd L1 + R1 + Options 2 s vast.
  // Toont 60 s lang alles wat de tv doorgeeft: alle controllers (ook "lege"),
  // knoppen met waarde, ALLE assen, en muis-/aanraak-/toetsgebeurtenissen.
  // Bedoeld om te zien of het touchpad ergens anders binnenkomt.
  // ---------------------------------------------------------------------------
  var diagUntil = 0, diagHoldStart = 0, diagEvents = [], diagBaseline = {};
  function diagLog(txt) {
    if (Date.now() > diagUntil) return;
    var t = new Date();
    diagEvents.push(('0' + t.getSeconds()).slice(-2) + '.' + ('00' + t.getMilliseconds()).slice(-3).slice(0, 1) + ' ' + txt);
    if (diagEvents.length > 8) diagEvents.shift();
  }
  ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'click', 'wheel', 'pointerdown', 'pointermove',
   'touchstart', 'touchmove', 'contextmenu', 'gamepadconnected', 'gamepaddisconnected'].forEach(function (type) {
    var handler = function (e) {
      if (Date.now() > diagUntil) return;
      var info = type;
      if (type.indexOf('key') === 0) info += ' code=' + e.keyCode + ' key=' + e.key;
      else if (type.indexOf('gamepad') === 0) info += ' #' + (e.gamepad && e.gamepad.index) + ' ' + (e.gamepad && e.gamepad.id || '').slice(0, 30);
      else if (e.clientX !== undefined) info += ' x=' + Math.round(e.clientX) + ' y=' + Math.round(e.clientY) + (e.button !== undefined ? ' btn=' + e.button : '') + (e.pointerType ? ' ' + e.pointerType : '');
      else if (e.touches) info += ' touches=' + e.touches.length;
      if ((type === 'mousemove' || type === 'pointermove' || type === 'touchmove') &&
          diagEvents.length && diagEvents[diagEvents.length - 1].indexOf(type) > 0) diagEvents.pop();
      diagLog(info);
    };
    window.addEventListener(type, handler, true);
    document.addEventListener(type, handler, true);
  });

  function renderDiag() {
    var el = document.getElementById('xc-coop-diag');
    if (Date.now() > diagUntil) { if (el) el.style.display = 'none'; return; }
    if (!document.body) return;
    if (!el) {
      el = document.createElement('pre');
      el.id = 'xc-coop-diag';
      el.style.cssText = 'position:fixed;right:48px;top:28px;z-index:2147483647;margin:0;width:46vw;max-height:85vh;overflow:hidden;' +
        'background:rgba(0,0,0,.88);color:#7CFC7C;font:15px/1.35 monospace;padding:10px 12px;border-radius:8px;' +
        'pointer-events:none;white-space:pre-wrap';
      document.documentElement.appendChild(el);
    }
    var pads = nativeGetGamepads();
    var lines = ['DIAGNOSE (' + Math.ceil((diagUntil - Date.now()) / 1000) + ' s) · slots: ' + pads.length];
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (!p) { lines.push('#' + i + ': leeg'); continue; }
      var pressed = [];
      for (var b = 0; b < p.buttons.length; b++) {
        var v = p.buttons[b].value;
        if (p.buttons[b].pressed || v > 0.05) pressed.push(b + (v > 0 && v < 1 ? '(' + v.toFixed(2) + ')' : ''));
      }
      var base = diagBaseline[i] || (diagBaseline[i] = p.axes.slice());
      var axes = [];
      for (var a = 0; a < p.axes.length; a++) {
        var val = p.axes[a];
        var mark = Math.abs(val - (base[a] || 0)) > 0.15 ? '*' : '';
        axes.push(a + ':' + val.toFixed(2) + mark);
      }
      lines.push('#' + p.index + ' ' + (p.connected ? '' : '(los) ') + p.id.slice(0, 42));
      lines.push('  ' + (p.mapping || 'geen mapping') + ' · ' + p.buttons.length + ' knoppen · ' + p.axes.length + ' assen');
      lines.push('  knoppen: ' + (pressed.join(' ') || '-'));
      lines.push('  assen: ' + axes.join(' '));
    }
    lines.push('');
    lines.push('gebeurtenissen:');
    lines.push(diagEvents.length ? diagEvents.join('\n') : '-');
    el.textContent = lines.join('\n');
    el.style.display = 'block';
  }

  setInterval(function () {
    var pads = nativeGetGamepads(), held = false;
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (p && p.connected && p.buttons && p.buttons.length > 9 &&
          p.buttons[4].pressed && p.buttons[5].pressed && p.buttons[9].pressed) { held = true; break; }
    }
    if (held) {
      if (!diagHoldStart) diagHoldStart = Date.now();
      else if (Date.now() - diagHoldStart >= 2000 && Date.now() > diagUntil) {
        diagUntil = Date.now() + 60000; diagEvents = []; diagBaseline = {};
        toast('Diagnose 60 s aan · druk nu op het touchpad');
      }
    } else diagHoldStart = 0;
    renderDiag();
  }, 100);

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

  // ---------------------------------------------------------------------------
  // Versielabel linksboven
  // ---------------------------------------------------------------------------
  function showVersionBadge() {
    if (!document.documentElement || !document.body) { document.addEventListener('DOMContentLoaded', showVersionBadge); return; }
    if (document.getElementById('xc-coop-version')) return;
    var el = document.createElement('div');
    el.id = 'xc-coop-version';
    el.textContent = 'co-op v' + VERSION + (uaSpoofed ? ' · win' : ' · tizen');
    el.style.cssText = 'position:fixed;left:48px;top:28px;z-index:2147483647;pointer-events:none;' +
      'background:rgba(0,0,0,.55);color:#fff;font:600 13px/1 system-ui,sans-serif;' +
      'padding:4px 7px;border-radius:5px;opacity:.75';
    document.documentElement.appendChild(el);
  }
  showVersionBadge();
  // xCloud bouwt de pagina bij het opstarten opnieuw op en kan het label daarbij
  // weghalen (vooral nu het script vroeg draait). Daarom elke seconde controleren.
  setInterval(function () {
    if (!document.getElementById('xc-coop-version')) showVersionBadge();
  }, 1000);

  log('geladen v' + VERSION);
})();
