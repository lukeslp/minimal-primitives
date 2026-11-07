# Real score verification

Luke Steuber. Private disposable acceptance audit, October 14, 2026.
This file is the report file for integration failures and main-owned fixes.

The target is selected by `MINIMAL_ROOT`, otherwise this worktree. No service,
runtime, adapter, imported snapshot or deployment file is changed by these tests.
The ZIP's default `apiBase` must remain empty. Tests never contact public boards.

## Verified result

The final package runs **8 real-service tests and 8 browser scenarios** through
`npm test`, using actual HTTP, SQLite and the pinned Node validators. The runner
`node tests/real-score-audit.cjs` also rebuilds and runs those stages separately.
The final artifact/hash is recorded in `release/verification.json`.

The standalone ZIP retains `apiBase: ""`. The private local preview supplies its
own loopback API configuration and separate database. Test profiles, boards and
receipts never reach public services. No model calls or dependency installation
are needed by these checks.

Confirmed integration paths are `server/server.py`, `server/validate.mjs`,
`adapters/validators.mjs`, `adapters/hex-validator.mjs`, `web/collection.js`,
`web/scores-transport.js`, and generated Bridges/Slant Scores compatibility.
No required main-owned runtime fix was established. In particular,
`server/server.py::infinite` already recognizes `cleared-v1`, and the actual
`infinite-light:easy` board returned descending counts and the owner's best
count. The fixture corrections and their original failures are recorded below.

## Reproduce

```sh
node tests/real-score-audit.cjs
# Audit another already-built target; still build only this test checkout:
MINIMAL_ROOT=/absolute/path/to/target node tests/real-score-audit.cjs
```

The target must already have `build/html` when it is a different checkout.
The runner never builds or edits that other checkout. For separate stages:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/build.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_real_scores.py -v
node tests/real-score-browser.cjs
```

Python's unittest discovery also picks up the real-service API suite. Browser
acceptance is explicit through the audit runner or browser script. The supplied
Playwright and Chrome locations are defaults; `MINIMAL_PLAYWRIGHT` and
`MINIMAL_CHROME` can override them. Node, Python, OpenSSL and the installed
browser are used without installing packages. Allow approximately 30 seconds
for the combined audit; missing approved ports or a missing build fails closed.

## Runs and findings

- Initial API run: all twelve valid first-board/Hex proofs passed through real
  HTTP, SQLite and one persistent `server/validate.mjs` process. One negative
  Bending vector was mistakenly still valid: its first board has one planet.
  Corrected `tests/test_real_scores.py` to use an extra duplicate and an invalid
  position. Rerun: seven tests passed, including all negative proof cases.
- Initial browser run: restored Notan's tile gains completion/resume text, so
  an exact accessible-name selector stopped matching. Corrected the test's
  tile-title selector in `tests/real-score-browser.cjs`. No runtime fix needed.
- The next browser runs passed Notan publication/removal but exposed a harness
  CORS flaw: Playwright interception skips preflight even with `route.continue`.
  A forbidden POST reached the service (403) instead of stopping at OPTIONS.
  Replaced interception with a real loopback CONNECT egress proxy, which permits
  only the fixture authorities. This preserves Chromium's native CORS behavior.
- A later harness assertion incorrectly prohibited a run when reopening Notan
  after opting in. The game correctly selected the newly unlocked `cup` board,
  a fresh future attempt. Removed that assertion; the finished local solve and
  opt-in themselves must produce no POST. Also supplied an explicit assertion
  message to avoid Node 26's undefined-message error masking mismatch details.
- First Slant browser solve using slash/backslash keys timed out at completion.
  The harness now uses the existing compatibility suite's native Enter-cycle
  input path, with a state assertion after each cell. This does not seed state
  or call the completion/adapter hooks. Runtime cause is not established.
- All three native browser game/mode solves subsequently passed. The final
  egress assertion then counted Chrome's own Google background tunnel attempts
  as application traffic. These were all denied locally. The harness now keeps
  application-request assertions separate from denied browser background
  destinations; the egress proxy still cannot open any external connection.
- The added mid-attempt opt-in scenario initially polled the local result before
  its asynchronous storage write, dereferencing null. Corrected the polling
  predicate to wait for the record. The preceding real assisted solve passed.
- Final combined rerun passed all eight API tests and eight browser scenarios.

## Browser evidence and boundaries

The real parent UI creates a new anonymous profile, opts in and solves Notan's
first board with native cell keyboard events. The service accepts its actual
adapter proof, the parent displays the real board entry, retains the returned
score ID and withdraws it. Hint followed by Undo stays assisted through real
proof acceptance. Local completion and mid-attempt opt-in produce no upload;
the latter leaves an actual local practice result.

Bridges Classic and Slant Standard/Hard are solved entirely through native
keyboard input. Tests read pinned engine answers but never write solution state,
call completion/adapter hooks or inject parent run/profile objects. Only the
unscored primer marker and Slant's native mode preference are initialized.
Each mode verifies the shared parent nickname, actual receipt, all five native
category reads, pinned six-field query identity and removal from both SQLite
and the parent's saved score list. Each has exactly one start and one finish;
opening Scores creates neither.

Bridges Circuits has real pinned proof/API acceptance (as does Slant Hard), but
the current collection catalogue exposes no Circuits entry. Its full browser
launch is outside this audit; no altered catalogue or replacement parent was
introduced. All other finite games and all three Hex modes have actual proof/
API checks, not full browser gameplay coverage. Hex terminal fixtures are
synthetic, not gameplay recordings. The Slant slash/backslash shortcut timeout
was not localized; accepted Slant coverage uses native Enter, as detailed above.
There is no proposed main-owned fix for that unestablished shortcut cause.

The browser's application contexts attempted zero external requests. Chrome
background traffic attempted four distinct external destinations; the local
CONNECT proxy denied them without making external connections. This is
separate from application-request assertions, which still fail on any external
URL or original `scores-api` request. Allowed preflight returned 204; forbidden
preflight returned 403, Fetch rejected with TypeError and no POST followed.

## Scope and isolation

`tests/test_real_scores.py` runs the target's default Python service and actual
Node dispatcher with no injected validator/module/clock. Fixtures independently
derive first-board solutions with SHA-checked pinned engines. All nine finite
games plus Sphere, Classic and `infinite-light:easy` proofs traverse the API.
Hex vectors are synthetic graph-consistent terminal states, not browser runs.

Checks include exact identities, native measures, changed layouts/rules/policies,
unknown boards/modes, invalid states/replays/counts, sticky assistance/repeat/
practice after rejection, automatic repeat, private finishes, idempotent starts
and finishes, conflicting retries, cross-run submission reuse, ownership and
withdrawal without resurrection. Infinite counts and best-per-owner selection
must descend under `cleared-v1` even though the mode is `infinite-light:easy`.
CORS rejection must precede mutations. SQLite is checked for receipt uniqueness,
owner hashing, absent bearer/plain-proof fields and private permissions.

`tests/real-score-browser.cjs` serves the real export beneath
`/preview/anthology/` on a disposable HTTPS loopback fixture. A separate HTTPS
API hostname proxies bytes to the real local HTTP Python service. It forwards
Origin and Authorization unchanged and forwards the service's response headers;
it never manufactures CORS headers or score responses. Chromium performs real
OPTIONS requests and must block a forbidden origin before POST. No
Playwright request interception, substituted validator or disabled web security
is used. A second loopback CONNECT proxy permits only the three fixture
authorities and opens sockets only to the fixture's loopback TLS listener.
Application requests outside those hosts are denied and fail the audit.
Profiles are opted in through the parent UI; bearer secrets are never printed.

All listeners check and bind only 5011–5019 or 5051–5059, never 5010. SQLite,
certificates and browser profiles live outside Git and are removed on exit.
Only fixture rate limits are raised to accommodate the audit; rule validation
and timing use the service defaults. No dependencies, models or deployment.
