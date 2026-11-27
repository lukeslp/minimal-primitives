/* Cast · 3D: a lit plaster room, its three lamps, input and saves. By Luke Steuber. */
import * as THREE from './vendor/three.module.min.js';

// The campaign (campaign.js) plays twenty-five of the fifty boards in boards.js, in its own order. Saves are checked against
// all fifty, so a finished mark on a board left out stays.
const E = globalThis.CastEngine, R = globalThis.CastReason, ALL = globalThis.CastBoards, boards = globalThis.CastCampaign.map(id => ALL.find(b => b.id === id)), Free = globalThis.CastFree, $ = s => document.querySelector(s);
const KEY = 'cast-3d.v1', NS = 'http://www.w3.org/2000/svg';
// From November 16 to 17, 2026 the campaign was these thirty, and reached (order 2) counted in their order.
const ORDER_2 = ['c01', 'c02', 'c04', 'c03', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10', 'c13', 'c12', 'c11', 'c16', 'c17', 'c18', 'c42', 'c19', 'c38', 'c22', 'c21', 'c20', 'c35', 'c25', 'c36', 'c29', 'c43', 'c48', 'c41', 'c50'];
// Board 21 was c25 until November 19, 2026. Its floor outline, the pinwheel, drew a swastika, so it left the campaign and
// c27, its near twin, took its place. A save on c25 opens c27 fresh, a finished c25 also marks c27 finished, and a save
// that had c25 open has c27 open. c25 stays in boards.js so its marks still load, but nothing serves it.
const RETIRED = {c25: 'c27'}, live = id => RETIRED[id] || id;
const board = $('#board'), canvas = $('#scene'), marks = $('#marks'), reducedQuery = matchMedia('(prefers-reduced-motion:reduce)'), forcedColors = matchMedia('(forced-colors:active)');
// Room proportions in cube units: wall thickness, the cube's bevel and the carried cube's lift. The room
// stands flush on the page, which is the ground plane. The camera is truly isometric. Shadow maps are
// 1024 square: under a fifth of a pixel per texel at desk sizes, so every shadow edge lands on its
// square boundary to well within a pixel.
// MAX_CUBES bounds the tray and stack buffers; boards hold at most 26 cubes.
// A count with its noun, singular for one: "1 cube", "2 cubes".
const nOf = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const MAX_CUBES = 32, WALL = .1, BEVEL = .03, LIFT = .045, ELEV = Math.atan(Math.SQRT1_2), MAX_PIXELS = 4.6e6, SHADOW_MAP = 1024;
// The view rests. Front is the true isometric view from the room's open corner. Left and right swing
// the camera VIEW_SWING round the room's upright axis and lift it to VIEW_LIFT, to look over and round a
// tall stack; past about 25 degrees the far wall would turn nearly edge-on. A sideways drag of REST_PX
// moves one rest; VIEW_MS is the settle.
const DEG = Math.PI / 180, VIEW_SWING = 25 * DEG, VIEW_LIFT = 50 * DEG, REST_PX = 80, VIEW_MS = 260;
const RESTS = [{name: 'left', az: -VIEW_SWING, el: VIEW_LIFT}, {name: 'front', az: 0, el: ELEV}, {name: 'right', az: VIEW_SWING, el: VIEW_LIFT}];
const FRONT = RESTS.findIndex(r => r.name === 'front');
// The default ground is a dark gallery: the white model stands on a thin slab and spills a dim pool of its
// light onto the charcoal round it. ?ground=paper keeps the flush paper page for comparison (not saved).
const PAPER = new URLSearchParams(location.search).get('ground') === 'paper', SLAB = PAPER ? 0 : .14, GROUND_Y = -SLAB;
// Each lamp is split into two coincident halves. The PREVIEW half ignores a carried cube, so the
// carried cube's shadow keeps that share of the light and reads lighter than a settled shadow.
// Lamp strengths: the floor lamp brightest, so tops read white, then the left wall's, then the right's.
// The hemisphere fill keeps shadows deep but never black; SOFT is the shadow edge's half-width in cube units.
const PREVIEW = .27, LAMP = {floor: 5.2, left: 2.5, right: .95}, FILL = 1, EXPOSURE = 1, SOFT = .016;
// On paper, FLOOR is chosen so the lit floor renders as the page's own paper, continuous with it.
const ROOM = '#ebe8e2', CUBE = '#f4f0e8', FLOOR = '#d1c9b8', GROUND = 0xc6c4bf;
// Basic colours for state, always over the lightness and pattern differences: spill, a shadow where none
// is needed, is warm red-orange (chosen to keep its lightness).
const COLOURS = `#define C3_SPILL vec3( 1.72, 0.85, 0.53 )
#define C3_WRONG vec3( 0.62, 0.15, 0.06 )
`;
// The finish gives the room its color. Correct play is black and white; when the three shadows match, the two walls
// and the floor take one flat color each, the shadows on them go solid black, and the sculpture stays white,
// drawn flat with a black line wherever one of its planes ends. The colors are three of Slant's four: pink on
// the left wall, blue on the right, yellow on the floor. Nothing about the light changes: the color is laid
// over the finished frame in display color, past the tone curve, so it is exact, and the lamps, the exposure
// and the pool on the ground stay as in play. The solved board is said in words and the next arrow shows with
// it, so the color marks nothing they do not. Under forced colors the room takes no color: the shadows still
// go black and the cubes flat white, on the plaster walls.
const PAINT = {left: '#da5cce', right: '#1768ff', floor: '#ffe000'}, INK = '#111111';
const glslColor = hex => `vec3( ${[1, 3, 5].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4)).join(', ')} )`;
// RULE is the black line's width in cube units; it is drawn that many pixels wide whichever way a face leans.
// SHADES are the white of a finished cube's top and of its two sides: flat steps, as on Towers' towers.
const RULE = .036, SHADES = [1, .82, .66];
// A wall at the finish: its color, with the shadow the stacks cast on it in black, as rgb and cover. G is
// the wall point's change per pixel, for an edge one pixel soft.
const FINISH_GLSL = `#define C3_BLACK ${glslColor(INK)}
uniform float uFlat;
uniform float uTone;
vec4 c3FinishWall( vec3 p, vec3 G ) {
	vec2 ab = uSurface == 0 ? p.zy : p.xy;
	if ( ab.x < 0.0 || ab.x > uN || ab.y < 0.0 || ab.y > uWallH ) return vec4( 0.0 );
	float g = floor( ab.x + 0.5 ), w = clamp( ( ab.x - g ) / max( uSurface == 0 ? G.z : G.x, 0.000001 ) + 0.5, 0.0, 1.0 ), gy = max( G.y, 0.000001 );
	float shade = mix( clamp( ( c3View( g - 1.0 ) - ab.y ) / gy + 0.5, 0.0, 1.0 ), clamp( ( c3View( g ) - ab.y ) / gy + 0.5, 0.0, 1.0 ), w );
	return vec4( mix( uSurface == 0 ? ${glslColor(PAINT.left)} : ${glslColor(PAINT.right)}, C3_BLACK, shade ), max( shade, uTone ) );
}
`;

const copy = h => h.map(row => row.slice());
const validHeights = (h, b) => Array.isArray(h) && h.length === b.n && h.every(row => Array.isArray(row) && row.length === b.n && row.every(v => Number.isInteger(v) && v >= 0 && v <= b.maxH)) && E.used(h) <= b.cubes;
const validHits = v => Number.isSafeInteger(v) && v >= 0;
// Saves carry a revision. Revision 2 (November 2026) kept boards 1–10 and redrew the other forty.
const REVISION = 2, REDRAWN = new Set(ALL.slice(10).map(b => b.id)), RECENT = 30;
let saved = null, preserveSave = false;
try {
  const raw = localStorage.getItem(KEY);
  if (raw !== null) {
    const v = JSON.parse(raw), b = ALL.find(b => b.id === v?.board);
    if (v?.revision !== undefined && v.revision !== REVISION) throw new Error('Invalid save');
    // Revision 2 redrew boards 11–50. Cubes saved on one of them belong to the old board and may not even
    // fit the new one, so that board opens empty, with its hits and undo cleared; finished boards, opened
    // boards and the motion setting load as saved, and every other board keeps its cubes.
    if (b && v.revision === undefined && REDRAWN.has(b.id) && validHits(v.hits) && Array.isArray(v.history)) { v.heights = E.start(b); v.hits = 0; v.history = []; }
    if (!v || !b || !validHeights(v.heights, b) || !validHits(v.hits) || !Array.isArray(v.finished) || !v.finished.every(id => ALL.some(b => b.id === id)) || !['system', 'reduce'].includes(v.motion) || !Array.isArray(v.history) || !v.history.every(s => validHeights(s.heights, b) && validHits(s.hits))) throw new Error('Invalid save');
    if (v.campaign !== undefined && (v.campaign !== 2 || !Number.isInteger(v.reached) || v.reached < 0 || v.reached >= (v.order === 3 ? boards : v.order === 2 ? ORDER_2 : ALL).length)) throw new Error('Invalid save');
    // Free play keeps its own board beside the campaign's: its seed, cubes, hits and undo. The campaign's
    // fields stay as they were, so a save from free play still opens in a page from before it. A free slot
    // that cannot be read is dropped and the campaign loads as saved.
    if (v.free !== undefined) {
      const f = v.free, fb = f && Free && Free.fromSeed(f.seed);
      v.free = fb && validHeights(f.heights, fb) && validHits(f.hits) && Array.isArray(f.history) && f.history.every(s => validHeights(s.heights, fb) && validHits(s.hits)) ? {board: fb, heights: f.heights, hits: f.hits, history: f.history} : undefined;
    }
    if (v.play !== undefined && v.play !== 'free') throw new Error('Invalid save');
    // The seeds of free boards played lately, so a new one is not one of them.
    v.recent = Array.isArray(v.recent) ? v.recent.filter(x => Number.isInteger(x) && x >= 0 && x < 0x80000000).slice(-RECENT) : [];
    saved = v;
  }
} catch (_) { preserveSave = true; }
let puzzle = ALL.find(b => b.id === saved?.board) || boards[0], heights = saved ? copy(saved.heights) : E.start(puzzle), hits = saved?.hits || 0;
let history = saved?.history || [], finished = new Set(saved?.finished || []), prefs = {motion: saved?.motion || 'system'};
for (const id of [...finished]) if (RETIRED[id]) finished.add(RETIRED[id]);
if (RETIRED[puzzle.id]) { puzzle = ALL.find(b => b.id === RETIRED[puzzle.id]); heights = E.start(puzzle); hits = 0; history = []; }
// A player last on a board left out of the campaign goes on from the first campaign board not finished, or, with all
// twenty-five finished, from the last, where free play opens. One of the five boards that left on November 17, 2026
// goes on from the open campaign board nearest it among the thirty (placed once `reached` is known, below).
const leftBoard = !boards.includes(puzzle) && ORDER_2.includes(puzzle.id) && !boards.every(b => finished.has(b.id)) ? puzzle.id : null;
if (!boards.includes(puzzle)) { puzzle = boards.find(b => !finished.has(b.id)) || boards.at(-1); heights = E.start(puzzle); hits = 0; history = []; }
// Free play: after the last board, boards drawn in the page by the campaign's rules. `mode` is the board in
// hand; the other one waits in `parked` (the campaign's board while playing free, the free board otherwise).
let mode = 'campaign', parked = saved?.free ? {...saved.free} : null, recent = saved?.recent || [];
if (saved?.play === 'free' && parked) { parked = {board: puzzle, heights, hits, history}; ({board: puzzle, heights, hits, history} = {...saved.free, heights: copy(saved.free.heights)}); mode = 'free'; }
const isFree = () => mode === 'free';
const complete = () => boards.every(b => finished.has(b.id));
// The campaign: boards up to `reached` are open. A fresh save opens board 1; solving a board opens the
// next for good. A save from before the campaign keeps boards 1–12 open, and finishing any board opens
// its successor, so a save that finished board 12 opens board 13.
const openedBy = done => Math.max(-1, ...[...done].map(id => boards.findIndex(b => b.id === id))) + 1;
// Before November 16, 2026 the campaign was all fifty, in boards.js's order, and reached counted in that order; until
// November 17 it was the thirty of ORDER_2 (order 2); now order 3 counts in campaign.js. Every campaign board a save had
// open stays open.
const fromSave = saved ? (saved.campaign === 2 ? saved.reached : 11) : 0, opened = saved?.order === 3 ? fromSave : Math.max(-1, ...(saved?.order === 2 ? ORDER_2.map(id => ALL.find(b => b.id === id)) : ALL).slice(0, fromSave + 1).map(b => boards.findIndex(x => x.id === live(b.id))));
let reached = Math.min(boards.length - 1, Math.max(opened, openedBy(finished), saved ? boards.indexOf(isFree() ? parked.board : puzzle) : 0));
if (leftBoard && !isFree()) { const at = ORDER_2.indexOf(leftBoard), far = b => Math.abs(ORDER_2.indexOf(b.id) - at); puzzle = boards.slice(0, reached + 1).reduce((best, b) => far(b) < far(best) || (far(b) === far(best) && ORDER_2.indexOf(b.id) > ORDER_2.indexOf(best.id)) ? b : best); heights = E.start(puzzle); }
let hint = null, focus = [0, 0], keyboard = false, hover = null, gesture = null, carry = null, wheel = null;
let busy = false, queue = [], epoch = 0;
// `tint` is how far the finish's color has come in, 0 in play and 1 on a finished board.
let tint = E.solved(puzzle, heights) ? 1 : 0, settle = null, flight = null, refusal = null, ready = false, frames = 0, frameQueued = false, shadowsDirty = true, carryCasts = false;
// HOLD_MS: a still press this long on a stack returns its top cube to the tray.
const timing = {}, FINISH_MS = 600, HOLD_MS = 450;
const reduced = () => prefs.motion === 'reduce' || reducedQuery.matches;
const solvedNow = () => E.solved(puzzle, heights);
const wallHeight = () => puzzle.maxH + .25;
function announce(message) { $('#announcement').textContent = message; }
// Wins after the campaign: free boards solved by a move with the campaign finished, counted from 2026-11-19 on (no
// earlier save records them). `held` names the board counted last ('free:' and its seed), so Undo and the same move,
// Restart, or a reload of that board count nothing more. A key of its own: the main save keeps its fields.
const PLUS_STORE = 'cast-3d.plus.v1';
let plus = {version: 1, wins: 0, held: ''}, plusBlocked = false;
try {
  const raw = localStorage.getItem(PLUS_STORE);
  if (raw !== null) {
    const v = JSON.parse(raw);
    if (!v || v.version !== 1 || !Number.isInteger(v.wins) || v.wins < 0 || typeof v.held !== 'string') throw new Error('Invalid save');
    plus = {version: 1, wins: v.wins, held: v.held};
  }
} catch (_) { plusBlocked = true; }
function countPlus() {
  const id = 'free:' + puzzle.seed;
  if (!isFree() || !complete() || plus.held === id) return;
  plus.wins++; plus.held = id;
  if (!plusBlocked) try { localStorage.setItem(PLUS_STORE, JSON.stringify(plus)); } catch (_) {}
}
function save() {
  if (preserveSave) return;
  const here = {board: puzzle, heights, hits, history}, camp = isFree() ? parked : here, free = isFree() ? here : parked;
  const record = {board: camp.board.id, heights: camp.heights, hits: camp.hits, history: camp.history, finished: [...finished], ...prefs, campaign: 2, order: 3, reached, revision: REVISION};
  if (free) record.free = {seed: free.board.seed, heights: free.heights, hits: free.hits, history: free.history};
  if (isFree()) record.play = 'free';
  if (recent.length) record.recent = recent;
  try { localStorage.setItem(KEY, JSON.stringify(record)); } catch (_) {}
}
function snapshot() { return {n: puzzle.n, maxH: puzzle.maxH, heights: copy(heights), tray: E.compare(puzzle, heights).tray, solved: solvedNow(), hits, par: E.par(puzzle), match: E.compare(puzzle, heights)}; }

// Contact darkening from the column heights and the walls, shared by the room and the page around it.
// The floor's visible share of it: all of the fill and half of the floor lamp.
// SOLID_GLSL says whether a point is inside the floor, a wall or a stack.
const SOLID_GLSL = `#define C3_WALL ${WALL.toFixed(3)}
float c3Height( float c, float r ) {
	if ( c < 0.0 || r < 0.0 || c >= uN || r >= uN ) return 0.0;
	return uH[ int( r ) * 5 + int( c ) ];
}
float c3Solid( vec3 p ) {
	if ( p.y < 0.0 ) return 1.0;
	if ( p.x <= - C3_WALL || p.z <= - C3_WALL || p.x >= uN || p.z >= uN ) return 0.0;
	if ( p.x < 0.0 || p.z < 0.0 ) return p.y < uWallH ? 1.0 : 0.0;
	return p.y < c3Height( floor( p.x ), floor( p.z ) ) ? 1.0 : 0.0;
}
`;
const CONTACT_GLSL = `#define C3_MAX_CUBES ${MAX_CUBES}
#define C3_AO 0.6
#define C3_AO_RANGE 0.55
#define C3_AO_DIRECT 0.5
#define C3_FLOOR_SHARE ${((FILL + LAMP.floor * .5) / (FILL + LAMP.floor)).toFixed(4)}
` + SOLID_GLSL + `float c3Fall( float d, float range ) { float k = clamp( 1.0 - d / range, 0.0, 1.0 ); return k * k; }
// Occluder across the next cell boundary in direction t, blended with its lateral neighbour on the
// nearer side so the darkening stays continuous across cell edges.
float c3Occ( vec3 q, vec3 t, float dist, vec3 lat, float la, float lb ) {
	vec3 base = q + t * ( dist + 0.02 );
	float near = min( la, lb ), w = 0.5 * clamp( 1.0 - near * 2.0, 0.0, 1.0 );
	vec3 side = la < lb ? lat * ( la + 0.02 ) : - lat * ( lb + 0.02 );
	return mix( c3Solid( base ), c3Solid( base + side ), w );
}
float c3GridAO( vec3 p, vec3 N ) {
	vec3 a = abs( N );
	vec3 n = ( a.x >= a.y && a.x >= a.z ) ? vec3( sign( N.x ), 0.0, 0.0 ) : ( a.y >= a.z ? vec3( 0.0, sign( N.y ), 0.0 ) : vec3( 0.0, 0.0, sign( N.z ) ) );
	vec3 t1 = abs( n.y ) > 0.5 ? vec3( 1.0, 0.0, 0.0 ) : vec3( 0.0, 1.0, 0.0 );
	vec3 t2 = abs( cross( n, t1 ) );
	vec3 q = p + n * 0.012;
	float s1 = dot( q, t1 ), s2 = dot( q, t2 );
	float a1 = 1.0 - fract( s1 ), b1 = fract( s1 ), a2 = 1.0 - fract( s2 ), b2 = fract( s2 );
	const float R = C3_AO_RANGE;
	return ( 1.0 - C3_AO * c3Occ( q, t1, a1, t2, a2, b2 ) * c3Fall( a1, R ) )
		* ( 1.0 - C3_AO * c3Occ( q, - t1, b1, t2, a2, b2 ) * c3Fall( b1, R ) )
		* ( 1.0 - C3_AO * c3Occ( q, t2, a2, t1, a1, b1 ) * c3Fall( a2, R ) )
		* ( 1.0 - C3_AO * c3Occ( q, - t2, b2, t1, a1, b1 ) * c3Fall( b2, R ) );
}
// Soft, even occlusion pools on the floor and the page: every wall, stack and tray cube darkens the paper
// round its base by its height, like a table under a broad softbox. A hairline groove runs round the
// floor's open front edges.
float c3Box2( vec2 p, vec2 lo, vec2 hi ) { vec2 c = 0.5 * ( lo + hi ), e = 0.5 * ( hi - lo ), q = abs( p - c ) - e; return max( length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ), 0.0 ); }
float c3PoolOf( float d, float h ) { float R = 0.2 + 0.32 * min( h, 2.5 ), k = clamp( 1.0 - d / R, 0.0, 1.0 ); return ( 0.2 + 0.06 * min( h, 2.0 ) ) * k * k; }
float c3Pool( vec2 p ) {
	float v = ( 1.0 - c3PoolOf( c3Box2( p, vec2( - C3_WALL ), vec2( 0.0, uN ) ), uWallH ) ) * ( 1.0 - c3PoolOf( c3Box2( p, vec2( - C3_WALL ), vec2( uN, 0.0 ) ), uWallH ) );
	for ( int r = 0; r < 5; r ++ ) for ( int c = 0; c < 5; c ++ ) {
		float h = uH[ r * 5 + c ];
		if ( float( r ) >= uN || float( c ) >= uN || h <= 0.0 ) continue;
		v *= 1.0 - c3PoolOf( c3Box2( p, vec2( float( c ), float( r ) ), vec2( float( c ) + 1.0, float( r ) + 1.0 ) ), h );
	}
	for ( int i = 0; i < C3_MAX_CUBES; i ++ ) {
		if ( i >= uTrayCount ) break;
		vec4 t = uTray[ i ];
		if ( t.w > 0.0 ) v *= 1.0 - c3PoolOf( c3Box2( p, t.xz - t.w, t.xz + t.w ), 2.0 * t.w );
	}
	float e = min( p.x >= 0.0 && p.x <= uN ? abs( p.y - uN ) : 9.0, p.y >= 0.0 && p.y <= uN ? abs( p.x - uN ) : 9.0 );
	return v * ( 1.0 - 0.08 * uPaper * exp( - e / 0.018 ) );
}
`;
// ---------------------------------------------------------------------------------------------
// Plaster shading. One program serves every surface: `uSurface` picks the inked outlines for the
// left wall (0), right wall (1) and floor (2), plain plaster (3), a tray cube (5) or none (6).
// Contact darkening is computed from the column heights, so every concave crease darkens softly.
const SHADER_HEAD = `
varying vec3 vWPos;
varying vec3 vWNorm;
uniform float uH[25];
uniform float uLeftT[5];
uniform float uRightT[5];
uniform float uPlan[25];
uniform float uN;
uniform float uWallH;
uniform float uInk;
uniform float uPaper;
uniform float uGroundY;
uniform float uLeftV[5];
uniform float uRightV[5];
uniform vec4 uTray[${MAX_CUBES}];
uniform int uTrayCount;
uniform int uSurface;
${CONTACT_GLSL}
${COLOURS}
float c3Line( float d, float hw, float px ) {
	float h = max( hw, 0.6 * px );
	return clamp( ( h - d ) / px + 0.5, 0.0, 1.0 ) * ( hw / h );
}
float c3Edge( vec2 p, vec2 lo, vec2 hi ) {
	vec2 c = 0.5 * ( lo + hi ), e = 0.5 * ( hi - lo ), q = abs( p - c ) - e;
	return abs( length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) );
}
float c3Target( float i ) {
	if ( i < 0.0 || i >= uN ) return 0.0;
	return uSurface == 0 ? uLeftT[ int( i ) ] : uRightT[ int( i ) ];
}
float c3Need( float c, float r ) {
	if ( c < 0.0 || r < 0.0 || c >= uN || r >= uN ) return 0.0;
	return uPlan[ int( r ) * 5 + int( c ) ];
}
float c3Hatch( vec2 ab, float px ) {
	float f = ( ab.x + ab.y ) / 0.11;
	return c3Line( abs( f - floor( f + 0.5 ) ) * 0.11 * 0.7071, 0.0055, px );
}
float c3View( float i ) {
	if ( i < 0.0 || i >= uN ) return 0.0;
	return uSurface == 0 ? uLeftV[ int( i ) ] : uRightV[ int( i ) ];
}
// Ink is multiplied onto the plaster, so it sits in the light and in the shadow like a pencil mark. The
// footprint's border and spill's colour stay; the rest fades at the finish, under the room's color.
vec3 c3Ink( vec3 p, float px ) {
	vec3 keep = vec3( 1.0 ), fade = vec3( 1.0 );
	vec3 oc = vec3( 0.15 ), hc = vec3( 0.42 ), wc = vec3( 0.9 );
	if ( uSurface <= 1 ) {
		vec2 ab = uSurface == 0 ? p.zy : p.xy;
		if ( ab.x < 0.0 || ab.x > uN || ab.y > uWallH ) return vec3( 1.0 );
		float i = floor( ab.x ), t = c3Target( i ), g = floor( ab.x + 0.5 );
		float grid = ( g > 0.0 && g < uN ) ? c3Line( abs( ab.x - g ), 0.0035, px ) : 0.0;
		float outline = 0.0;
		for ( int k = - 1; k <= 1; k ++ ) {
			float j = i + float( k ), tj = c3Target( j );
			if ( tj > 0.0 ) outline = max( outline, c3Line( c3Edge( ab, vec2( j, 0.0 ), vec2( j + 1.0, tj ) ), 0.0105, px ) );
		}
		float inside = ( t > 0.0 && ab.y < t ) ? 1.0 : 0.0, spill = ( ab.y >= t && ab.y < c3View( i ) ) ? 1.0 : 0.0;
		fade = mix( vec3( 1.0 ), vec3( 0.84 ), grid ) * mix( vec3( 1.0 ), wc, inside ) * mix( vec3( 1.0 ), hc, inside * c3Hatch( ab, px ) ) * mix( vec3( 1.0 ), oc, outline );
		keep = mix( vec3( 1.0 ), C3_SPILL, spill );
	} else {
		vec2 ab = p.xz;
		if ( ab.x < 0.0 || ab.y < 0.0 || ab.x > uN || ab.y > uN ) return vec3( 1.0 );
		vec2 cell = floor( ab ), g = floor( ab + 0.5 );
		float grid = max( ( g.x > 0.0 && g.x < uN ) ? c3Line( abs( ab.x - g.x ), 0.0042, px ) : 0.0, ( g.y > 0.0 && g.y < uN ) ? c3Line( abs( ab.y - g.y ), 0.0042, px ) : 0.0 );
		// A crisp pencil border on all four edges sets the floor into the page.
		float border = max( max( c3Line( abs( ab.x - 0.009 ), 0.009, px ), c3Line( abs( ab.x - uN + 0.009 ), 0.009, px ) ), max( c3Line( abs( ab.y - 0.009 ), 0.009, px ), c3Line( abs( ab.y - uN + 0.009 ), 0.009, px ) ) );
		float outline = 0.0, wrong = 0.0;
		for ( int dz = - 1; dz <= 1; dz ++ ) for ( int dx = - 1; dx <= 1; dx ++ ) {
			vec2 q = cell + vec2( float( dx ), float( dz ) );
			float need = c3Need( q.x, q.y ), d = c3Edge( ab, q, q + 1.0 );
			if ( need > 0.5 ) outline = max( outline, c3Line( d, 0.0105, px ) );
			else if ( c3Height( q.x, q.y ) > 0.0 ) wrong = max( wrong, c3Line( d, 0.034, px ) );
		}
		float inside = c3Need( cell.x, cell.y );
		fade = mix( vec3( 1.0 ), vec3( 0.74 ), grid * 0.6 ) * mix( vec3( 1.0 ), wc, inside ) * mix( vec3( 1.0 ), hc, inside * c3Hatch( ab, px ) ) * mix( vec3( 1.0 ), oc, outline );
		keep = mix( vec3( 1.0 ), vec3( 0.3 ), border ) * mix( vec3( 1.0 ), vec3( 0.74 ), grid * 0.4 ) * mix( vec3( 1.0 ), C3_WRONG, wrong );
	}
	return keep * mix( vec3( 1.0 ), fade, uInk );
}
${FINISH_GLSL}`;
const PLASTER_AO = `
#include <aomap_fragment>
{
	vec3 c3n = normalize( vWNorm );
	float c3o = 1.0;
	if ( uSurface == 2 ) {
		// The floor is the page: it takes the same pools as the paper round it, on all of its light.
		float pool = c3Pool( vWPos.xz );
		pool = mix( pool, 1.0, uFlat );
		reflectedLight.directDiffuse *= pool; reflectedLight.indirectDiffuse *= pool; reflectedLight.directSpecular *= pool;
	} else {
		if ( uSurface <= 3 || uSurface == 7 ) c3o = c3GridAO( vWPos, c3n );
		else if ( uSurface == 5 && abs( c3n.y ) < 0.5 ) c3o = 1.0 - 0.42 * c3Fall( vWPos.y - uGroundY, 0.09 );
		c3o = mix( c3o, 1.0, uFlat );
		reflectedLight.indirectDiffuse *= c3o;
		reflectedLight.directDiffuse *= mix( 1.0, c3o, C3_AO_DIRECT );
	}
}`;
// Shadow lookups: a smooth tent-filtered PCF in place of the noisy disc, and no lookup at all for a lamp
// that faces away from the surface or is switched off.
const LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin.replace('( directLight.visible && receiveShadow )', '( directLight.visible && receiveShadow && dot( geometryNormal, directLight.direction ) > 0.0 && dot( directLight.color, vec3( 1.0 ) ) > 0.0 )');
const SHADOW_PARS = (() => {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment, a = chunk.indexOf('float getShadow( sampler2DShadow'), b = chunk.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )', a);
  if (a < 0 || b < 0) return chunk;
  return chunk.slice(0, a) + `float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			if ( inFrustum && shadowCoord.z <= 1.0 ) {
				vec2 stepUV = vec2( 0.5 * shadowRadius ) / shadowMapSize;
				float sum = 0.0;
				for ( int y = - 2; y <= 2; y ++ ) for ( int x = - 2; x <= 2; x ++ ) {
					float w = ( 3.0 - abs( float( x ) ) ) * ( 3.0 - abs( float( y ) ) );
					sum += w * texture( shadowMap, vec3( shadowCoord.xy + vec2( float( x ), float( y ) ) * stepUV, shadowCoord.z ) );
				}
				shadow = sum / 81.0;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	` + chunk.slice(b);
})();
function plasterShader(shader) {
  Object.assign(shader.uniforms, U, TRAY, {uSurface: this.userData.surface});
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
    .replace('#include <fog_vertex>', `{
	vec4 c3w = vec4( transformed, 1.0 );
	vec3 c3nrm = objectNormal;
	#ifdef USE_INSTANCING
		c3w = instanceMatrix * c3w;
		c3nrm = mat3( instanceMatrix ) * c3nrm;
	#endif
	vWPos = ( modelMatrix * c3w ).xyz;
	vWNorm = mat3( modelMatrix ) * c3nrm;
}
#include <fog_vertex>`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + SHADER_HEAD)
    .replace('#include <shadowmap_pars_fragment>', SHADOW_PARS)
    .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN)
    .replace('#include <map_fragment>', '#include <map_fragment>\nfloat c3px = length( fwidth( vWPos ) ) * 0.7;\nif ( uSurface <= 2 ) diffuseColor.rgb *= c3Ink( vWPos, c3px );')
    .replace('#include <aomap_fragment>', PLASTER_AO)
    // The finish's color is laid over the finished frame, past the tone curve, so it is exact.
    .replace('#include <colorspace_fragment>', `#include <colorspace_fragment>
if ( uFlat > 0.0 && uSurface <= 2 ) {
	vec3 c3dx = dFdx( vWPos ), c3dy = dFdy( vWPos );
	vec4 c3flat = uSurface == 2 ? vec4( ${glslColor(PAINT.floor)}, uTone ) : c3FinishWall( vWPos, sqrt( c3dx * c3dx + c3dy * c3dy ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, c3flat.rgb, c3flat.a * uFlat );
}`);
}
const U = {
  uH: {value: new Float32Array(25)}, uLeftT: {value: new Float32Array(5)}, uRightT: {value: new Float32Array(5)}, uPlan: {value: new Float32Array(25)},
  uN: {value: 2}, uWallH: {value: 3.25}, uInk: {value: 1}, uPaper: {value: PAPER ? 1 : 0}, uGroundY: {value: GROUND_Y}, uLeftV: {value: new Float32Array(5)}, uRightV: {value: new Float32Array(5)},
  uFlat: {value: 0}, uTone: {value: 1}, uRule: {value: 2}, uFront: {value: 1},
};
const TRAY = {uTray: {value: Array.from({length: MAX_CUBES}, () => new THREE.Vector4())}, uTrayCount: {value: 0}};
function plaster(color, surface) {
  const m = new THREE.MeshStandardMaterial({color, roughness: .93, metalness: 0, dithering: true});
  m.userData.surface = {value: surface};
  m.onBeforeCompile = plasterShader;
  return m;
}
// Rounded cube with a hairline bevel; each face carries half of every rounded edge.
function roundedCube(r, steps) {
  const position = [], normal = [], index = [], tan = [];
  for (let k = 0; k <= steps; k++) tan.push(Math.tan(Math.PI / 4 * k / steps));
  const samples = [...tan.slice().reverse().map(t => -.5 + r - r * t), ...tan.map(t => .5 - r + r * t)], k = samples.length;
  for (const [a, s] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
    const u = (a + 1) % 3, v = (a + 2) % 3, base = position.length / 3;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
      const p = [0, 0, 0]; p[a] = s * .5; p[u] = samples[i]; p[v] = samples[j];
      const c = p.map(x => Math.max(-.5 + r, Math.min(.5 - r, x))), d = p.map((x, q) => x - c[q]), len = Math.hypot(...d), n = d.map(x => x / len);
      position.push(c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r); normal.push(...n);
    }
    for (let j = 0; j < k - 1; j++) for (let i = 0; i < k - 1; i++) {
      const A = base + j * k + i, B = A + 1, C = A + k + 1, D = A + k;
      if (s > 0) index.push(A, B, C, A, C, D); else index.push(A, C, B, A, D, C);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  g.setIndex(index); g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Scene
// The camera's axes at view position s, measured in rests (0 left, 1 front, 2 right) and eased linearly
// between them: R is screen right, U screen up, F toward the camera and H the level part of F. At the
// front rest they are the isometric axes.
function axesAt(s) {
  const i = Math.max(0, Math.min(RESTS.length - 2, Math.floor(s))), k = Math.max(0, Math.min(1, s - i)), a = RESTS[i], b = RESTS[i + 1] || a;
  const az = Math.PI / 4 + a.az + (b.az - a.az) * k, el = a.el + (b.el - a.el) * k, ce = Math.cos(el), se = Math.sin(el), ca = Math.cos(az), sa = Math.sin(az);
  return {az, el, R: new THREE.Vector3(ca, 0, -sa), U: new THREE.Vector3(-se * sa, ce, -se * ca), F: new THREE.Vector3(ce * sa, se, ce * ca), H: new THREE.Vector3(sa, 0, ca)};
}
let AX = axesAt(FRONT), viewAt = FRONT, viewRest = FRONT, viewJob = null;
let renderer, scene, camera, lamps, fill, mats, cubes, flats, carried, casters, carriedCaster, trayMesh, flightMesh, room, layout, frameSize = {w: 1, h: 1}, view = {w: 1, h: 1, scale: 1, cx: 0, cy: 0}, trayView = null, settledCams;
const M = new THREE.Matrix4(), V = new THREE.Vector3(), ndc = new THREE.Vector2(), raycaster = new THREE.Raycaster(), box3 = new THREE.Box3(), hitPoint = new THREE.Vector3();
const GROUND_VERTEX = `varying vec3 vP;
void main() { vec4 w = modelMatrix * vec4( position, 1.0 ); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const GROUND_FRAGMENT = `uniform float uH[25];
uniform float uN;
uniform float uWallH;
uniform vec3 uFloorLit;
uniform float uExposure;
uniform float uPaper;
uniform vec4 uTray[${MAX_CUBES}];
uniform int uTrayCount;
varying vec3 vP;
${CONTACT_GLSL}
// The floor's own lit colour through the same filmic curve, so the page darkens exactly as the floor does.
vec3 c3Film( vec3 c ) {
	const mat3 i = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
	const mat3 o = mat3( vec3( 1.60475, - 0.10208, - 0.00327 ), vec3( - 0.53108, 1.10813, - 0.07276 ), vec3( - 0.07367, - 0.00605, 1.07602 ) );
	c = i * ( c * uExposure / 0.6 );
	c = ( c * ( c + 0.0245786 ) - 0.000090537 ) / ( c * ( 0.983729 * c + 0.4329510 ) + 0.238081 );
	c = clamp( o * c, 0.0, 1.0 );
	return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( vec3( 0.0031308 ), c ) );
}
void main() {
	float dither = ( fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) - 0.5 ) / 255.0;
	if ( uPaper < 0.5 ) {
		// The dark ground: a dim pool of the lamps' light spilling from the white model and each tray cube.
		float light = 0.13 * exp( - c3Box2( vP.xz, vec2( - C3_WALL ), vec2( uN ) ) / 0.32 );
		for ( int i = 0; i < C3_MAX_CUBES; i ++ ) {
			if ( i >= uTrayCount ) break;
			vec4 t = uTray[ i ];
			if ( t.w > 0.0 ) light = 1.0 - ( 1.0 - light ) * ( 1.0 - 0.12 * exp( - c3Box2( vP.xz, t.xz - t.w, t.xz + t.w ) / ( t.w * 1.1 ) ) );
		}
		if ( light < 0.004 ) discard;
		gl_FragColor = vec4( 0.82, 0.8, 0.76, light + dither );
		return;
	}
	float near = c3Box2( vP.xz, vec2( - C3_WALL ), vec2( uN ) );
	for ( int i = 0; i < C3_MAX_CUBES; i ++ ) { if ( i >= uTrayCount ) break; if ( uTray[ i ].w > 0.0 ) near = min( near, c3Box2( vP.xz, uTray[ i ].xz - uTray[ i ].w, uTray[ i ].xz + uTray[ i ].w ) ); }
	if ( near > 1.05 ) discard;
	vec3 lit = c3Film( uFloorLit ), dark = c3Film( uFloorLit * c3Pool( vP.xz ) );
	float a = 1.0 - clamp( dot( dark, vec3( 0.2126, 0.7152, 0.0722 ) ) / dot( lit, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0, 1.0 );
	if ( a < 0.003 ) discard;
	// A half-step of dither keeps the soft gradients free of 8-bit bands.
	gl_FragColor = vec4( 0.0, 0.0, 0.0, a + dither );
}`;
// The finished cubes. They are exact unit cubes laid over the beveled ones and faded in with the room's
// color, so a flat face has no bevel to leave a seam or a pinhole in it, and nothing is swapped at the end.
// Each face is one flat white or gray with a black rule wherever its plane ends.
// The cube's own middle goes to every pixel unchanged: a pixel on an edge is shaded from a point just off the
// face, and must still know which cube it belongs to.
const FLAT_VERTEX = `varying vec3 vP;
flat varying vec3 vN;
flat varying vec3 vCell;
void main() {
	mat4 m = modelMatrix * instanceMatrix;
	vec4 w = m * vec4( position, 1.0 );
	vP = w.xyz; vN = normal; vCell = ( m * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
	gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FLAT_FRAGMENT = `uniform float uH[25];
uniform float uN;
uniform float uWallH;
uniform float uFlat;
uniform float uRule;
uniform float uFront;
varying vec3 vP;
flat varying vec3 vN;
flat varying vec3 vCell;
${SOLID_GLSL}
// The front view looks straight down the cubes' diagonal, so there one cube's outline often falls exactly on
// another's edge. Whether a nearer cube stands on that view's sight line from p, walked square by square.
bool c3Covered( vec3 p ) {
	for ( int i = 0; i < 18; i ++ ) {
		vec3 f = 1.0 - fract( p );
		p += min( f.x, min( f.y, f.z ) ) + 0.0005;
		if ( p.x >= uN || p.z >= uN || p.y >= uWallH ) return false;
		if ( c3Solid( p ) > 0.5 ) return true;
	}
	return false;
}
// A rule uRule pixels wide along a face's edge, d in from it toward t, where G is the point's change per pixel.
// Where the face folds outward the rule is drawn if outer is set; where it meets a nearer face, if inner is;
// where the same plane runs on there is none. Each edge is ruled by one face only, so every rule is one width.
float c3Rule( vec3 cell, vec3 n, vec3 t, float d, vec3 G, bool outer, bool inner ) {
	bool front = c3Solid( cell + t + n ) > 0.5, side = c3Solid( cell + t ) > 0.5;
	if ( ! ( front ? inner : ( ! side && outer ) ) ) return 0.0;
	float ink = clamp( uRule - d / max( dot( abs( t ), G ), 0.000001 ) + 0.5, 0.0, 1.0 );
	// The rule gives way where a nearer cube's outline falls on the same line: the point just across the
	// edge is then covered, and the nearer cube rules that line itself, so no line is drawn twice as wide.
	if ( ink > 0.0 && uFront > 0.5 ) {
		vec3 edge = vP + t * d;
		if ( c3Covered( front ? edge - t * 0.002 + n * 0.004 : edge + t * 0.004 + n * 0.002 ) ) return 0.0;
	}
	return ink;
}
void main() {
	vec3 dx = dFdx( vP ), dy = dFdy( vP ), G = sqrt( dx * dx + dy * dy );
	// The cube's own square and level, and where the point lies in it.
	vec3 cell = vCell, base = cell - 0.5, l = vP - base;
	// A face against a neighbor is inside the sculpture.
	if ( c3Solid( cell + vN ) > 0.5 ) discard;
	const vec3 X = vec3( 1.0, 0.0, 0.0 ), Y = vec3( 0.0, 1.0, 0.0 ), Z = vec3( 0.0, 0.0, 1.0 );
	float line, shade;
	// A top rules its own rim, and its edge against a wall; a side rules its foot and its upright edges, the
	// one the two sides share going to the side that faces the left lamp.
	if ( vN.y > 0.5 ) {
		shade = ${SHADES[0].toFixed(2)};
		line = max( max( c3Rule( cell, Y, X, 1.0 - l.x, G, true, false ), c3Rule( cell, Y, - X, l.x, G, true, base.x < 0.5 ) ), max( c3Rule( cell, Y, Z, 1.0 - l.z, G, true, false ), c3Rule( cell, Y, - Z, l.z, G, true, base.z < 0.5 ) ) );
	} else if ( vN.x > 0.5 ) {
		shade = ${SHADES[1].toFixed(2)};
		line = max( c3Rule( cell, X, - Y, l.y, G, true, true ), max( c3Rule( cell, X, Z, 1.0 - l.z, G, true, true ), c3Rule( cell, X, - Z, l.z, G, true, true ) ) );
	} else {
		shade = ${SHADES[2].toFixed(2)};
		line = max( c3Rule( cell, Z, - Y, l.y, G, true, true ), max( c3Rule( cell, Z, X, 1.0 - l.x, G, false, true ), c3Rule( cell, Z, - X, l.x, G, true, base.x < 0.5 ) ) );
	}
	gl_FragColor = vec4( mix( vec3( shade ), ${glslColor(INK)}, line ), uFlat );
}`;
function setupGL() {
  try {
    renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true, powerPreference: 'high-performance'});
  } catch (_) { return false; }
  if (!renderer.getContext()) return false;
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 120);
  camera.position.copy(AX.F).multiplyScalar(48); camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  fill = new THREE.HemisphereLight(0xffffff, GROUND, FILL); scene.add(fill);
  const size = SHADOW_MAP;
  const lamp = () => {
    const l = new THREE.DirectionalLight(0xffffff, 0);
    l.castShadow = true; l.shadow.mapSize.set(size, size); l.shadow.bias = .0004; l.shadow.normalBias = 0;
    scene.add(l, l.target); return l;
  };
  lamps = {settled: {floor: lamp(), left: lamp(), right: lamp()}, preview: {floor: lamp(), left: lamp(), right: lamp()}};
  settledCams = new Set(Object.values(lamps.settled).map(l => l.shadow.camera));
  mats = {floor: plaster(PAPER ? FLOOR : ROOM, 2), left: plaster(ROOM, 0), right: plaster(ROOM, 1), body: plaster(ROOM, 3), cube: plaster(CUBE, 7), tray: plaster(CUBE, 5), free: plaster(CUBE, 6)};
  const geometry = roundedCube(BEVEL, 3), instanced = (material, count, cast) => {
    const m = new THREE.InstancedMesh(geometry, material, count);
    m.castShadow = cast; m.receiveShadow = cast; m.frustumCulled = false; m.count = 0; scene.add(m); return m;
  };
  cubes = instanced(mats.cube, MAX_CUBES, false); carried = instanced(mats.cube, 1, false); trayMesh = instanced(mats.tray, MAX_CUBES, false); flightMesh = instanced(mats.free, 1, false);
  cubes.receiveShadow = carried.receiveShadow = true;
  carried.count = 1; carried.visible = false; flightMesh.count = 1; flightMesh.visible = false;
  // Shadows come from exact unit cubes standing in for the bevelled ones, so four rounded corners
  // never leave a pinhole of light and every shadow edge falls on a square boundary.
  const hidden = new THREE.MeshBasicMaterial({colorWrite: false, depthWrite: false}), unit = new THREE.BoxGeometry(1, 1, 1);
  const caster = count => { const m = new THREE.InstancedMesh(unit, hidden, count); m.castShadow = true; m.frustumCulled = false; m.count = 0; scene.add(m); return m; };
  casters = caster(MAX_CUBES); carriedCaster = caster(1);
  // The finished cubes stand a hair in front of the beveled ones they cover, and are drawn only at the finish.
  flats = new THREE.InstancedMesh(unit, new THREE.ShaderMaterial({
    transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: {uH: U.uH, uN: U.uN, uWallH: U.uWallH, uFlat: U.uFlat, uRule: U.uRule, uFront: U.uFront}, vertexShader: FLAT_VERTEX, fragmentShader: FLAT_FRAGMENT,
  }), MAX_CUBES);
  flats.frustumCulled = false; flats.count = 0; flats.renderOrder = 2; scene.add(flats);
  // The settled half of each lamp never sees the carried cube.
  carriedCaster.onBeforeShadow = (r, object, cam, shadowCamera) => { if (settledCams.has(shadowCamera)) object.modelViewMatrix.makeScale(0, 0, 0); };
  room = new THREE.Group(); scene.add(room);
  // The page is the ground plane. It draws only darkening over the paper, the same occlusion pools as the
  // floor, so it is continuous with the floor and with the page beyond the canvas.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {uH: U.uH, uN: U.uN, uWallH: U.uWallH, uPaper: U.uPaper, ...TRAY,
      uFloorLit: {value: new THREE.Color(FLOOR).multiplyScalar((LAMP.floor + FILL) / Math.PI)}, uExposure: {value: EXPOSURE}},
    vertexShader: GROUND_VERTEX, fragmentShader: GROUND_FRAGMENT,
  }));
  ground.position.y = GROUND_Y - .0015; ground.renderOrder = 1; scene.add(ground);
  mats.ground = ground.material;
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); });
  canvas.addEventListener('webglcontextrestored', () => { shadowsDirty = true; requestRender(); });
  return true;
}
function placeLamps() {
  const n = puzzle.n, H = wallHeight(), S = Math.max(n, H) + .3, far = n + H + 6;
  const place = (l, position, target, up) => {
    l.position.set(...position); l.target.position.set(...target); l.updateMatrixWorld(); l.target.updateMatrixWorld();
    const c = l.shadow.camera; c.up.set(...up); c.left = -S / 2; c.right = S / 2; c.top = S / 2; c.bottom = -S / 2; c.near = .5; c.far = far; c.updateProjectionMatrix();
    l.shadow.radius = SOFT / (S / l.shadow.mapSize.x);
  };
  // Three lamps, each square to one surface: straight down for the floor, level for each wall.
  for (const g of [lamps.settled, lamps.preview]) {
    place(g.floor, [n / 2, H + 3, n / 2], [n / 2, 0, n / 2], [0, 0, -1]);
    place(g.left, [n + 3, H / 2, n / 2], [0, H / 2, n / 2], [0, 1, 0]);
    place(g.right, [n / 2, H / 2, n + 3], [n / 2, H / 2, 0], [0, 1, 0]);
  }
}
function setLamps(previewing) {
  for (const k of ['floor', 'left', 'right']) {
    lamps.settled[k].intensity = LAMP[k] * (previewing ? PREVIEW : 1);
    lamps.preview[k].intensity = previewing ? LAMP[k] * (1 - PREVIEW) : 0;
  }
}
function buildRoom() {
  for (const m of room.children) m.geometry.dispose();
  room.clear();
  const n = puzzle.n, H = wallHeight(), b = mats.body;
  const block = (w, h, d, x, y, z, faces) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), faces); m.position.set(x, y, z); m.receiveShadow = true; m.updateMatrixWorld(); room.add(m);
  };
  if (PAPER) {
    // On paper the floor is the page itself between the walls; the walls stand straight on it.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(n, n).rotateX(-Math.PI / 2).translate(n / 2, 0, n / 2), mats.floor);
    floor.receiveShadow = true; floor.updateMatrixWorld(); room.add(floor);
  } else block(n + WALL, SLAB, n + WALL, (n - WALL) / 2, -SLAB / 2, (n - WALL) / 2, [b, b, mats.floor, b, b, b]);
  block(WALL, H, n + WALL, -WALL / 2, H / 2, (n - WALL) / 2, [mats.left, b, b, b, b, b]);
  block(n, H, WALL, n / 2, H / 2, -WALL / 2, [b, b, b, b, mats.right, b]);
  U.uN.value = n; U.uWallH.value = H;
  for (const key of ['uLeftT', 'uRightT', 'uPlan']) U[key].value.fill(0);
  puzzle.left.forEach((t, i) => { U.uLeftT.value[i] = t; });
  puzzle.right.forEach((t, i) => { U.uRightT.value[i] = t; });
  puzzle.plan.forEach((row, r) => row.forEach((v, c) => { U.uPlan.value[r * 5 + c] = v; }));
  placeLamps(); computeLayout(); fit();
}
// Screen-space layout in room units for a view's axes: the room, then a row of tray cubes standing on the
// table in front, square to the view, so the tray stays a level row whichever way the camera swings. The
// tray's spacing is taken from the front view's width, so the cubes keep their size as the view swings.
function layoutFor(ax) {
  const n = puzzle.n, H = wallHeight(), pts = [], screen = (x, y, z) => [x * ax.R.x + z * ax.R.z, x * ax.U.x + y * ax.U.y + z * ax.U.z];
  for (const x of [-WALL, n]) for (const z of [-WALL, n]) pts.push(screen(x, GROUND_Y, z), screen(x, 0, z));
  for (const [x, z] of [[-WALL, -WALL], [-WALL, n], [n, -WALL], [0, n], [n, 0]]) pts.push(screen(x, H, z));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), room = {minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys)};
  const cubesN = puzzle.cubes, step = Math.min(.66, (n + WALL) * Math.SQRT2 * .9 / Math.max(1, cubesN)), size = step * .62;
  // A cube's screen extent: up from its base by its height and half its level diagonal, down and sideways by half that diagonal.
  const ce = Math.cos(ax.el), se = Math.sin(ax.el), diag = Math.abs(Math.sin(ax.az)) + Math.abs(Math.cos(ax.az));
  const top = room.minY - .42, base = top - size * (ce + se * diag / 2), a = (GROUND_Y * ce - base) / se, mid = (room.minX + room.maxX) / 2;
  // The row is centered under the room as drawn, which is under the room's back corner only in the front view.
  const slots = Array.from({length: cubesN}, (_, i) => {
    const sx = mid + (i - (cubesN - 1) / 2) * step;
    return new THREE.Vector3().addScaledVector(ax.R, sx).addScaledVector(ax.H, a).setY(GROUND_Y);
  });
  const half = size / 2, trayBottom = base - size * se * diag / 2, trayHalf = ((cubesN - 1) / 2) * step + size * diag / 2;
  const minX = Math.min(room.minX, mid - trayHalf), maxX = Math.max(room.maxX, mid + trayHalf), minY = trayBottom - .06, maxY = room.maxY;
  return {room, tray: {step, size, half, slots, top, bottom: trayBottom}, minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, front: Math.max(...[[n, 0, n], [-WALL, H, n], [n, H, -WALL]].map(([x, y, z]) => x * ax.F.x + y * ax.F.y + z * ax.F.z)) + 2};
}
// One scale for every view: the frame is the largest width and height the layout reaches anywhere along
// the swing, so the room never grows or shrinks as the camera moves. Each view is centered on its own layout.
function computeLayout() {
  let w = 0, h = 0;
  for (let i = 0, steps = 8 * (RESTS.length - 1); i <= steps; i++) { const l = layoutFor(axesAt(i / 8)); w = Math.max(w, l.w); h = Math.max(h, l.h); }
  frameSize = {w, h}; layout = layoutFor(AX);
}
// The canvas covers the whole page, so shadows on the paper run on past the board; the room itself is
// fitted inside the board's rectangle.
function fit() {
  if (!renderer || !layout) return;
  const w = canvas.clientWidth, h = canvas.clientHeight, area = board.getBoundingClientRect();
  if (!w || !h || !area.width || !area.height) return;
  let dpr = Math.min(devicePixelRatio || 1, 2);
  if (w * h * dpr * dpr > MAX_PIXELS) dpr = Math.sqrt(MAX_PIXELS / (w * h));
  renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
  const pad = 8, scale = Math.min((area.width - 2 * pad) / frameSize.w, (area.height - 2 * pad) / frameSize.h);
  view = {w, h, scale, cx: area.left + area.width / 2, cy: area.top + area.height / 2};
  U.uRule.value = RULE * scale * dpr;
  marks.setAttribute('viewBox', `0 0 ${w} ${h}`);
  frame();
}
// Points the camera along the view's axes and centres the view's layout in the board.
function frame() {
  if (!renderer || !layout || !view.cx) return;
  camera.position.copy(AX.F).multiplyScalar(48); camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  camera.left = layout.cx - view.cx / view.scale; camera.right = camera.left + view.w / view.scale;
  camera.top = layout.cy + view.cy / view.scale; camera.bottom = camera.top - view.h / view.scale;
  camera.updateProjectionMatrix();
  const t = layout.tray, w = view.w, scale = view.scale, slots = t.slots.map(p => toView(p.x, p.y + t.size / 2, p.z));
  trayView = {slots, step: t.step * scale, top: toView2(0, t.top)[1], bottom: toView2(0, t.bottom)[1], left: (slots[0]?.x ?? w / 2) - t.step * scale / 2, right: (slots.at(-1)?.x ?? w / 2) + t.step * scale / 2};
  rings(); requestRender();
}
// The view at position s: the camera, the tray row and a floating carried cube follow; the lamps and
// their shadow maps do not depend on the view, so no shadow is redrawn.
function setView(s) {
  viewAt = s; AX = axesAt(s); U.uFront.value = Math.abs(s - FRONT) < 1e-4 ? 1 : 0;
  if (!renderer) return;
  layout = layoutFor(AX); updateTray(); if (carry) updateCarried(carriedBase()); frame();
}
// Settles on a rest: eased unless motion is reduced. The live region names the view when the rest changes
// or when `spoken` (the button and keys) asks.
function goView(index, spoken) {
  const target = Math.max(0, Math.min(RESTS.length - 1, Math.round(index))), changed = target !== viewRest;
  holdView(); const from = viewAt;
  viewRest = target; board.dataset.view = RESTS[target].name;
  if (spoken || changed) announce(`View from the ${RESTS[target].name}.`);
  if (reduced() || document.hidden || !renderer || Math.abs(target - from) < 1e-4) { setView(target); return; }
  const start = performance.now(); let id = 0;
  const job = viewJob = {stop() { animations.delete(job); cancelAnimationFrame(id); if (viewJob === job) viewJob = null; }, finish() { job.stop(); setView(target); }};
  const tick = now => { const t = Math.min(1, (now - start) / VIEW_MS); if (t === 1 || reduced()) { job.finish(); return; } setView(from + (target - from) * (1 - (1 - t) ** 3)); id = requestAnimationFrame(tick); };
  animations.add(job); id = requestAnimationFrame(tick);
}
// A drag in hand stops a settle where it is.
function holdView() { viewJob?.stop(); }
// Board-local CSS pixels for a world point, and for a point given in screen units.
function toView(x, y, z) { V.set(x, y, z).project(camera); return {x: (V.x + 1) / 2 * view.w, y: (1 - V.y) / 2 * view.h}; }
function toView2(sx, sy) { return [(sx - camera.left) * view.scale, (camera.top - sy) * view.scale]; }
function frontPoint(p, keep = 0) {
  // keep: a margin in room units that holds the whole floating cube inside the canvas.
  const m = keep * view.scale, x = Math.max(m, Math.min(view.w - m, p.x)), y = Math.max(m, Math.min(view.h - m, p.y));
  const sx = camera.left + x / view.scale, sy = camera.top - y / view.scale;
  return new THREE.Vector3().addScaledVector(AX.R, sx).addScaledVector(AX.U, sy).addScaledVector(AX.F, layout.front);
}

// ---------------------------------------------------------------------------------------------
// Scene state from game state; renders only on demand.
function carriedBase() {
  return carry?.source ? E.set(puzzle, heights, ...carry.source, heights[carry.source[0]][carry.source[1]] - 1) || heights : heights;
}
function landingNext() {
  if (!carry?.target) return null;
  const base = carriedBase(), [r, c] = carry.target;
  return E.set(puzzle, base, r, c, base[r][c] + 1);
}
function updateCubes(display) {
  let k = 0;
  for (let r = 0; r < puzzle.n; r++) for (let c = 0; c < puzzle.n; c++) for (let z = 0; z < display[r][c]; z++) {
    const lift = settle && settle.r === r && settle.c === c && z === display[r][c] - 1 ? settle.offset : 0;
    M.makeTranslation(c + .5, z + .5 + lift, r + .5); cubes.setMatrixAt(k, M); flats.setMatrixAt(k, M); casters.setMatrixAt(k++, M);
  }
  for (const m of [cubes, casters]) { m.count = k; m.instanceMatrix.needsUpdate = true; m.boundingSphere = null; }
  flats.instanceMatrix.needsUpdate = true;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) U.uH.value[r * 5 + c] = r < puzzle.n && c < puzzle.n ? display[r][c] : 0;
}
function updateCarried(base) {
  carryCasts = false;
  if (!carry) { carried.visible = false; carriedCaster.count = 0; return; }
  carried.visible = true;
  if (landingNext()) {
    const [r, c] = carry.target;
    M.makeTranslation(c + .5, base[r][c] + .5 + LIFT, r + .5);
    carried.material = mats.cube; carried.receiveShadow = true; carryCasts = true;
  } else {
    const p = carry.pointer || (carry.target ? toView(carry.target[1] + .5, base[carry.target[0]][carry.target[1]] + 1.1, carry.target[0] + .5) : toView(puzzle.n / 2, 1, puzzle.n / 2));
    const w = frontPoint(p, .92);
    M.makeTranslation(w.x, w.y, w.z);
    carried.material = mats.free; carried.receiveShadow = false;
  }
  carried.setMatrixAt(0, M); carriedCaster.setMatrixAt(0, M); carriedCaster.count = carryCasts ? 1 : 0;
  for (const m of [carried, carriedCaster]) { m.instanceMatrix.needsUpdate = true; m.boundingSphere = null; }
}
function updateTray() {
  const remaining = E.compare(puzzle, heights).tray, t = layout.tray;
  for (let i = 0; i < remaining; i++) {
    const hidden = (carry && !carry.source && carry.slot === i) || flight?.slot === i, s = hidden ? 0 : t.size, p = t.slots[i];
    trayMesh.setMatrixAt(i, M.makeScale(s || 1e-6, s || 1e-6, s || 1e-6).setPosition(p.x, p.y + t.size / 2, p.z));
    TRAY.uTray.value[i].set(p.x, p.y, p.z, hidden ? 0 : t.half);
  }
  trayMesh.count = remaining; trayMesh.instanceMatrix.needsUpdate = true; trayMesh.boundingSphere = null; TRAY.uTrayCount.value = remaining;
}
// The finish: the ink gives way as the room takes its color, the shadows go black and the finished cubes
// fade in over the plaster ones. The light holds still. Lifting a cube from a finished board puts it back.
function updateLight() {
  const k = !carry && solvedNow() ? tint : 0;
  U.uInk.value = 1 - k; U.uFlat.value = k; U.uTone.value = forcedColors.matches ? 0 : 1;
  flats.count = k > 0 ? cubes.count : 0;
}
function updateScene() {
  if (!renderer) return;
  const base = carriedBase();
  updateCubes(base); updateCarried(base); updateTray(); setLamps(carryCasts); updateLight();
  // Shadow heights for the spill colour, the carried cube's preview included.
  const v = E.views(carryCasts ? landingNext() : base);
  for (let i = 0; i < 5; i++) { U.uLeftV.value[i] = v.left[i] || 0; U.uRightV.value[i] = v.right[i] || 0; }
  shadowsDirty = true; requestRender();
}
function requestRender() {
  if (!renderer || frameQueued) return;
  if (document.hidden) return;
  frameQueued = true;
  requestAnimationFrame(draw);
}
function draw() {
  frameQueued = false;
  if (!ready || document.hidden) return;
  const start = performance.now(), withShadows = shadowsDirty;
  if (shadowsDirty) { renderer.shadowMap.needsUpdate = true; shadowsDirty = false; }
  renderer.render(scene, camera); frames++;
  const ms = performance.now() - start, key = withShadows ? 'shadowFrame' : 'frame';
  timing[key + 'Max'] = Math.max(timing[key + 'Max'] || 0, ms); timing[key + 'Total'] = (timing[key + 'Total'] || 0) + ms; timing[key + 'Count'] = (timing[key + 'Count'] || 0) + 1;
}

// ---------------------------------------------------------------------------------------------
// Marks drawn over the room: focus, hover, hint and refusal rings. They never trigger a render.
function el(tag, attrs, parent = marks) { const node = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); parent.append(node); return node; }
const pts = list => list.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
function topSquare(r, c, z, inset) { return [[r + inset, c + inset], [r + inset, c + 1 - inset], [r + 1 - inset, c + 1 - inset], [r + 1 - inset, c + inset]].map(([rr, cc]) => toView(cc, z, rr)); }
function cubeOutline(center, size) {
  const h = size / 2, corners = [[-h, -h, h], [h, -h, h], [h, -h, -h], [h, h, -h], [-h, h, -h], [-h, h, h]].map(([x, y, z]) => toView(center.x + x, center.y + y, center.z + z));
  return corners;
}
function rings() {
  if (!renderer) return;
  marks.replaceChildren();
  const solved = solvedNow();
  if (hint) {
    el('polygon', {points: pts(topSquare(hint.r, hint.c, heights[hint.r][hint.c] + .004, .06)), class: 'hint-ring'});
    el('polygon', {points: pts(topSquare(hint.r, hint.c, hint.to, .1)), class: 'hint-ghost'});
    const z0 = heights[hint.r][hint.c];
    if (hint.to > z0) for (const [r, c] of [[hint.r + .9, hint.c + .1], [hint.r + .9, hint.c + .9], [hint.r + .1, hint.c + .9]]) { const a = toView(c, z0, r), b = toView(c, hint.to, r); el('line', {class: 'hint-ghost', x1: a.x, y1: a.y, x2: b.x, y2: b.y}); }
    // What forces it, in the hint's own dashes: the wall shadow's whole strip, a line under the cubes left in the tray, or a floor square.
    for (const m of hint.reason ? hint.reason.marks : []) {
      if (m.side === 'left') { const t = puzzle.left[m.i]; el('polygon', {points: pts([[0, m.i + .06], [t, m.i + .06], [t, m.i + .94], [0, m.i + .94]].map(([y, z]) => toView(.004, y, z))), class: 'hint-reason', 'data-wall': 'left', 'data-index': m.i}); }
      else if (m.side === 'right') { const t = puzzle.right[m.i]; el('polygon', {points: pts([[m.i + .06, 0], [m.i + .06, t], [m.i + .94, t], [m.i + .94, 0]].map(([x, y]) => toView(x, y, .004))), class: 'hint-reason', 'data-wall': 'right', 'data-index': m.i}); }
      else if (m.tray) { const left = Math.max(1, E.compare(puzzle, heights).tray), half = trayView.step / 2; el('line', {class: 'hint-reason', 'data-tray': '', x1: trayView.slots[0].x - half, x2: trayView.slots[left - 1].x + half, y1: trayView.bottom + 6, y2: trayView.bottom + 6}); }
      else el('polygon', {points: pts(topSquare(m.r, m.c, m.floor ? .004 : heights[m.r][m.c] + .004, .14)), class: 'hint-reason', 'data-square': `${m.r},${m.c}`});
    }
  }
  if (hover && !gesture && !solved) el('polygon', {points: pts(topSquare(...hover, heights[hover[0]][hover[1]] + .004, .08)), class: 'hover-ring'});
  if (keyboard) el('polygon', {points: pts(topSquare(...focus, heights[focus[0]][focus[1]] + .006, .04)), class: 'focus-ring'});
  if (carry) {
    const base = carriedBase();
    if (carry.target && !landingNext()) el('polygon', {points: pts(topSquare(...carry.target, base[carry.target[0]][carry.target[1]] + .006, .06)), class: 'landing-ring refused-ring'});
    if (!carry.source && carry.slot !== null && carry.slot !== undefined) { const p = layout.tray.slots[carry.slot]; el('polygon', {points: pts(cubeOutline({x: p.x, y: p.y + layout.tray.size / 2, z: p.z}, layout.tray.size)), class: 'tray-slot'}); }
  }
  if (refusal) {
    const g = el('g', {class: refusal.kind === 'tray' ? 'tray refused' : 'column refused', transform: `translate(${refusal.shake.toFixed(2)} 0)`});
    if (refusal.kind === 'tray') el('line', {class: 'tray-line', x1: trayView.left, x2: trayView.right, y1: trayView.bottom + 6, y2: trayView.bottom + 6}, g);
    else el('polygon', {points: pts(topSquare(refusal.r, refusal.c, heights[refusal.r][refusal.c] + .006, .04)), class: 'refused-ring'}, g);
  }
  const v = E.views(heights), m = E.compare(puzzle, heights), status = solved ? ' Solved.' : '';
  board.setAttribute('aria-label', `${boardName()}, ${puzzle.n} by ${puzzle.n}. Heights by row: ${heights.map(row => row.join(', ')).join('; ')}. Left wall shadows ${v.left.join(', ')}; outlines ${puzzle.left.join(', ')}. Right wall shadows ${v.right.join(', ')}; outlines ${puzzle.right.join(', ')}. Floor outline by row: ${puzzle.plan.map(row => row.join(', ')).join('; ')}. ${nOf(m.tray, 'cube')} in the tray. ${nOf(hits, 'move')}, par ${E.par(puzzle)}. Row ${focus[0] + 1}, column ${focus[1] + 1} selected, height ${heights[focus[0]][focus[1]]}. View from the ${RESTS[viewRest].name}.${carry ? ' Carrying a cube. Arrows move it, Space drops it, Escape puts it back.' : ''}${status}`);
  board.dataset.carrying = String(!!carry);
}
// The board's name, and where the next arrow leads once it is solved: the next board; after the last board,
// the first one not yet finished, or New Game+ (free play) once all are; after a New Game+ board, another.
function boardName() { return isFree() ? 'New Game+ board' : `Board ${boards.indexOf(puzzle) + 1} of ${boards.length}`; }
const theEnd = () => !isFree() && puzzle === boards.at(-1) && complete() && solvedNow();
function onward() {
  if (isFree()) return {label: 'Next board', go: () => startFree(true)};
  const i = boards.indexOf(puzzle);
  if (i < boards.length - 1) return {label: 'Next board', go: () => go(boards[i + 1].id)};
  const left = boards.find(b => !finished.has(b.id));
  return left ? {label: `Board ${boards.indexOf(left) + 1}`, go: () => go(left.id)} : {label: 'Start New Game+', go: () => startFree(false)};
}
function sync() {
  updateScene(); rings();
  const solved = solvedNow(), next = onward();
  board.dataset.busy = String(busy); board.dataset.solved = String(solved); board.dataset.mode = mode; board.dataset.end = String(theEnd());
  // The readout names the board: its number, ∞ in free play, and the last board, once all thirty are finished, the end.
  // Free play adds the campaign's count and the wins after it.
  const name = isFree() ? '∞' : theEnd() ? 'The end' : `${boards.indexOf(puzzle) + 1} / ${boards.length}`;
  $('#readout').textContent = `${name} · ${hits} / ${E.par(puzzle)}${isFree() ? ` · ${boards.length}${plus.wins ? ` + ${plus.wins}` : ''} ✓` : ''}`;
  $('#readout').setAttribute('aria-label', `${theEnd() ? 'The end. ' : ''}${boardName()}; ${nOf(hits, 'move')}; par ${E.par(puzzle)}${isFree() ? `; ${boards.length} boards solved${plus.wins ? ` and ${nOf(plus.wins, 'New Game+ board')}` : ''}` : ''}`);
  $('#next-btn').hidden = !(!carry && solved); $('#next-btn').setAttribute('aria-label', next.label);
  // At the end one line stands above the arrow.
  $('#end-line').textContent = `All ${boards.length} boards solved.`; $('#end-line').hidden = $('#next-btn').hidden || !theEnd();
  $('#undo-btn').disabled = !history.length; $('#hint-btn').disabled = solved; updateCatalog();
}

// ---------------------------------------------------------------------------------------------
// Actions, mirroring the minimal Cast.
// Every running animation, so cancelling or reduced motion settles all of them at once.
const animations = new Set(), finishAnimations = () => { for (const job of [...animations]) job.finish(); };
function tween(duration, frame) {
  if (reduced() || document.hidden) { frame(1); return Promise.resolve(); }
  return new Promise(resolve => {
    const start = performance.now(); let id;
    const job = {finish: () => { if (!animations.has(job)) return; animations.delete(job); cancelAnimationFrame(id); frame(1); resolve(); }}, finish = job.finish;
    // A frame's timestamp can come from before the tween began; t starts at 0, so the finish's color never steps back.
    const tick = now => { const t = Math.min(1, Math.max(0, (now - start) / duration)); frame(t); if (t === 1 || reduced()) finish(); else id = requestAnimationFrame(tick); };
    animations.add(job); id = requestAnimationFrame(tick);
  });
}
async function refuse(r, c, to) {
  const tray = to > heights[r][c] && to <= puzzle.maxH && E.compare(puzzle, heights).tray === 0;
  refusal = {kind: tray ? 'tray' : 'column', r, c, shake: 0}; rings();
  announce(tray ? 'The tray is empty. Remove a cube first.' : to < 0 ? `Row ${r + 1}, column ${c + 1} has no cube to take off.` : `Row ${r + 1}, column ${c + 1} is full at ${puzzle.maxH} cubes.`);
  await tween(200, t => { if (refusal) { refusal.shake = Math.sin(t * Math.PI * 4) * (1 - t) * 5; rings(); } });
  // With reduced motion the heavier mark stays until the next action.
  if (!reduced()) { refusal = null; rings(); }
}
// A placed cube is set down: it starts a hair above its square and eases onto it, never falling.
async function settleCube(r, c, from) {
  settle = {r, c, offset: from}; updateScene();
  await tween(180, t => { if (settle) { settle.offset = from * (1 - t) ** 3; updateScene(); } });
  settle = null; updateScene();
}
async function perform(action) {
  const run = epoch;
  if (action.type === 'return') { await returnToTray(action.from, action.slot); return; }
  if (action.type === 'hint') {
    if (solvedNow()) return;
    if (hint) { const h = hint; hint = null; return perform({type: 'set', r: h.r, c: h.c, to: h.to}); }
    hint = R.hint(puzzle, heights); sync();
    if (hint) announce(`Hint: row ${hint.r + 1}, column ${hint.c + 1} should be ${hint.to ? `${hint.to} high` : 'empty'}. ${R.words(puzzle, hint)}${hint.reason ? ' ' : ''}Press Hint again to set it.`);
    return;
  }
  const {r, c} = action, validCell = (r, c) => Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 && r < puzzle.n && c < puzzle.n;
  if (!validCell(r, c)) return;
  let next, to;
  const before = E.compare(puzzle, heights).tray;
  if (action.type === 'move') {
    if (!validCell(action.r2, action.c2) || r === action.r2 && c === action.c2 || !heights[r][c]) return;
    const lifted = E.set(puzzle, heights, r, c, heights[r][c] - 1);
    to = heights[action.r2][action.c2] + 1;
    next = lifted && E.set(puzzle, lifted, action.r2, action.c2, to);
    if (!next) { await refuse(action.r2, action.c2, to); return; }
  } else {
    to = action.type === 'step' ? heights[r][c] + action.delta : action.to;
    if (!Number.isInteger(to)) return;
    next = E.set(puzzle, heights, r, c, to);
    if (!next) { if (to !== heights[r][c]) await refuse(r, c, to); return; }
    if (action.held && !reduced()) {
      // A hold's cue: the top cube lifts a touch before it flies back to the tray.
      settle = {r, c, offset: 0};
      await tween(90, t => { if (settle) { settle.offset = LIFT * 1.8 * Math.sin(t * Math.PI / 2); updateScene(); } });
      settle = null;
      if (run !== epoch) return;
    }
  }
  refusal = null; carry = null;
  const target = action.type === 'move' ? [action.r2, action.c2] : [r, c], grew = next[target[0]][target[1]] > heights[target[0]][target[1]];
  const returnFrom = action.returnPoint || toView(c + .5, heights[r][c] - .5 + (action.held ? LIFT * 1.8 : 0), r + .5);
  history.push({heights: copy(heights), hits}); heights = next; hits++; hint = null; hover = null; focus = target;
  const solved = solvedNow(); tint = 0;
  if (solved && !isFree()) { finished.add(puzzle.id); reached = Math.min(boards.length - 1, Math.max(reached, boards.indexOf(puzzle) + 1)); }
  if (solved) countPlus();
  sync(); save();
  if (E.compare(puzzle, heights).tray > before) await returnToTray(returnFrom, before);
  if (run !== epoch) return;
  if (solved) {
    // The next arrow is already showing and usable; the color carries the moment, and nothing else moves.
    const after = onward().label;
    announce(`Every shadow fills its outline. Board solved in ${nOf(hits, 'move')}. Par ${E.par(puzzle)}. ${theEnd() ? 'The end. New Game+ is open. Start it with the next arrow or from Settings.' : after === 'Next board' ? 'The next board is ready.' : `${after} is next. You haven’t solved it yet.`}`);
    const finish = tween(FINISH_MS, t => { tint = t * t * (3 - 2 * t); updateLight(); requestRender(); });
    if (grew) settleCube(...target, action.carried ? LIFT : .06);
    await finish;
    if (run !== epoch) return;
    tint = 1; sync();
  } else if (grew) {
    await settleCube(...target, action.carried ? LIFT : .06); if (run !== epoch) return;
  }
  if (!solved) {
    announce(`${action.type === 'move' ? `Cube moved from row ${r + 1}, column ${c + 1} to row ${focus[0] + 1}, column ${focus[1] + 1}.` : `Row ${r + 1}, column ${c + 1} is now ${to ? `${to} high` : 'empty'}.`} ${nOf(E.compare(puzzle, heights).tray, 'cube')} in the tray. ${nOf(hits, 'move')}.`);
  }
}
async function returnToTray(from, slot) {
  if (reduced() || document.hidden || !renderer) return;
  if (slot >= E.compare(puzzle, heights).tray) return;
  const t = layout.tray, end = t.slots[slot], start = frontPoint(from), stop = frontPoint(toView(end.x, end.y + t.size / 2, end.z));
  flight = {slot}; flightMesh.visible = true; updateScene();
  await tween(220, k => {
    const e = 1 - (1 - k) ** 3, s = 1 + (t.size - 1) * e;
    flightMesh.setMatrixAt(0, M.makeScale(s, s, s).setPosition(start.x + (stop.x - start.x) * e, start.y + (stop.y - start.y) * e, start.z + (stop.z - start.z) * e));
    flightMesh.instanceMatrix.needsUpdate = true; requestRender();
  });
  flight = null; flightMesh.visible = false; updateScene();
}
async function drain() {
  if (busy) return; busy = true; board.dataset.busy = 'true'; const run = epoch;
  while (queue.length) {
    const job = queue.shift(); await perform(job.action); job.resolve(); if (run !== epoch) return;
  }
  busy = false; board.dataset.busy = 'false';
}
function enqueue(action) { return new Promise(resolve => { queue.push({action, resolve}); drain(); }); }
function clearPending() {
  epoch++; queue.splice(0).forEach(job => job.resolve()); finishAnimations(); busy = false;
  settle = null; flight = null; refusal = null; if (flightMesh) flightMesh.visible = false;
  clearTimeout(wheel?.timer); wheel = null;
  const g = gesture; gesture = null; carry = null; clearTimeout(g?.hold); if (g) try { board.releasePointerCapture(g.id); } catch (_) {}
  if (g?.swing) goView(viewAt);
}
function undo() {
  clearPending(); const previous = history.pop();
  if (previous) { heights = copy(previous.heights); hits = previous.hits; announce(`Undone. ${nOf(hits, 'move')}. ${nOf(E.compare(puzzle, heights).tray, 'cube')} in the tray.`); }
  hint = null; hover = null; tint = solvedNow() ? 1 : 0; sync(); save();
}
function restart() { clearPending(); heights = E.start(puzzle); hits = 0; history = []; hint = null; hover = null; tint = 0; sync(); save(); announce('Board restarted.'); }
// Opens a board in hand: each opens on the front view, which is not saved.
function open(b, h, n, past) {
  clearPending(); puzzle = b; heights = h; hits = n; history = past; hint = null; hover = null; focus = [0, 0];
  tint = solvedNow() ? 1 : 0;
  viewAt = viewRest = FRONT; AX = axesAt(FRONT); U.uFront.value = 1; board.dataset.view = RESTS[FRONT].name;
  if (renderer) buildRoom();
  sync(); save();
}
function go(id) {
  const next = boards.find(b => b.id === id); if (!next || boards.indexOf(next) > reached) return false;
  // Leaving free play parks its board, so Settings can return to it.
  if (isFree()) { parked = {board: puzzle, heights, hits, history}; mode = 'campaign'; }
  open(next, E.start(next), 0, []); announce(`Board ${boards.indexOf(puzzle) + 1} of ${boards.length}.`);
  return true;
}
// Free play opens once all thirty boards are finished. `fresh` draws a new board; otherwise a parked free
// board that is not yet solved comes back as it was left.
function startFree(fresh) {
  if (!complete() || !Free) return false;
  const kept = isFree() ? null : parked, resume = !fresh && kept && !E.solved(kept.board, kept.heights);
  // A new board is not one of those played lately: a few come up often under the campaign's drawing rules.
  const drawn = resume ? null : Free.board(Math.floor(Math.random() * 0x80000000), new Set(recent.map(seed => Free.fromSeed(seed)).filter(Boolean).map(Free.key)));
  if (!resume && !drawn) return false;
  if (!isFree()) parked = {board: puzzle, heights, hits, history};
  mode = 'free';
  if (resume) open(kept.board, copy(kept.heights), kept.hits, kept.history);
  else { recent = [...recent, drawn.seed].slice(-RECENT); open(drawn, E.start(drawn), 0, []); }
  announce(`New Game+ board, ${nOf(puzzle.cubes, 'cube')}.`);
  return true;
}
const set = (r, c, to) => enqueue({type: 'set', r, c, to}), add = (r, c) => enqueue({type: 'step', r, c, delta: 1});
const move = (r, c, r2, c2) => enqueue({type: 'move', r, c, r2, c2}), remove = (r, c) => enqueue({type: 'step', r, c, delta: -1});

// ---------------------------------------------------------------------------------------------
// Picking: one ray from the pointer meets the room, and the first thing it touches decides the square: a
// stack (any face of it), the floor or, for a carried cube, the inside of a wall. The heights are the ones
// drawn, so while a cube is carried its source stands one shorter and a square behind it can be reached. A
// wall stands for the square at its foot, so a drop that overshoots a back square onto the wall still lands
// there. The floor reaches EDGE past its open front edges, over the slab's lip. The tray goes by its drawn row.
const EDGE = .22, GRAZE = .005;
function local(e) { return {x: e.clientX, y: e.clientY}; }
function rayAt(p) { ndc.set(p.x / view.w * 2 - 1, 1 - p.y / view.h * 2); raycaster.setFromCamera(ndc, camera); return raycaster.ray; }
function pickAt(p, {h = heights, walls = false} = {}) {
  const ray = rayAt(p), o = ray.origin, d = ray.direction, n = puzzle.n, H = wallHeight(), clamp = v => Math.max(0, Math.min(n - 1, Math.floor(v)));
  let best = null, nearest = Infinity;
  const take = (t, cell, kind) => { if (t >= 0 && t < nearest) { nearest = t; best = {cell, kind}; } };
  // Stacks are picked a hair inside their sides (their bevel rounds them anyway): the camera lines a square's
  // middle up exactly with the side edges of the stacks in front of it, and such a grazing ray goes past.
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (h[r][c]) {
    box3.min.set(c + GRAZE, 0, r + GRAZE); box3.max.set(c + 1 - GRAZE, h[r][c], r + 1 - GRAZE);
    if (ray.intersectBox(box3, hitPoint)) take(hitPoint.distanceTo(o), [r, c], 'column');
  }
  if (Math.abs(d.y) > 1e-9) {
    const t = -o.y / d.y, x = o.x + t * d.x, z = o.z + t * d.z;
    if (x >= 0 && z >= 0 && x < n + EDGE && z < n + EDGE) take(t, [clamp(z), clamp(x)], 'floor');
  }
  if (walls) {
    // The left wall's inside face is x = 0 and stands for column 0; the right wall's is z = 0, for row 0.
    if (Math.abs(d.x) > 1e-9) { const t = -o.x / d.x, y = o.y + t * d.y, z = o.z + t * d.z; if (y >= 0 && y <= H && z >= 0 && z < n) take(t, [clamp(z), 0], 'wall'); }
    if (Math.abs(d.z) > 1e-9) { const t = -o.z / d.z, y = o.y + t * d.y, x = o.x + t * d.x; if (y >= 0 && y <= H && x >= 0 && x < n) take(t, [0, clamp(x)], 'wall'); }
  }
  return best;
}
function columnAt(p, h = heights) { const hit = pickAt(p, {h}); return hit?.kind === 'column' ? hit.cell : null; }
// Picking up is forgiving: a press that misses every stack takes the stack whose outline passes within
// `reach` pixels, nearest first; on an open floor square, which a tap would fill, the reach is halved.
function sourceAt(p, reach) {
  const direct = columnAt(p); if (direct) return direct;
  const under = pickAt(p), open = under?.kind === 'floor' && !heights[under.cell[0]][under.cell[1]], far = open ? reach / 2 : reach;
  for (const k of [far / 3, far * 2 / 3, far]) for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, hit = columnAt({x: p.x + k * Math.cos(a), y: p.y + k * Math.sin(a)});
    if (hit) return hit;
  }
  return null;
}
function overTray(p) { return !!trayView && p.y > trayView.top - 10 && p.y < trayView.bottom + 12 && p.x > trayView.left - 16 && p.x < trayView.right + 16; }
function trayHit(p) {
  if (!overTray(p)) return null;
  const remaining = E.compare(puzzle, heights).tray; let best = null, distance = Infinity;
  for (let i = 0; i < remaining; i++) { const d = Math.abs(p.x - trayView.slots[i].x); if (d < distance) { distance = d; best = i; } }
  return best !== null && distance <= Math.max(trayView.step / 2, 16) ? best : null;
}
// The square under the pointer: for a carried cube, against the stacks as drawn and with the walls.
function landing(p, carrying = false) {
  if (overTray(p)) return null;
  return (carrying ? pickAt(p, {h: carriedBase(), walls: true}) : pickAt(p))?.cell || null;
}

// ---------------------------------------------------------------------------------------------
// Pointer, wheel and keyboard input, matching the minimal Cast.
function cancelCarry() {
  const g = gesture; gesture = null; carry = null; clearTimeout(g?.hold);
  if (g) try { board.releasePointerCapture(g.id); } catch (_) {}
  if (g?.swing) goView(viewAt);
  sync();
}
// The swing: a drag that starts on empty floor or the ground and goes mostly sideways carries the view
// with the pointer, a rest every REST_PX. Let go and it settles on the nearest rest; a short flick (18px
// or more) goes one on. Drags from the tray or a stack still carry cubes, and a still press still taps or holds.
function swingTo(g, e) { setView(Math.max(0, Math.min(RESTS.length - 1, g.swing.from - (e.clientX - g.startX) / REST_PX))); }
function endSwing(g, e) {
  const dx = e.clientX - g.startX, steps = Math.abs(dx) < 18 ? 0 : Math.round(-dx / REST_PX) || -Math.sign(dx);
  goView(Math.round(g.swing.from) + steps);
}
// A carried stack cube stays over its own stack, so a drop cancels, until the pointer has gone a third of a
// cube from where it was pressed; past that the square under the pointer takes it, seen past the lifted cube.
function carryTarget(g, p) {
  if (g.source && Math.hypot(p.x - g.startX, p.y - g.startY) < view.scale / 3) return g.source.slice();
  return landing(p, true);
}
function moveGesture(e) {
  if (gesture?.id !== e.pointerId) return;
  const g = gesture, p = local(e); g.last = {clientX: e.clientX, clientY: e.clientY};
  if (g.held) return;
  if (!g.drag && Math.hypot(g.startX - e.clientX, g.startY - e.clientY) > 10) {
    g.drag = true; clearTimeout(g.hold);
    if (g.slot === null && !g.source && Math.abs(e.clientX - g.startX) > Math.abs(e.clientY - g.startY)) { holdView(); g.swing = {from: viewAt}; hover = null; }
    else if (!queue.length && (g.slot !== null || g.source)) {
      finishAnimations();
      carry = {source: g.source, slot: g.slot, target: null, pointer: p}; carry.target = carryTarget(g, p); hint = null; sync();
    }
  }
  if (g.swing) { swingTo(g, e); return; }
  if (carry) {
    const before = carry.target, floating = !landingNext();
    carry.pointer = p; carry.target = carryTarget(g, p);
    const changed = String(before) !== String(carry.target);
    if (changed || floating || !landingNext()) updateScene();
    if (changed) rings();
  }
}
function release(e) {
  if (gesture?.id !== e.pointerId) return;
  if (e.type !== 'lostpointercapture') moveGesture(e);
  const g = gesture, held = carry; gesture = null; carry = null; clearTimeout(g.hold);
  try { board.releasePointerCapture(g.id); } catch (_) {}
  if (g.swing) { endSwing(g, g.last); return; }
  const from = held && !held.target ? held.pointer : null;
  sync();
  if (held) {
    const target = held.target;
    if (target) {
      focus = target;
      if (held.source) enqueue({type: 'move', r: held.source[0], c: held.source[1], r2: target[0], c2: target[1], carried: true});
      else enqueue({type: 'step', r: target[0], c: target[1], delta: 1, carried: true});
    } else if (held.source) enqueue({type: 'step', r: held.source[0], c: held.source[1], delta: -1, returnPoint: from});
    else enqueue({type: 'return', from, slot: held.slot});
  } else if (!g.drag && !g.held && !g.idle && g.cell) { focus = g.cell; add(...g.cell); }
}
// A still press that outlasts HOLD_MS on a stack sends its top cube back to the tray; on an empty
// square it does nothing, and the release adds nothing either.
function holdFire(id) {
  const g = gesture;
  if (!g || g.id !== id || g.drag || g.held || g.slot !== null) return;
  const cell = g.direct || (g.cell && heights[g.cell[0]][g.cell[1]] ? g.cell : null);
  // A hold on an empty square or the ground does nothing, and its release adds nothing; it may still swing.
  if (!cell) { g.idle = true; return; }
  g.held = true;
  focus = cell.slice();
  try { navigator.vibrate?.(12); } catch (_) {}
  enqueue({type: 'step', r: cell[0], c: cell[1], delta: -1, held: true});
}
// Right-click on a stack or its square returns the top cube to the tray.
function removeAt(p) {
  const cell = landing(p);
  if (!cell || !heights[cell[0]][cell[1]]) return;
  focus = cell.slice(); keyboard = false; hover = null;
  enqueue({type: 'step', r: cell[0], c: cell[1], delta: -1});
}
board.addEventListener('pointerdown', e => {
  if (!ready || !e.isPrimary || e.button !== 0 || e.ctrlKey || gesture || carry || $('dialog[open]')) return;
  // A press on the ground, clear of the room and the tray, can only swing the view.
  const p = local(e), slot = trayHit(p), cell = slot === null ? landing(p) : null;
  e.preventDefault(); keyboard = false; hover = null;
  gesture = {id: e.pointerId, cell, slot, source: slot === null ? sourceAt(p, e.pointerType === 'mouse' ? 8 : 16) : null, direct: slot === null ? columnAt(p) : null, startX: e.clientX, startY: e.clientY, last: {clientX: e.clientX, clientY: e.clientY}, drag: false, held: false};
  if (slot === null) gesture.hold = setTimeout(() => holdFire(e.pointerId), HOLD_MS);
  board.focus({preventScroll: true}); board.setPointerCapture(e.pointerId); rings();
});
window.addEventListener('pointermove', e => {
  if (gesture?.id === e.pointerId) { moveGesture(e); if (e.buttons === 0 && e.pointerType !== 'touch') release(e); }
  else if (ready && e.pointerType === 'mouse' && e.target.closest?.('#board')) { const next = landing(local(e)); if (String(next) !== String(hover)) { hover = next; rings(); } }
});
window.addEventListener('pointerup', release);
board.addEventListener('lostpointercapture', e => { if (gesture?.id === e.pointerId) { if (!e.buttons) release(e); else cancelCarry(); } });
window.addEventListener('pointercancel', e => { if (gesture?.id === e.pointerId) cancelCarry(); });
board.addEventListener('pointerleave', () => { if (hover) { hover = null; rings(); } });
board.addEventListener('focus', () => { if (!gesture) { keyboard = true; rings(); } });
board.addEventListener('blur', () => { keyboard = false; if (carry && !gesture) cancelCarry(); else rings(); });
board.addEventListener('wheel', e => {
  if (!ready || $('dialog[open]') || carry || !landing(local(e))) return; e.preventDefault();
  if (!wheel) wheel = {cell: landing(local(e)), sum: 0, stepped: false, timer: null};
  clearTimeout(wheel.timer); wheel.sum += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? board.clientHeight : 1);
  if (!wheel.stepped && Math.abs(wheel.sum) >= 40) { wheel.stepped = true; enqueue({type: 'step', r: wheel.cell[0], c: wheel.cell[1], delta: wheel.sum < 0 ? 1 : -1}); }
  wheel.timer = setTimeout(() => { wheel = null; }, 180);
}, {passive: false});
document.addEventListener('keydown', e => {
  if (!ready || e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]') || e.target.matches('select,input,textarea')) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (['z', 'u', 'Backspace'].includes(key)) { e.preventDefault(); undo(); return; }
  if (key === 'Escape' && carry) { e.preventDefault(); cancelCarry(); announce('Cube put back where it was.'); return; }
  if (key === 'h' && !carry) { e.preventDefault(); enqueue({type: 'hint'}); return; }
  if ((key === '[' || key === ']') && !gesture) { e.preventDefault(); goView(viewRest + (key === ']' ? 1 : -1), true); return; }
  const delta = {ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0]}[key];
  if (delta) {
    e.preventDefault(); focus = focus.map((v, i) => Math.max(0, Math.min(puzzle.n - 1, v + delta[i]))); keyboard = true; hover = null; board.focus({preventScroll: true});
    if (carry) { carry.target = focus.slice(); updateScene(); }
    rings(); announce(`${carry ? 'Carrying a cube. ' : ''}Row ${focus[0] + 1}, column ${focus[1] + 1}, height ${heights[focus[0]][focus[1]]}.`);
  }
  if (key === 'Enter' && e.target === board && !carry) { e.preventDefault(); enqueue({type: 'step', r: focus[0], c: focus[1], delta: e.shiftKey ? -1 : 1}); }
  if (key === 'Delete' && !carry) { e.preventDefault(); if (heights[focus[0]][focus[1]]) enqueue({type: 'step', r: focus[0], c: focus[1], delta: -1}); }
  if (key === ' ' && e.target === board) {
    e.preventDefault(); if (e.repeat || gesture || queue.length) return;
    finishAnimations();
    if (carry) { const source = carry.source, target = focus.slice(); carry = null; sync(); enqueue({type: 'move', r: source[0], c: source[1], r2: target[0], c2: target[1], carried: true}); }
    else if (heights[focus[0]][focus[1]]) { carry = {source: focus.slice(), target: focus.slice(), pointer: null}; hint = null; sync(); announce(`Picked up the top cube from row ${focus[0] + 1}, column ${focus[1] + 1}. Use the arrows to move it, Space to drop it and Escape to put it back.`); }
  }
});
for (const name of ['selectstart', 'dragstart', 'contextmenu']) board.addEventListener(name, e => e.preventDefault());
board.addEventListener('contextmenu', e => {
  // A touch long-press is handled by the hold, so only a mouse right-click (or Control-click) removes here.
  if (!ready || (e.pointerType && e.pointerType !== 'mouse') || gesture || carry || $('dialog[open]')) return;
  removeAt(local(e));
});

// ---------------------------------------------------------------------------------------------
// Chrome, settings and hooks.
const icons = {restart: 'M5 7a8 8 0 1 1-1 9M5 3v5h5', undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12', hint: 'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0l-1 4H9Z', next: 'M5 12h14M13 6l6 6-6 6', view: 'M12 13.5 19 17l-7 3.5L5 17zM4.5 11.5C6 7.5 8.8 5.5 12 5.5s6 2 7.5 6M19.5 11.5l.5-3.4M19.5 11.5l-3.2-1.1M4.5 11.5 4 8.1M4.5 11.5l3.2-1.1', settings: 'M4 7h16M4 17h16M8 4v6M16 14v6', help: 'M9 8a3 3 0 1 1 4 3l-1 2M12 17v.2'};
for (const [id, d] of Object.entries(icons)) $('#' + id + '-btn').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
// The view button steps front, right, left and round to front again.
$('#view-btn').onclick = () => { if (gesture) return; goView((viewRest + 1) % RESTS.length, true); };
$('#undo-btn').onclick = undo; $('#restart-btn').onclick = restart; $('#hint-btn').onclick = () => enqueue({type: 'hint'});
$('#next-btn').onclick = () => { if (solvedNow()) onward().go(); };
for (const id of ['settings', 'help']) {
  $('#' + id + '-btn').onclick = () => { if (carry || gesture) cancelCarry(); hover = null; rings(); $('#' + id).showModal(); };
  $('#' + id).addEventListener('close', () => $('#' + id + '-btn').focus({preventScroll: true}));
}
// Settings lists every board as current, completed, available or locked.
function updateCatalog() {
  const list = $('#board-catalog');
  if (!list.children.length) boards.forEach((b, i) => {
    const item = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.dataset.board = b.id;
    button.innerHTML = `<span>Board ${i + 1}</span><span class="catalog-state"></span>`;
    // A board other than the one in hand opens with a fresh start, as does a solved board picked again.
    button.addEventListener('click', () => { if (i > reached) return; if (b !== puzzle || solvedNow()) go(b.id); $('#settings').close(); });
    item.append(button); list.append(item);
  });
  const all = complete();
  boards.forEach((b, i) => {
    const button = list.children[i].firstChild, here = b === puzzle, done = finished.has(b.id), open = i <= reached;
    button.dataset.state = here ? 'current' : done ? 'completed' : open ? 'available' : 'locked';
    button.disabled = !open;
    // With all thirty finished, the last board is marked as the end.
    button.querySelector('.catalog-state').textContent = [here ? 'Current' : null, done ? 'Completed' : null, !here && !done ? (open ? 'Available' : 'Locked') : null, all && i === boards.length - 1 ? 'The end' : null].filter(Boolean).join(' · ');
    if (here) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
  });
  // Free play: New board draws one; Continue returns to a free board left unsolved for the campaign.
  $('#free-play').hidden = !all || !Free;
  $('#free-continue').hidden = isFree() || !parked || E.solved(parked.board, parked.heights);
}
$('#free-new').onclick = () => { $('#settings').close(); startFree(true); };
$('#free-continue').onclick = () => { $('#settings').close(); startFree(false); };
function applyPrefs() {
  document.documentElement.dataset.motion = prefs.motion; $('#motion').value = prefs.motion;
  if (reduced()) finishAnimations();
}
$('#motion').onchange = e => { prefs.motion = e.target.value; applyPrefs(); save(); };
reducedQuery.addEventListener('change', applyPrefs);
forcedColors.addEventListener('change', () => { if (renderer) { updateLight(); requestRender(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) finishAnimations(); else requestRender(); });
function client(p) { return {x: p.x, y: p.y}; }
// Shadow masks of what is drawn: rays from each surface cell toward its lamp, against the cube meshes.
function lightMasks() {
  const n = puzzle.n, H = puzzle.maxH, rc = new THREE.Raycaster(), dir = l => l.position.clone().sub(l.target.position).normalize();
  const hits = (origin, l, meshes) => { rc.set(origin, dir(l)); rc.near = 0; rc.far = 60; return meshes.length && rc.intersectObjects(meshes, false).length > 0 ? 1 : 0; };
  const masks = meshes => ({
    left: Array.from({length: n}, (_, i) => Array.from({length: H}, (_, z) => hits(new THREE.Vector3(-.05, z + .5, i + .5), lamps.settled.left, meshes))),
    right: Array.from({length: n}, (_, i) => Array.from({length: H}, (_, z) => hits(new THREE.Vector3(i + .5, z + .5, -.05), lamps.settled.right, meshes))),
    floor: Array.from({length: n}, (_, r) => Array.from({length: n}, (_, c) => hits(new THREE.Vector3(c + .5, -.05, r + .5), lamps.settled.floor, meshes))),
  });
  const settledMask = masks([casters]);
  if (!carryCasts) return {...settledMask, preview: null};
  const all = masks([casters, carriedCaster]), only = key => all[key].map((row, i) => row.map((v, j) => v && !settledMask[key][i][j] ? 1 : 0));
  return {...settledMask, preview: {left: only('left'), right: only('right'), floor: only('floor')}};
}
// A surface cell's centre on screen, and whether the camera sees the whole middle of the cell. 'top' is
// the top of the stack on floor square (i, j), or the square itself when it is empty.
function cellPoint(surface, i, j) {
  const display = carriedBase(), blockers = [];
  const at = (a, b) => surface === 'left' ? [0, b, a] : surface === 'right' ? [a, b, 0] : [b, surface === 'top' ? display[i][j] : 0, a];
  for (let r = 0; r < puzzle.n; r++) for (let c = 0; c < puzzle.n; c++) if (display[r][c]) blockers.push([c, 0, r, c + 1, display[r][c], r + 1]);
  if (carryCasts) { const [r, c] = carry.target; blockers.push([c, display[r][c] + LIFT, r, c + 1, display[r][c] + 1 + LIFT, r + 1]); }
  const seen = (a, b) => {
    const p = at(a, b), ray = rayAt(toView(...p)), far = new THREE.Vector3(...p).distanceTo(ray.origin) - .02;
    return !blockers.some(k => { box3.min.set(k[0], k[1], k[2]); box3.max.set(k[3], k[4], k[5]); return ray.intersectBox(box3, hitPoint) && hitPoint.distanceTo(ray.origin) < far; });
  };
  const visible = [[0, 0], [-.25, 0], [.25, 0], [0, -.25], [0, .25]].every(([da, db]) => seen(i + .5 + da, j + .5 + db));
  return {...client(toView(...at(i + .5, j + .5))), visible};
}
// Probe points for the pools of shade (paper) or light (dark): the ground behind each wall's front end (mirror images), beside tray
// cube 0 and well clear of it, and bare paper below the tray.
function poolPoints() {
  const n = puzzle.n, t = layout.tray, slot = t.slots[0], middle = t.slots[t.slots.length >> 1], v = g => client(toView(g.x, GROUND_Y, g.z));
  return {
    left: v(new THREE.Vector3(-WALL - .22, GROUND_Y, n - .12)), right: v(new THREE.Vector3(n - .12, GROUND_Y, -WALL - .22)),
    tray: E.compare(puzzle, heights).tray ? v(slot.clone().addScaledVector(AX.H, t.half * Math.SQRT2 + .03)) : null,
    trayBare: v(slot.clone().addScaledVector(AX.H, t.half * Math.SQRT2 + .7)), bare: v(middle.clone().addScaledVector(AX.H, .5 + t.size * 2)),
  };
}
function hookup() {
  window.__cast3d = {
    boards, get board() { return puzzle.id; }, get state() { return snapshot(); }, set, add, undo, restart, go, move, remove, free: startFree,
    get mode() { return mode; }, get puzzle() { return {...puzzle}; }, get complete() { return complete(); }, get finished() { return [...finished]; }, get plus() { return {...plus}; },
    trayPoint() { const s = trayView.slots[0]; return client(s); },
    squarePoint(r, c) { return client(toView(c + .5, 0, r + .5)); },
    columnTop(r, c) { return client(toView(c + .5, heights[r][c], r + .5)); },
    light: lightMasks, cellPoint, poolPoints, project(x, y, z) { return client(toView(x, y, z)); },
    get carry() { return carry ? {source: carry.source ? carry.source.slice() : null, slot: carry.slot ?? null, target: carry.target ? carry.target.slice() : null, preview: carryCasts} : null; },
    get view() { return {rest: RESTS[viewRest].name, at: viewAt, rests: RESTS.map(r => r.name), moving: !!viewJob}; }, setView(name) { const i = RESTS.findIndex(r => r.name === name); if (i >= 0) goView(i, true); return i >= 0; },
    get hint() { return hint ? {r: hint.r, c: hint.c, to: hint.to, reason: hint.reason} : null; }, get announcement() { return $('#announcement').textContent; }, get frames() { return frames; }, get settle() { return settle ? settle.offset : 0; }, get timing() { return {...timing}; }, get reached() { return reached; }, get tint() { return tint; },
  };
  // The painted bounds are the frame every view fits in, centered as each view is, so they hold still as the view swings.
  // An empty tray draws nothing, so with no cube in it (a solved board) the bounds end at the room's lowest point.
  window.__minimalize = {bounds() {
    const fw = frameSize.w / 2, fh = frameSize.h / 2, empty = !carry && E.compare(puzzle, heights).tray === 0;
    const low = empty ? Math.max(layout.cy - fh, layout.room.minY) : layout.cy - fh;
    const a = client({x: (layout.cx - fw - camera.left) * view.scale, y: (camera.top - layout.cy - fh) * view.scale}), z = client({x: (layout.cx + fw - camera.left) * view.scale, y: (camera.top - low) * view.scale});
    return {x: a.x, y: a.y, width: z.x - a.x, height: z.y - a.y};
  }};
}

async function boot() {
  applyPrefs();
  document.documentElement.dataset.ground = PAPER ? 'paper' : 'dark';
  if (PAPER) { $('meta[name="theme-color"]').content = '#e9e7e2'; $('meta[name="color-scheme"]').content = 'light'; }
  if (!setupGL()) {
    document.body.dataset.gl = 'none'; $('#fallback').hidden = false; save();
    if (preserveSave) announce('Saved board could not be read. Starting fresh.');
    return;
  }
  document.body.dataset.gl = 'webgl'; board.dataset.view = RESTS[viewRest].name;
  buildRoom(); sync();
  new ResizeObserver(() => fit()).observe(board); addEventListener('resize', fit);
  hookup();
  // Compile every program before the first frame is shown, off the play path.
  const t0 = performance.now();
  await renderer.compileAsync(scene, camera);
  if (document.hidden) await new Promise(resolve => { const shown = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', shown); resolve(); } }; document.addEventListener('visibilitychange', shown); });
  const t1 = performance.now();
  renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); frames++; shadowsDirty = false;
  timing.compile = Math.round(t1 - t0); timing.firstFrame = Math.round(performance.now() - t1);
  canvas.classList.add('ready'); ready = true; board.dataset.ready = 'true';
  save(); if (preserveSave) announce('Saved board could not be read. Starting fresh.');
}
boot();
