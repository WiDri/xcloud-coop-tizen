// ==UserScript==
// @name         xCloud Co-op (Tizen)
// @description  Alleen lokale co-op (meerdere controllers) voor xbox.com/play. Gebaseerd op de co-op-patch van Better xCloud (MIT, © redphx).
// @version      1.0.0
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
        // Controllers opnieuw aanmelden zodat ze met hun eigen nummer worden geregistreerd
        var pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (var i = 0; i < pads.length; i++) {
          var p = pads[i];
          if (!p || !p.connected) continue;
          try { p._xcSilent = true; } catch (e) {}
          window.dispatchEvent(new GamepadEvent('gamepaddisconnected', { gamepad: p }));
          window.dispatchEvent(new GamepadEvent('gamepadconnected', { gamepad: p }));
        }
        return true;
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
  //    Webpack registreert zijn chunk-handler met fn.bind(null, 0) en
  //    fn.bind(null, push). Op die momenten haken we in; daarna herstellen we bind.
  // ---------------------------------------------------------------------------
  var nativeBind = Function.prototype.bind;
  Function.prototype.bind = function () {
    var valid = this.name.length <= 2 && arguments.length === 2 && arguments[0] === null &&
      (arguments[1] === 0 || typeof arguments[1] === 'function');
    if (!valid) return nativeBind.apply(this, arguments);
    if (typeof arguments[1] === 'function') Function.prototype.bind = nativeBind;
    var orgFunc = this;
    var wrapped = function (a, item) {
      try { if (item) patchModules(item[1]); } catch (e) { console.error(TAG, e); }
      return orgFunc(a, item);
    };
    return nativeBind.apply(wrapped, arguments);
  };

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
