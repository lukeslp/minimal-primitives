/*
 * File Purpose: Quiet chrome for the sphere — no menu. A top readout
 *   (mines left · time) and a bottom bar of bare glyphs: Undo · Reset · Flag
 *   (red while armed) on the left, Help on the right. Everything else —
 *   theme, board size, warning style, drag inversion, effects — lives in the
 *   Help sheet, which sphere/index.html turns into a settings sheet.
 * Primary Functions/Classes: initQuietChrome(game)
 * Inputs: the SphereSweeper game API. Outputs: DOM chrome, live region.
 * A11y: 48px targets, aria-pressed on Flag, polite announcements, keyboard
 *   focusable, honours prefers-reduced-motion via CSS.
 * Author: Luke Steuber <luke@lukesteuber.com>
 */
(function (global) {
  "use strict";

  const ICONS = {
    undo:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h9.5a6.5 6.5 0 1 1 0 13H11"/></svg>',
    reset:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/></svg>',
    flag:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 21V4"/><path d="M6 4h10l-2 4 2 4H6"/></svg>',
    flagFilled:
      '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 21V4" fill="none"/><path d="M6 4h10l-2 4 2 4H6z"/></svg>',
    help:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.2"/><path d="M9.3 9.4a2.8 2.8 0 0 1 5.4.9c0 1.9-2.7 2.6-2.7 4.1"/><line x1="12" y1="17.6" x2="12.01" y2="17.6"/></svg>',
    mine:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="13" r="6"/><path d="M12 3v3M12 20v1M3 13h3M18 13h3M6.2 7.2l2 2M15.8 7.2l-2 2M6.2 18.8l2-2M15.8 18.8l-2-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
    clock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9 3h6"/></svg>',
  };

  function el(tag, cls, html) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function initQuietChrome(game) {
    if (!game || typeof game.getState !== "function") return null;
    document.body.classList.add("quiet-chrome-ui");

    const root = el("div", "quiet-chrome");
    root.id = "quiet-chrome";

    // Top readout — small, mono, low contrast; the numbers a sweeper needs.
    const stats = el("div", "qc-stats");
    stats.setAttribute("aria-live", "off");
    const mines = el("span", "qc-stat qc-mines", ICONS.mine + '<b id="qc-mines">0</b>');
    const time = el("span", "qc-stat qc-time", ICONS.clock + '<b id="qc-time">0</b>');
    stats.appendChild(mines);
    stats.appendChild(time);
    root.appendChild(stats);

    // Bottom bar.
    const bar = el("div", "qc-bar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Game controls");
    function button(id, label, icon) {
      const b = el("button", "qc-btn qc-" + id, icon);
      b.type = "button";
      b.id = "qc-" + id;
      b.setAttribute("aria-label", label);
      return b;
    }
    const undo = button("undo", "Undo last move", ICONS.undo);
    const reset = button("reset", "New sphere", ICONS.reset);
    const flag = button("flag", "Flag mode", ICONS.flag);
    flag.setAttribute("aria-pressed", "false");
    const help = button("help", "Help and settings", ICONS.help);
    const left = el("div", "qc-group qc-left");
    left.appendChild(undo);
    left.appendChild(reset);
    left.appendChild(flag);
    const right = el("div", "qc-group qc-right");
    right.appendChild(help);
    bar.appendChild(left);
    bar.appendChild(right);
    root.appendChild(bar);

    const live = el("p", "qc-live");
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    root.appendChild(live);
    document.body.appendChild(root);

    function announce(text) {
      live.textContent = "";
      setTimeout(() => { live.textContent = text; }, 20);
    }

    function paint() {
      const st = game.getState();
      const left = Math.max(0, (st.mineCount | 0) - (st.flagsPlaced | 0));
      const m = document.getElementById("qc-mines");
      const t = document.getElementById("qc-time");
      if (m) m.textContent = String(left);
      if (t) t.textContent = String(st.timeElapsed | 0);
      const armed = !!st.flagMode;
      flag.setAttribute("aria-pressed", armed ? "true" : "false");
      flag.classList.toggle("is-armed", armed);
      flag.innerHTML = armed ? ICONS.flagFilled : ICONS.flag;
      const can = typeof game.canUndo === "function" ? game.canUndo() : true;
      undo.classList.toggle("is-idle", !can);
      undo.setAttribute("aria-disabled", can ? "false" : "true");
    }

    undo.addEventListener("click", (e) => {
      e.preventDefault();
      const ok = typeof game.undo === "function" && game.undo();
      announce(ok ? "Move undone" : "Nothing to undo");
      paint();
    });
    reset.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof game.reset === "function") game.reset();
      announce("New sphere");
      paint();
    });
    flag.addEventListener("click", (e) => {
      e.preventDefault();
      const next = !game.getState().flagMode;
      if (typeof game.setFlagMode === "function") game.setFlagMode(next);
      announce(next ? "Flag mode on" : "Flag mode off");
      paint();
    });
    help.addEventListener("click", (e) => {
      e.preventDefault();
      const b = document.getElementById("help-btn");
      if (b) b.click();
    });

    // Hidden second sphere. Hold the mine count and the readout fills with
    // water; keep holding and you drop into the Water Wheel (the sphere where
    // armed mines must be spun below the waterline). The sphere autosaves on
    // pagehide, so nothing is lost by leaving. Screen-reader users get the
    // same door as a named (visually hidden) button rather than a gesture.
    const wheelHref = global.HEXSWEEPER_WHEEL_HREF || "../wheel/";
    const HOLD_MS = 1200;
    let holdTimer = null;
    let hintTimer = null;
    function openWheel() {
      announce("Opening the Water Wheel");
      if (typeof game.pauseTimer === "function") game.pauseTimer();
      window.location.href = wheelHref;
    }
    function cancelHold() {
      clearTimeout(holdTimer);
      clearTimeout(hintTimer);
      holdTimer = null;
      hintTimer = null;
      mines.classList.remove("is-holding", "is-hinting");
    }
    function startHold(e) {
      if (e.type === "pointerdown" && e.button !== 0) return;
      cancelHold();
      mines.classList.add("is-holding");
      hintTimer = setTimeout(() => mines.classList.add("is-hinting"), 300);
      holdTimer = setTimeout(() => {
        cancelHold();
        openWheel();
      }, HOLD_MS);
    }
    mines.classList.add("qc-egg-door");
    mines.addEventListener("pointerdown", startHold);
    ["pointerup", "pointercancel", "pointerleave"].forEach((type) => mines.addEventListener(type, cancelHold));
    mines.addEventListener("contextmenu", (e) => e.preventDefault());
    const eggBtn = el("button", "sr-only qc-egg-btn", "Open the Water Wheel, a hidden sphere where mines are quenched underwater");
    eggBtn.type = "button";
    eggBtn.id = "qc-wheel";
    eggBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openWheel();
    });
    root.appendChild(eggBtn);

    setInterval(paint, 250);
    paint();

    return {
      root,
      paint,
      announce,
    };
  }

  global.initQuietChrome = initQuietChrome;
})(typeof window !== "undefined" ? window : globalThis);
