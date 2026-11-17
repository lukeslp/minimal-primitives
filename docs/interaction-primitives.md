# Interaction primitives

My informal theory behind the collection's name, written down on
2026-11-13 so new games, store copy and the assessment apps can share it.
`primitives.json` holds the same vocabulary as data, one entry per game, and
`tests/test_build.py` keeps it in step with `sources.json`.

## The idea

Interaction primitives are to doing what
[simple machines](https://en.wikipedia.org/wiki/Simple_machine) are to building:
the few basic ways a person acts on the world around them. Get, put, push,
turn, join, split, bend, switch. A lever or a wheel is not a machine on its
own, but nearly every machine is made of them; a push or a turn is not a task
on its own, but nearly every task is made of them.

Each game in the collection is built on one or two primitives. The surface is
simple and iconic, the action has one physical consequence, and the game
teaches itself through that action with almost no text.

## Where it came from

The collection began as an engaging way to run motor assessment: eye gaze,
head pointing, and single- and multi-switch use. A clinician needs to see how
someone selects, holds, times, scans and follows; a game asks for exactly that,
repeatedly, without feeling like a test. That aim carries forward into the
dedicated assessment app or apps, including Tobii eye tracker input (the gaze
bridge, `access.js` and `bridge-client.js` in every game; the tracker work is
under way). The games in this package are the play side of the same idea.

## The vocabulary

There are eight words, and every public surface uses these eight and no
others: the index's opening and its About text, the store and itch
descriptions, the download page and this document.

| Word | What it covers | Games |
| --- | --- | --- |
| get | take, lift, uncover, pick out, follow | Hexsweeper, Pursuit, Sweep |
| put | place, drop, stack, mark | Hexsweeper, Akari, Bending, Horologist, Towers, Tents, Cast |
| push | push, repel, strike, step | Shoo · Minimal, Shoo, Delve |
| turn | turn, spin, tilt, flip | Slant, Tilt, Tilt · 3D, Cube Maze, Horologist, Tangles, Glance, Nod |
| join | connect, trace from point to point | Bridges, Constellations, Tangles, Glyph |
| split | divide, separate | Spiral Galaxies |
| bend | fold, bend, squeeze | Fold, Bending |
| switch | change between two states, press on time, wait | Notan, Akari, Balance, Weaves, Noon, Ticker |

Get and put are a pair, and so are join and split. The eight were settled on
2026-11-15, after the longer lists below proved too many to say. `switch`
won over `toggle` as the plainer word, even though it also names the
assistive device.

`primitives.json` gives each game its words from the eight (`words`) and,
under them, the finer verbs below (`primitives`), which are still useful for
describing a game and for assessment.

### The finer verbs

My first set was push, pull, tilt, spin, lift, drop, on, off. A round of
review on 2026-11-13 (one outside model and this repository's own read)
sharpened it:

- On and off are outcomes. The action that produces them is **toggle**: a
  physical two-position control. (Among these finer verbs toggle is the
  precise one; the public word for it is `switch`, as above.)
- **Release** is the root action; drop is release under gravity, kept as an
  everyday variant.
- Missing actions that both reviewers named: **point** (aim), **turn**
  (partial, controlled rotation, unlike continuous spin), **separate** (the
  inverse of connect), **slide**, and **grasp**.

The finer list is organized by what the action changes. Directions live inside each
family, not as axes of their own.

| What changes | Primitives |
| --- | --- |
| Position | push, pull, slide, lift, lower, drop, stack, step, repel |
| Orientation | tilt, turn, spin, flip |
| Shape | fold, squeeze |
| Relation | connect, separate, divide, place |
| Contact | grasp, release, press, strike |
| Configuration | toggle, uncover, mark |
| Targeting | point, follow, trace, scan, select |
| Timing | wait, press on time |

An earlier public line named ten of these (push, pull, lift, release, tilt,
turn, fold, connect, toggle, point). The eight words above replaced it.

Adjacent, not yet used: twist (the screw's echo), pour (a compound of tilt and
hold), swing, roll, pinch, stretch, latch, snap, throw, catch, open, close,
wind.

A primitive is physical and everyday: something a hand, head or eye does to a
thing. It is not a software operation ("drag", "scroll", "type") and not a goal
("solve", "win").

## Simple-machine echoes

| Simple machine | Primitive | Games |
| --- | --- | --- |
| Inclined plane | tilt | Tilt, Tilt · 3D, Cube Maze, Nod |
| Wheel and axle | spin | Horologist |
| Lever, pulley | lift | Towers, Cast |
| Wedge | divide | Spiral Galaxies |
| Screw | twist, turn | none yet for twist |

For about half the collection the comparison is literal as well as
metaphorical.

## Rules drawn from the games

1. One or two of the eight words per game. A third usually means two games.
2. One input, one visible physical consequence: the marble rolls, the gear
   turns, the bees flee.
3. Teach through the action. If the first board needs a sentence, the
   primitive is not reading.
4. Every primitive has a switch, look and tap form. One switch steps a
   highlight through the game's keys; Look and hold selects by resting a
   finger, pointer, head or gaze; touch and keys always work. A primitive
   that only works as a precise gesture fails the collection's purpose.
5. Timing is a primitive only where it is the point (Noon, Ticker); nowhere
   else does a game depend on speed.

## Two things to assess: triggering and understanding

The people an adapted assessment app is for may not be able to fold, push or
lift anything at all. For them every primitive is depicted on screen and
triggered by eye gaze or a single switch. The game shows a fold; the person
looks, or presses once. That is the point: it lets someone act on a world they
cannot physically act on, and it lets a clinician see how well they do.

So the assessment never measures the physical action. It records two things
separately, and neither alone establishes the other or makes the games a
validated motor assessment.

- **Can the person trigger the action?** Access by eye gaze or one switch:
  fixate and dwell on a target, hold, release, wait through a scan, time a
  press. This is what switch and eye-gaze assessment measures.
- **Do they understand what the action does?** Cause and effect, then
  prediction: tilting rolls the marble that way, a tap scares the bees away
  from it, a lamp lights its row. A player who understands stops exploring
  and starts aiming; repeated play shows the shift from trying to choosing.

Because each game has one or two primitives with one visible consequence, the
two layers can be told apart: a missed board is either a trigger that did not
happen or a consequence that was not expected, and the game's own record
(moves, hints, Undo, time) says which.

## What each primitive can show in assessment

| Primitive | What it exercises |
| --- | --- |
| select, toggle, place, point | target acquisition and activation by tap, switch or dwell |
| press on time | switch timing and anticipation |
| scan | row and column scanning with one or two switches |
| follow, trace | smooth pursuit and path control by eye, head or pointer |
| tilt, push, repel | directional control (four or six directions) |
| wait, step | inhibition and pacing |

## Nearest prior work

Foley, Wallace and Chan's six interaction tasks (select, position, orient,
path, quantify, text; "The Human Factors of Computer Graphics Interaction
Techniques", IEEE CG&A, 1984) describe input to computers. Card, Mackinlay and
Robertson's design space of input devices (ACM TOIS, 1991) describes the
devices themselves. Norman's affordances (The Design of Everyday Things) are
about what an object invites. This vocabulary is plainer and physical: the
everyday verbs of acting on things, chosen so each one also maps to a switch,
a look and a tap.
