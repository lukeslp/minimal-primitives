# Minimal Primitives score service

Luke Steuber. Python standard library and Node; no packages to install. The
service serves API responses only. It never serves files or changes the original
games' score services.

```sh
python3 -m server --port 5059 --db /tmp/minimal-private/scores.sqlite3 \
  --origins https://html-classic.itch.zone,http://127.0.0.1:4173
python3 -m unittest discover -s tests -p 'test_server.py' -v
```

Use a persistent private directory outside the source and all deployed static
web roots for a real database. Paths inside this checkout are rejected. The
SQLite file is mode 0600. The default allowlist contains only
`https://html-classic.itch.zone`; `--origins` replaces it with comma-separated,
exact HTTP(S) origins. Wildcards, `null`, paths and arbitrary origins are rejected.
Requests without Origin are supported for non-browser clients. The listener
accepts only loopback addresses, even with `--bind`. Configure any reverse proxy
separately; forwarded client-address headers are deliberately ignored.

All endpoints are under `/api/v1/`. Health and board reads are public. Start,
finish and delete require `Authorization: Bearer <64 lowercase hex characters>`.
Clients should generate this secret with 32 random bytes and retain it locally;
the service stores only its SHA-256 hash. Neither bearer secrets nor raw proofs
are stored or logged. Public board entries contain only
`{id,rank,nickname,value,elapsedMs}`; they never contain run IDs or owner hashes.

## API details

- `GET health` returns `{ok:true}`.
- `POST runs` takes `{submission,identity,repeat:false}` and returns
  `{run,startedAt}` (Unix milliseconds). First response is 201, retry is 200.
  The six identity strings are `game,mode,puzzleId,layoutHash,rulesVersion,scoringPolicy`;
  the layout hash is 64 lowercase hex characters. All six fields partition a board.
- `POST runs/:run/finish` takes `{submission,proof,assisted,repeat,practice}` and
  optionally `{publish:true,nickname}`. It returns 200 with
  `{score:{id,run,identity,category,value,elapsedMs},ranked:boolean}`. `id` is
  allocated even for a private finish. Only explicit `publish:true` plus a valid
  nickname can create a public score. A nickname is 1-20 normalized letters,
  numbers, underscores, spaces, dots or dashes. Practice never creates a score.
- `GET boards?game=...&mode=...&puzzleId=...&layoutHash=...&rulesVersion=...&scoringPolicy=...&category=...`
  returns `{entries:[...],category}`. Categories are `unassisted`, `assisted`,
  `repeat`, `repeat-assisted`, `practice`; the practice board is always empty.
  Up to 50 participants appear, with one best score per owner and competition
  ranks (1,1,3 for an exact tie on both value and elapsed milliseconds).
- `DELETE scores/:id` returns `{removed:true}`. No body or an empty JSON object
  is accepted. Another owner's ID and an unknown ID both return 404.
- `OPTIONS` validates the exact origin, endpoint method and requested headers;
  allowed headers are Authorization and Content-Type.

Submissions are opaque 1-128-character ASCII IDs (letters, digits, `_.:-`).
Reuse a start submission only for the same identity. Retry a finish with the
same submission and JSON data; any change after acceptance returns 409. Object
key order does not matter. A finish submission cannot be used on a second run.
Failed validation does not consume the submission. Deleting a score preserves
the completed run's receipt: retrying it returns `ranked:false`, and cannot
resurrect publication. A private finish cannot later be promoted by replaying it.

Server timing starts at run creation and stops when a finish request is received;
validation latency is excluded. Client elapsed fields are rejected. A repeated
start ID does not reset the clock. A new attempt on a previously started exact
identity becomes a repeat; explicit repeat/assisted/practice disclosures are
sticky, including across rejected proofs and transient validator failures. The
adapter may upgrade those flags and cannot downgrade them. The frontend must
mark interruptions, resumed/mid-attempt and historical play as practice and
start online runs only at a fresh attempt. The server provides no import or
retroactive publication endpoint. Attempts over 24 hours old, or affected by a
backward wall-clock adjustment, also become practice. This is casual validation;
the service cannot establish that a dishonest client disclosed every hint.

Horologist uses hits, Tilt moves and Fold folds, ascending then elapsed. Infinite
Hexsweeper uses cleared descending, then elapsed ascending (modes `infinite`,
`infinite-v1`, `hexsweeper-infinite`, `hexsweeper-infinite-v1`, case insensitive).
Other finite games use server elapsed milliseconds as both value and elapsed.
Game IDs are `hexsweeper`, `notan`, `akari`, `spiral-galaxies` (or `galaxies`),
`bridges`, `slant`, `fold`, `bending`, `tilt`, `horologist`. Aliases do not merge
identities. Real validators must reject unsupported identities and policies.

## Main-owned validator boundary

`server/validate.mjs` imports **`adapters/validators.mjs`**, which main implements.
The required named export is:

```js
export async function validateProof({ identity, proof, startedAt, elapsedMs,
                                      assisted, repeat, practice }) {
  // Select the pinned engine by identity; verify exact layout/rules/policy,
  // replay/final state and native measure. Unknown identity: { valid: false }.
  return { valid: true, value: 12, assisted: false, repeat: false, practice: false };
}
```

`value` must be an integer from 0 through Number.MAX_SAFE_INTEGER. For timed
games it is checked but replaced by server elapsed time. Optional flags must be
booleans. Unknown games, proofs or validators must return `{valid:false}`.
Missing modules/exports return 503; invalid proofs, thrown validators and invalid
results return 400. Adapter exceptions and extra result properties never reach
the client. Adapter code must not write to stdout: it is the protocol channel.
The subprocess is trusted rule code, not a security sandbox for untrusted modules.

Python uses one persistent serialized Node child, 64 MiB V8 heap, a 64 KiB
input-line limit, a 4 KiB response limit, and a 3-second wall deadline that
includes waiting for the validator lock. Timeout/crash/protocol errors kill
the process group; the next request starts a fresh child. Writes as well as
reads have the deadline. The child inherits only PATH, SYSTEMROOT and TMPDIR.
No worker requests a model, external service or network resource.

Programmatic tests can call
`create_server('127.0.0.1', 0, db_path, origins={...}, validator=callable)`;
the returned server exposes normal `serve_forever`, `shutdown`, `server_close`.
`NodeValidator(module_path=fixture_path)` uses a disposable fixture module in
tests. Passing a NodeValidator explicitly transfers cleanup responsibility to
the caller. `python3 server/server.py` is also supported.

## Operational bounds

Requests use HTTP/1.0 connection-close responses, a 60 KiB JSON body limit, a
2 KiB request-target limit, strict JSON without duplicate keys/NaN, explicit
Content-Length, and no transfer/content encodings. Socket reads have a 5-second
total deadline, including slowly trickled headers and bodies. At most 16 requests
run at once. In-memory fixed-minute limits are 120 reads and 60 mutations per
peer, 40 mutations per owner, 2,000 requests globally, and 10,000 rate keys.
Limits reset on restart. No untrusted forwarding header bypasses these limits.
Capacity is 500,000 retained runs and 100,000 public scores. SQLite operations
have a 2-second lock timeout. `Limits` is injectable for disposable tests.

Public scores and run receipts are removed after 90 days during API activity
(including health checks). An idle service leaves expired rows on disk until
the next API activity; old entries cannot be returned publicly. No background
service, deployment, publication or original-board test post is part of this code.
