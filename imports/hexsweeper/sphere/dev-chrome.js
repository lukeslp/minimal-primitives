/*
 * File Purpose: Drive the sphere's Customize panel — Board · Theme · Counts · Tap action.
 * Primary Functions/Classes: initDevChrome(game).
 * Inputs: the handle returned by SphereSweeper.boot. Outputs: live state changes.
 * Notes: uses the exported setters, never synthetic clicks on the hidden HUD, so a
 *   step is one state change rather than N cycles.
 * A11y: rows are groups with Left/Right stepping; one polite live region for the
 *   whole panel announces the new value with its meaning.
 * Author: Luke Steuber <luke@lukesteuber.com>
 */
(function (global) {
  "use strict";

  const SIZES = [
    ["xsmall", "Extra small", "162 faces"],
    ["easy", "Small", "362 faces"],
    ["medium", "Medium", "1002 faces"],
    ["hard", "Large", "1442 faces"],
    ["xlarge", "Extra large", "2252 faces"],
  ];

  const COUNTS = [
    ["numerals", "Numerals", "1 2 3"],
    ["rings", "Rings", "concentric"],
    ["yellow", "Yellow", "flat"],
    ["flush", "Flush", "flat"],
    ["borderless", "Borderless", "seamless"],
  ];

  /** Global effects preference — shared with every other Hexsweeper page. */
  const FX = [
    ["auto", "Auto", "follow system"],
    ["full", "Full", "all motion"],
    ["reduced", "Reduced", "motion off"],
  ];

  function readFx() {
    try {
      return localStorage.getItem(SphereSweeper.EFFECTS_KEY) || "auto";
    } catch (_) {
      return "auto";
    }
  }

  const TAP = [
    [false, "Dig", "hold to flag"],
    [true, "Flag", "hold to dig"],
  ];

  function themeMeta(def) {
    if (!def) return "";
    if (def.id === "earth" || def.id === "moon") return "globe map";
    if (def.id === "float" || def.id === "card") return "contact shadow";
    if (def.id === "glow") return "luminous digs";
    return "mono";
  }

  function initDevChrome(game) {
    const panel = document.getElementById("customize-panel");
    const btn = document.getElementById("customize-btn");
    if (!panel || !btn || !game) return;

    const THEMES = (global.SphereSweeper && global.SphereSweeper.THEMES) || [];

    const live = document.createElement("p");
    live.className = "cz-live";
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    panel.parentNode.appendChild(live);

    /** Rows read their index from live game state, so the panel never drifts. */
    const ROWS = [
      {
        label: "Board",
        len: SIZES.length,
        get: () => Math.max(0, SIZES.findIndex((s) => s[0] === game.getState().difficulty)),
        at: (i) => [SIZES[i][1], SIZES[i][2]],
        set: (i) => game.setSize(SIZES[i][0]),
      },
      {
        label: "Theme",
        len: THEMES.length,
        get: () => game.getThemeIndex(),
        at: (i) => [THEMES[i] ? THEMES[i].name : "—", themeMeta(THEMES[i])],
        set: (i) => game.setThemeIndex(i),
      },
      {
        label: "Counts",
        len: COUNTS.length,
        get: () => Math.max(0, COUNTS.findIndex((c) => c[0] === game.getState().countStyle)),
        at: (i) => [COUNTS[i][1], COUNTS[i][2]],
        set: (i) => game.setCountStyle(COUNTS[i][0]),
      },
      {
        label: "Tap action",
        len: TAP.length,
        flag: true,
        get: () => (game.getState().flagMode ? 1 : 0),
        at: (i) => [TAP[i][1], TAP[i][2]],
        set: (i) => game.setFlagMode(TAP[i][0]),
      },
      {
        label: "Effects",
        len: FX.length,
        get: () => Math.max(0, FX.findIndex((f) => f[0] === readFx())),
        at: (i) => [FX[i][1], FX[i][2]],
        set: (i) => {
          try {
            localStorage.setItem(SphereSweeper.EFFECTS_KEY, FX[i][0]);
          } catch (_) {}
          // Apply to the running game rather than waiting for a reload: the
          // state object is live, and ambient spin should stop the moment you
          // ask for it, not the next time the page boots.
          const reduced = SphereSweeper.effectsReduced();
          const s = game.getState();
          s.reduceMotion = reduced;
          s.ambientSpin = !reduced;
          SphereSweeper.applyEffectsAttribute();
        },
      },
    ];

    function render(focusRow) {
      panel.textContent = "";
      ROWS.forEach((row, ri) => {
        if (!row.len) return;
        const idx = row.get();
        const [name, meta] = row.at(idx);

        const el = document.createElement("div");
        el.className = "cz-row";
        el.tabIndex = 0;
        el.setAttribute("role", "group");
        el.setAttribute("aria-label", row.label + ": " + name + ", " + meta);
        if (row.flag) el.dataset.flag = String(idx === 1);

        const left = document.createElement("div");
        const lab = document.createElement("div");
        lab.className = "cz-label";
        lab.textContent = row.label;
        const val = document.createElement("div");
        val.className = "cz-value";
        val.textContent = name + " ";
        const metaEl = document.createElement("span");
        metaEl.className = "cz-meta";
        metaEl.textContent = "· " + meta;
        val.appendChild(metaEl);
        const dots = document.createElement("div");
        dots.className = "cz-dots";
        for (let i = 0; i < row.len; i++) {
          const d = document.createElement("span");
          d.className = "cz-dot";
          d.dataset.on = String(i === idx);
          dots.appendChild(d);
        }
        left.appendChild(lab);
        left.appendChild(val);
        left.appendChild(dots);

        const step = document.createElement("div");
        step.className = "cz-stepper";
        [-1, 1].forEach((dir) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "cz-step";
          b.textContent = dir < 0 ? "‹" : "›";
          const nx = row.at((idx + dir + row.len) % row.len)[0];
          b.setAttribute(
            "aria-label",
            (dir < 0 ? "Previous " : "Next ") + row.label.toLowerCase() + ", " + nx
          );
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            move(ri, dir);
          });
          step.appendChild(b);
        });

        el.addEventListener("keydown", (e) => {
          if (e.key === "ArrowLeft") { e.preventDefault(); move(ri, -1); }
          else if (e.key === "ArrowRight") { e.preventDefault(); move(ri, 1); }
        });

        el.appendChild(left);
        el.appendChild(step);
        panel.appendChild(el);
      });

      if (typeof focusRow === "number") {
        const rows = panel.querySelectorAll(".cz-row");
        if (rows[focusRow]) rows[focusRow].focus();
      }
    }

    function move(ri, dir) {
      const row = ROWS[ri];
      const next = (row.get() + dir + row.len) % row.len;
      row.set(next);
      // Board size restarts the game; re-read rather than assume the set landed.
      render(ri);
      const [name, meta] = row.at(row.get());
      live.textContent = row.label + ": " + name + ", " + meta;
    }

    let open = false;
    function setOpen(next, restoreFocus) {
      open = next;
      btn.setAttribute("aria-expanded", String(open));
      if (open) {
        panel.hidden = false;
        render(0);
        // Unhide and fade in separate frames, or the transition never runs.
        requestAnimationFrame(() => {
          panel.dataset.open = "true";
        });
      } else {
        panel.dataset.open = "false";
        panel.hidden = true;
        live.textContent = "";
        if (restoreFocus !== false) btn.focus();
      }
    }

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(!open);
    });
    panel.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => {
      if (open) setOpen(false, false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && open) {
        e.stopPropagation();
        setOpen(false);
      } else if (
        (e.key === "c" || e.key === "C") &&
        !e.metaKey && !e.ctrlKey && !e.altKey &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "")
      ) {
        setOpen(!open);
      }
    });

    // The game's own shortcuts still mutate state behind an open panel, so
    // re-read after one. Scoped to those keys and focus-preserving — a blanket
    // re-render would rip focus out from under anyone tabbing the rows.
    const GAME_KEYS = /^[stnfrSTNFR]$/;
    document.addEventListener("keyup", (e) => {
      if (!open || !GAME_KEYS.test(e.key)) return;
      const rows = Array.prototype.slice.call(panel.querySelectorAll(".cz-row"));
      const focused = rows.indexOf(document.activeElement);
      render(focused >= 0 ? focused : undefined);
    });

    setOpen(false, false);
  }

  global.initDevChrome = initDevChrome;
})(window);
