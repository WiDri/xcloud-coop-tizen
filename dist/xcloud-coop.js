// ==UserScript==
// @name         xCloud Co-op (Tizen)
// @description  Alleen lokale co-op (meerdere controllers) voor xbox.com/play. Gebaseerd op de co-op-patch van Better xCloud (MIT, © redphx).
// @version      1.7.0
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
  var patched = false;

  function patchModules(modules) {
    if (patched || !modules) return;
    for (var id in modules) {
      var fn = modules[id];
      if (typeof fn !== 'function') continue;
      var src = fn.toString();
      if (src.indexOf(MARKER) < 0) continue;

      src = src.replace(MARKER, MARKER + INJECT);
      var code;
      if (/^\d+\s*\(/.test(src)) code = '(function ' + src.replace(/^\d+/, '') + ')';      // 123(e,t,n){...}
      else if (/^function[\s(]/.test(src)) code = '(' + src + ')';                         // function(e,t,n){...}
      else if (/^[\w$]+\s*\(/.test(src)) code = '(function ' + src.replace(/^[\w$]+/, '') + ')'; // naam(e,t,n){...}
      else code = '(' + src + ')';                                                            // (e,t,n)=>{...}

      try {
        modules[id] = (0, eval)(code);
        patched = true;
        log('module ' + id + ' gepatcht');
      } catch (err) {
        console.error(TAG, 'kon module ' + id + ' niet herschrijven', err);
      }
      return;
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

  navigator.getGamepads = function () {
    var pads = nativeGetGamepads();
    var now = Date.now();
    var active = false;
    for (var k in forceNexusUntil) if (forceNexusUntil[k] > now) { active = true; break; }
    if (!active) return pads;
    var out = [];
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      out.push(p && p.connected && forceNexusUntil[p.index] > now ? withNexus(p) : p);
    }
    return out;
  };

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
        forceNexusUntil[p.index] = now + NEXUS_MS;
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
  // 4. Co-op aanzetten zodra de stream echt speelt
  // ---------------------------------------------------------------------------
  document.addEventListener('playing', function (e) {
    if (!e.target || e.target.tagName !== 'VIDEO') return;
    if (typeof window.__xcCoopEnable !== 'function') {
      toast('Co-op-patch niet actief (xCloud is mogelijk gewijzigd)');
      return;
    }
    if (!window.__xcCoopEnable()) return;
    toast('Lokale co-op aan · ' + connectedPads().length + ' controller(s)');
  }, true);

  log('geladen');
})();
