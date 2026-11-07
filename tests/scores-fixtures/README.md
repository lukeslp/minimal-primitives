# Native Scores compatibility handoff

Luke Steuber. This fixture uses generated pinned Bridges/Slant pages under
`/preview/anthology/`, a separate fixture parent, and an in-memory loopback HTTP
stub. It never contacts the original boards or any external host. Run
`node tests/scores-compat.cjs`; it uses the supplied Playwright/Chrome paths,
creates its output under the system temporary directory, and removes it on exit.
No dependency installation is needed.

## Main-owned wiring

1. Import `score_recipe.transform` in `tools/transforms.py` and compose it with
   the existing transform for each generated source. Either order works; do not
   call the Scores transform twice. Raw snapshots remain untouched. Source SHA
   and HTML script-anchor drift raise `ValueError`.
2. Copy `adapters/scores-compat.js` to the export root beside `bootstrap.js`.
   The recipe injects its script before each native `scores.js`. Bootstrap must
   run first. Load `scores-transport.js` before `collection.js` in the parent.
   The existing web copier already includes the new parent script file.
3. After the existing parent source, exact-origin, v, game, nonce and monotonic
   sequence checks, route `type === 'scores-request'` to
   `await MinimalScoresTransport.handle(data.payload, context)`. Capture the
   requesting frame and nonce before awaiting. Respond to that captured frame
   with exact target origin, never a wildcard:

   ```js
   {v:1, nonce:requestNonce, type:'scores-response',
    payload:{request:data.payload.request, result}}
   // On rejection, use payload:{request:data.payload.request,error:error.message}.
   ```

   Route Scores messages before the existing generic `pending` lookup. Their
   request IDs belong exclusively to the native Scores transport. Do not reuse
   the parent's snapshot/restore request map.
4. Supply this context (the getters prevent stale asynchronous actions):

   ```js
   const context = {
     api, profile,
     get attempt() { return attempt; },
     get active() { return active; }, // active.game.id
     persistProfile() { write('profile', profile); renderLibrary(); }
   };
   ```

   `api(path, options = {})` accepts relative paths beneath the isolated
   `/api/v1/` base, authenticates with the parent's secret and returns parsed
   JSON or rejects. The compatibility handler calls only `GET boards?...` and
   `DELETE scores/:id`. It never calls POST, original scores-api URLs, runs,
   finish or a publication endpoint. `persistProfile()` may return a promise.
   Profile is the single shared mutable `{secret,nickname,sharing,scores:[id]}`
   object; secret is never included in child responses.
5. Keep the existing attempt fields
   `{id,identity,run,assisted,repeat,practice,optedIn,finished}`. Retain the
   parent's completion receipt so it can be displayed without another finish:

   - `ready`: optional promise settling the existing start operation. It resolves
     after `run`/`practice` have been updated, including offline failure.
   - `completion`: promise assigned synchronously when `finished` becomes true.
     It covers the parent's existing finish and identical-body retries, resolves
     to `{score,ranked}` or `null` on failure/local-only finish, and never rejects.
   - `result`: retain that receipt on the attempt. Update `profile.scores` and
     persist successful publication before resolving `completion`. A receipt's
     `score` needs `{id,run,identity,category,elapsedMs}`.

   `ready` is optional; `completion`/`result` are necessary to show server timing
   and the native removal button. Missing receipts fail closed to a local-only
   message. No request is queued for future publication. Preserve the parent's
   sticky practice/repeat/assisted and attempt-start opt-in decisions.

## Request and result contract

Every child request is emitted by `MinimalBridge.emit('scores-request', payload)`
so it inherits `{v:1,game,nonce,sequence}`. Payload contains
`{request,action,board,attempt?}`. `request` is a fresh UUID. `board` is
`{game,puzzle,mode,layoutHash}`: puzzle ID, native mode string, and SHA-256 of
recursively key-sorted native layout JSON. The parent matches it against the
current attempt, then uses all six identity fields from that pinned attempt.
It never forwards the old native digest or accepts child rules/policy overrides.

| Native mode | Pinned mode |
| --- | --- |
| Bridges `classic-v1` | `classic` |
| Bridges `circuits-v1` | `circuits` |
| Slant `slant-standard-v1` | `standard` |
| Slant `slant-v1` | `hard` |

Actions:

- `state`: await existing start/completion promises; return the parent state.
- `board`, with `category`: read the exact pinned board; return
  `{category,entries:[{rank,alias,seconds}]}` from service nickname/elapsedMs.
- `preference`, with `nickname`: normalize/validate and persist the shared name
  and `sharing:true`. Changing name or opting in marks the current attempt
  practice. It never upgrades `optedIn`, starts a run or promotes a receipt.
  The native button explicitly says **Share future scores**.
- `remove`, with `id`: require the current published receipt and membership in
  `profile.scores`; delete using the parent API, then remove the profile ID.
  Failed deletion leaves that ID available for retry. It does not disable future
  sharing or resurrect a deleted score.

State/preference/remove return
`{attempt,profile:{nickname,sharing},finished,category,result}`. Result is null
without an exact current-run receipt, otherwise
`{seconds,category,published,id?}`; id is present only for a published score still
owned in the parent profile. Seconds are elapsedMs floored to native seconds,
minimum one. Follow-up child requests bind to the returned parent attempt ID.

The child accepts only parent-source, exact-origin, v1, matching-nonce responses
with its pending request ID and exactly one result/error. Requests expire after
12 seconds, and pending work is cleared on pagehide. Board switches and closed or
newer dialog views ignore stale asynchronous results. Network errors never gate
load, input, assistance, restart, completion or local game storage.

## Evidence and limits

The suite exercises both real native dialog entry points and all four modes,
category reads, shared nicknames, automatic receipt reuse, failed/successful
removal, finished-local opt-in, mid-attempt nickname changes, stale attempts and
views, forged response envelopes, empty/unavailable boards, request timeout,
future attempts after opt-in, and failed finishes.
Every normal online mode flow asserts exactly one parent start and finish.
Slant is solved through native cell keyboard input; Bridges fixtures seed an
almost-solved state through its existing debug hook and apply the last edge with
the native Hint action. These checks verify transport integration, not complete
gameplay acceptance or real proof validation. The HTTP stub deliberately does
not implement the actual SQLite validator. The production shell/build wiring,
real service integration and deployment remain main-owned and unmodified here.
