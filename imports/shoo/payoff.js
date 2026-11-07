/* Shoo · colour and sound for a reward. By Luke Steuber.
   Play stays paper and ink; colour is the reward. Board n takes Loop's
   Mandaza palette (n - 1) mod 6 (Aurora, Sunset, Vaporwave, Cyberpunk,
   Risograph, Dichromat), skipping stops too pale for light paper or too dark
   for black. Colour only decorates: nothing a player must tell apart depends
   on it. Sound, when it is turned on, is synthesised here: a soft pitched tick
   for each bee shooed and a short rising chord for a finished board. No
   AudioContext exists until the first sound after Sound is turned on. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShooPayoff = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const palettes = [
    '#3c096c #5a189a #9d4edd #48bfe3 #80ffdb', // Aurora
    '#ff006e #fb5607 #ffbe0b #fee440 #fff3b0', // Sunset
    '#ff71ce #b967ff #01cdfe #05ffa1 #fffb96', // Vaporwave
    '#ff006e #fb5607 #ffbe0b #8338ec #3a86ff', // Cyberpunk
    '#ff5e5b #ffed66 #00cecb #5c5cff', // Risograph
    '#0072b2 #56b4e9 #f0e442 #e69f00 #d55e00' // Dichromat
  ].map(p => p.split(' ').map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))));
  const NAMES = ['Aurora', 'Sunset', 'Vaporwave', 'Cyberpunk', 'Risograph', 'Dichromat'];
  const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  // The stops that show on this paper, as Loop chooses them.
  const visibleStops = (palette, night) => palette.filter(rgb => night ? luminance(rgb) >= .06 : luminance(rgb) <= .7);
  const paletteFor = (index, night) => visibleStops(palettes[index % palettes.length], night);
  // A colour along the palette, t from 0 to 1.
  function colourAt(stops, t) {
    t = Math.min(.99999, Math.max(0, t));
    if (stops.length === 1) return `rgb(${stops[0].join(', ')})`;
    const at = t * (stops.length - 1), i = Math.min(Math.floor(at), stops.length - 2), f = at - i;
    return `rgb(${stops[i].map((v, c) => Math.round(v + (stops[i + 1][c] - v) * f)).join(', ')})`;
  }
  // Sound: made only when asked for, and quiet.
  const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
  function sound() {
    let ctx = null, made = 0;
    const context = () => {
      if (!ctx) { const A = globalThis.AudioContext || globalThis.webkitAudioContext; if (!A) return null; ctx = new A(); made++; }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    };
    function note(freq, at, length, level) {
      const c = context(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + at;
      o.type = 'triangle'; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + length);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + length + .02);
    }
    const pitch = step => 523.25 * 2 ** (PENTATONIC[Math.min(PENTATONIC.length - 1, Math.max(0, step))] / 12);
    return {
      // One soft tick, higher as more bees are home.
      tick(step = 0) { note(pitch(step), 0, .09, .05); },
      // A short rising chord.
      chord() { [0, 4, 7, 12].forEach((k, i) => note(523.25 * 2 ** (k / 12), i * .07, .5, .045)); },
      get made() { return made; },
      close() { if (ctx) { ctx.close().catch(() => {}); ctx = null; } }
    };
  }
  return { palettes, NAMES, luminance, visibleStops, paletteFor, colourAt, sound };
});
