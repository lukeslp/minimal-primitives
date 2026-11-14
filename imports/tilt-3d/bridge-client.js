/* Gaze bridge client. By Luke Steuber.
   Reads an eye tracker's gaze from the gaze bridge (gaze-bridge/PROTOCOL.md)
   on 127.0.0.1 and hands each sample to the page in its own viewport pixels
   and on its own clock. The mapping parts are pure, for the tests; the
   connection reconnects quietly and never throws into the game. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GazeBridge = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const PROTOCOL = 1, PORT = 47913;

  // A display point (0 to 1 across the tracked display) in viewport pixels.
  // `view` is the window's geometry: screenX, screenY, outerWidth/Height,
  // innerWidth/Height and the screen's width/height. The window frame is
  // taken to sit along the top and left; a one-dot offset removes the rest.
  function toViewport(x, y, display, view, offset) {
    const d = display || { x: 0, y: 0, width: view.screenWidth, height: view.screenHeight };
    const frameX = Math.max(0, view.outerWidth - view.innerWidth), frameY = Math.max(0, view.outerHeight - view.innerHeight);
    const o = offset || { dx: 0, dy: 0 };
    return {
      x: x * d.width - (view.screenX - (d.x || 0)) - frameX + o.dx,
      y: y * d.height - (view.screenY - (d.y || 0)) - frameY + o.dy
    };
  }
  function viewOf(w) {
    return { screenX: w.screenX || 0, screenY: w.screenY || 0, outerWidth: w.outerWidth || w.innerWidth, outerHeight: w.outerHeight || w.innerHeight,
      innerWidth: w.innerWidth, innerHeight: w.innerHeight, screenWidth: w.screen ? w.screen.width : w.innerWidth, screenHeight: w.screen ? w.screen.height : w.innerHeight };
  }
  // The bridge clock against the page's: the reply with the shortest round
  // trip of the last few gives the best estimate.
  function clockSync(keep = 8) {
    const replies = [];
    return {
      add(sent, received, bridgeT) { replies.push({ rtt: received - sent, offset: (sent + received) / 2 - bridgeT }); while (replies.length > keep) replies.shift(); },
      get offset() { if (!replies.length) return null; return replies.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset; },
      get rtt() { return replies.length ? Math.min(...replies.map(r => r.rtt)) : null; }
    };
  }
  function urlFor(port) { return 'ws://127.0.0.1:' + (port || PORT) + '/gaze'; }

  // connect({ url, WebSocket, now, onSample(t, x, y, valid), onState(state, info) })
  // States: connecting, open (hello received), lost (bridge gone, retrying),
  // unsupported (wrong protocol), closed (stopped by the page).
  function connect(options) {
    const WS = options.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    const now = options.now || (() => performance.now());
    const url = options.url || urlFor(options.port);
    const sync = clockSync();
    let lastT = -Infinity, ws = null, stopped = false, retry = 0, retryTimer = 0, pingTimer = 0, pingId = 0, hello = null;
    const sent = new Map();
    const state = (s, info) => { try { options.onState && options.onState(s, info || null); } catch (_) {} };
    function open() {
      if (stopped || !WS) { if (!WS) state('unsupported', { reason: 'No WebSocket' }); return; }
      state('connecting');
      try { ws = new WS(url); } catch (error) { schedule(); return; }
      ws.onmessage = e => receive(e.data);
      ws.onclose = () => { ws = null; clearInterval(pingTimer); if (!stopped) { if (hello) state('lost'); hello = null; schedule(); } };
      ws.onerror = () => {};
    }
    function schedule() { if (stopped) return; clearTimeout(retryTimer); retryTimer = setTimeout(open, Math.min(8000, 500 * 2 ** retry++)); }
    function ping() { if (!ws || ws.readyState !== 1) return; const id = ++pingId; sent.set(id, now()); if (sent.size > 16) sent.delete(sent.keys().next().value); ws.send(JSON.stringify({ type: 'ping', id })); }
    function receive(text) {
      let m; try { m = JSON.parse(text); } catch (_) { return; }
      if (!m || typeof m !== 'object') return;
      if (m.type === 'hello') {
        if (m.protocol !== PROTOCOL) { stop(true); state('unsupported', { reason: 'Protocol ' + m.protocol }); return; }
        hello = m; retry = 0; state('open', m); ping(); pingTimer = setInterval(ping, 2000); return;
      }
      if (m.type === 'pong' && sent.has(m.id)) { const s = sent.get(m.id); sent.delete(m.id); sync.add(s, now(), m.t); return; }
      if (m.type === 'status') { state('status', m); return; }
      if (m.type === 'gaze' && Array.isArray(m.samples) && options.onSample) {
        // Before the first pong, place samples at their arrival.
        const off = sync.offset, at = now();
        for (const s of m.samples) {
          if (!Array.isArray(s) || s.length < 4) continue;
          // Never backwards: the first pong can move the estimate a little.
          const t = lastT = Math.max(lastT, off === null ? at : s[0] + off);
          try { options.onSample(t, s[3] ? s[1] : null, s[3] ? s[2] : null, !!s[3]); } catch (error) { setTimeout(() => { throw error; }); }
        }
      }
    }
    function stop(quiet) { stopped = true; clearTimeout(retryTimer); clearInterval(pingTimer); if (ws) { try { ws.close(); } catch (_) {} ws = null; } if (!quiet) state('closed'); }
    open();
    return { stop, get hello() { return hello; }, get clock() { return sync; } };
  }
  return { PROTOCOL, PORT, toViewport, viewOf, clockSync, urlFor, connect };
});
