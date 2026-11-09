# Core Module (`src/core`) — Design

Source: `.kiro/specs/core/requirements.md` (rev 3 — rev 2 approved, rev 3 adds `minElapsedMs`).
Stage: **Design** (approved; updated for `minElapsedMs`).

This design is lean: six small files, pure functions, no browser. It explicitly answers the six conditions from your approval (collected in §8) and traces every requirement to a component (§9).

## 1. Goals and constraints (recap)

- Pure TypeScript, no DOM/React/timers/clock. Time is data (ms since session start). (C1, C2)
- Functional: pure functions, immutable inputs/outputs. (C2, C3)
- All tunables in `src/core/config.ts`. (R21)
- No new dependencies. (C6)
- Every public function gets unit + property tests. (T1, T2)

## 2. Module layout (six files)

| File | Responsibility | Exports (public) |
| --- | --- | --- |
| `src/core/config.ts` | All tunable numbers, one place. | `CoreConfig`, `defaultConfig` |
| `src/core/types.ts` | Public data types only. | `SpeechEvent`, `SpeakingState`, `LiveSnapshot`, `SessionSummary` |
| `src/core/session.ts` | Accumulator: ingest events into state. | `SessionState` (opaque), `createSession()`, `ingest()` |
| `src/core/snapshot.ts` | State at a time `t`: WPM + speaking state. | `liveSnapshot()`, `speakingStateAt()` |
| `src/core/summary.ts` | End-of-session summary incl. `percentByState` sampling. | `sessionSummary()` |
| `src/core/index.ts` | Barrel re-export of the public API. | re-exports |

Internal helpers (`wordsAt`, `wpmAt`, `classify`, `findSilenceAt`) are not re-exported from `index.ts`; they stay file-local where their responsibility lives. `speakingStateAt` is exported from `snapshot.ts` because `summary.ts` reuses it for sampling (single source of truth for the state-classification rules R7–R10).

## 3. Config (`src/core/config.ts`)

```ts
export type CoreConfig = {
  windowMs: number;          // rolling window for live WPM        (R5)
  pauseThresholdMs: number;  // silence longer than this = a pause  (R8, R14)
  steadyMinWpm: number;      // below this = slow                    (R10)
  steadyMaxWpm: number;      // above this = rushing                  (R10)
  minWindowWords: number;    // below this, WPM is unknown           (R5)
  minElapsedMs: number;     // below this elapsed window, WPM is null (R5/D8) — added in rev 3
  sampleStepMs: number;      // fixed step for percentByState sampling (D1/§7.4) — added by design
};

export const defaultConfig: CoreConfig = {
  windowMs: 10000,
  pauseThresholdMs: 2000,
  steadyMinWpm: 110,
  steadyMaxWpm: 170,
  minWindowWords: 5,
  minElapsedMs: 3000,
  sampleStepMs: 100,
};
```

**Note on the two added settings.** Requirements §3.2 originally listed five settings; this design added `sampleStepMs` (the fixed-step sampler needs it), and rev 3 added `minElapsedMs` (per review, to cap early-session WPM). Both are tunable numbers, so per R21 they live in `config.ts` and nowhere else. Defaults: `sampleStepMs = 100` (rationale in §7.4), `minElapsedMs = 3000` (rationale in §6.2).

All public functions take `config?: CoreConfig` defaulting to `defaultConfig`, so tests pass a custom config without mutating any global (R23).

## 4. Internal state model (`src/core/session.ts`)

```ts
export type SessionState = {
  firstT: number | null;                 // first accepted event timestamp; null until first event
  lastT: number;                         // last accepted event timestamp (0 if none) — used to clamp endT
  maxTotalWords: number;                 // running max of totalWords (for the R24 ignore rule)
  openSilenceStart: number | null;        // start t of the current in-progress silence, or null
  silences: Array<{ start: number; end: number }>;  // closed silence intervals, sorted by start, non-overlapping
  wordsEvents: Array<{ t: number; totalWords: number }>;  // accepted word-count milestones, sorted by t, strictly increasing in totalWords
};
```

Invariants maintained by `ingest`:
- `firstT` set once, never changed.
- `lastT` is non-decreasing.
- `silences` are sorted by `start`, non-overlapping, each `end >= start`.
- `wordsEvents` `totalWords` strictly increase (ties are accepted as no-progress and do **not** add a milestone — see §5.1).
- `maxTotalWords` equals the last milestone's `totalWords` (0 if none).

State is **immutable**: `ingest` returns a new `SessionState` (shallow copy + new arrays via spread). Given rehearsal-scale event counts this is cheap and keeps everything pure (R3). `createSession()` returns the empty state.

**Why cached aggregates instead of a full event log:** the snapshot and sampler need state at arbitrary times `t` (including past times during sampling). I store exactly the two things needed for O(log n) lookup — word-count milestones (for WPM) and silence intervals (for pause state) — rather than replaying all events. This keeps snapshot/sampling efficient and the model small.

## 5. Ingest algorithm (`ingest(state, event, config) -> SessionState`)

Pure. Handles one event; returns new state. Order of checks matters.

### 5.1 `words` event
1. If `event.t < state.lastT` → **ignore** (out-of-order, R2). (Equal `t` is allowed — see §8.1.)
2. If `event.totalWords < state.maxTotalWords` → **ignore** (decreasing word count, R24).
3. Set `firstT` if null. Update `lastT = event.t`.
4. If `event.totalWords === state.maxTotalWords` (tie) → **accepted as no-progress**: `lastT` is updated (an event occurred), but no milestone is added and `maxTotalWords` is unchanged. (R24)
5. If `event.totalWords > state.maxTotalWords` → push `{ t: event.t, totalWords }` onto `wordsEvents`, set `maxTotalWords = event.totalWords`.
6. `words` events never touch `openSilenceStart` or `silences` (R25).

### 5.2 `silenceStart` event
1. If `event.t < state.lastT` → ignore (R2).
2. If `state.openSilenceStart !== null` → **ignore** (already silent, R26).
3. Else set `openSilenceStart = event.t`, set `firstT` if null, update `lastT = event.t`.

### 5.3 `silenceEnd` event
1. If `event.t < state.lastT` → ignore (R2).
2. If `state.openSilenceStart === null` → **ignore** (no open silence, R26).
3. Else close it: push `{ start: openSilenceStart, end: event.t }` onto `silences`, set `openSilenceStart = null`, update `lastT = event.t`. (`end >= start` because `event.t >= lastT >= start`.)

## 6. Snapshot (`src/core/snapshot.ts`) — answers conditions 2 and 3

`liveSnapshot(state, t, config) -> LiveSnapshot`. **`t` is an explicit parameter** (condition 2): the snapshot computes paused from any open silence evaluated *at `t`*, not only at the last event. This lets the live UI sample "now" between/after events. Works for any `t >= 0`; for `t < firstT` it returns `{ t, wpm: null, state: 'steady' }`.

### 6.1 `wordsAt(state, tau) -> number` (condition 3)
Returns `totalWords` of the **last accepted words milestone with `t <= tau`**, or `0` if none. Implementation: binary search the rightmost milestone with `t <= tau`. This is the chosen "last event at or before" model (not interpolation). Rationale (§8 C3): `totalWords` is a cumulative counter reported only at discrete word events; treating it as a step function held constant between events is the honest model — interpolation would invent speech that didn't occur.

### 6.2 `wpmAt(state, t, config) -> number | null`
1. If `firstT === null` → `null`.
2. `windowStart = max(firstT, t - windowMs)` (clamp to session start — the early-session fallback, D6/R5).
3. `windowDuration = t - windowStart` (= `min(windowMs, t - firstT)`). If `windowDuration < minElapsedMs` → `null` (R5/D8; this also covers `<= 0` and guards R6). At exactly `minElapsedMs`, WPM computes normally.
4. `current = wordsAt(state, t)`; `base = wordsAt(state, windowStart)`; `wordsInWindow = current - base`.
5. The window is half-open `(windowStart, t]`: words at exactly `windowStart` are excluded, words at exactly `t` are included (consequence of "last event at or before" — §8 C3).
6. If `wordsInWindow < minWindowWords` → `null` (R5/D6).
7. Else `wpm = (wordsInWindow * 60000) / windowDuration`. Always finite and `>= 0` (R6).

**Note (design — early WPM reads low by design):** words that arrive exactly at `firstT` sit at the window start and are excluded by the half-open window, so the first words contribute to `totalWords`/milestones but not to an early-window `wordsInWindow`. Combined with `minElapsedMs`, early WPM reads low (or `null`) by design — this avoids inflating the rate from a sub-`minElapsedMs` sample (e.g., a few words in the first 500 ms no longer spike to hundreds of WPM).

### 6.3 `findSilenceAt(state, t) -> { start: number } | null`
A time `t` is inside a silence interval iff `t` falls in some `[start, end)` (closed silences) or in `[openSilenceStart, ∞)` (the in-progress one). Intervals are non-overlapping and ordered (R20), so:
- If `openSilenceStart !== null && openSilenceStart <= t` → return `{ start: openSilenceStart }`.
- Else binary search `silences` for the rightmost interval with `start <= t`; if that interval has `t < end` → return `{ start }`.
- Else `null`.
Half-open `[start, end)` means a 0-length silence (`start === end`) contains no time and is never paused — consistent with R20.

### 6.4 `speakingStateAt(state, t, config) -> SpeakingState` (the shared classifier)
Priority order, highest first (R7):
1. `paused`: let `s = findSilenceAt(state, t)`; if `s && (t - s.start) > pauseThresholdMs` → `paused` (R8).
2. Else `wpm = wpmAt(state, t, config)`; if `wpm === null` → `steady` (R9).
3. Else if `wpm > steadyMaxWpm` → `rushing`; if `wpm < steadyMinWpm` → `slow`; else `steady` (R10).

### 6.5 `liveSnapshot`
`{ t, wpm: wpmAt(state, t, config), state: speakingStateAt(state, t, config) }`.
`wpm` is reported even when `state === 'paused'` (the rules compute them independently; R7 only prioritizes `state`). The stage layer decides how to render that.

## 7. Summary (`src/core/summary.ts`) — answers condition 1

`sessionSummary(state, endT?, config) -> SessionSummary`.

### 7.1 `endT` handling (condition 3 / D3)
- `endT` optional; if omitted (tests only) default to `state.lastT`.
- **Clamp**: `endT = max(endT, state.lastT)` (R27). For an empty state `lastT = 0`, so `endT = max(endT, 0)`.

### 7.2 Scalars
- `firstT = state.firstT ?? 0`.
- `durationMs = endT - firstT` (clamped `>= 0`; for empty state, `0`). (R12) This **matches the WPM elapsed-time rule**: WPM's `windowDuration` clamps to `firstT`, so at the session end the WPM "elapsed" is `endT - firstT` = `durationMs` — both measured from `firstT`, the first accepted event's time.
- `totalWords = state.maxTotalWords`.
- `averageWpm = durationMs > 0 ? totalWords / (durationMs / 60000) : 0`. Pauses are included (duration is total elapsed time; never subtracted). Guarded against zero/negative duration → `0`. (R13/D7)

### 7.3 Pauses (for `pauseCount`, `longestPauseMs`)
A silence is a **counted pause** iff its length exceeds `pauseThresholdMs` (strictly longer):
- Each closed `silences[i]` with `end - start > pauseThresholdMs`.
- The open silence if `openSilenceStart !== null && endT - openSilenceStart > pauseThresholdMs` (R14, evaluated at clamped `endT` — counts only if longer than the threshold).
- `pauseCount` = number of counted pauses (R14, R19).
- `longestPauseMs` = max length among counted pauses, or `0`. By construction `>=` every counted pause (R15).

### 7.4 `percentByState` — fixed-step sampling (condition 1 / D1)
- **If `durationMs === 0`** → all four states `0` (R16/D1). No sampling.
- **Else**: sample at fixed step `sampleStepMs` from `0` to `endT` inclusive:
  - sample times `T = [0, step, 2*step, …, k*step]` where `k = floor(endT / step)`, **plus a final sample at `endT`** if `endT` is not already a multiple of `step`. So the endpoint is always sampled (captures a final in-progress pause).
  - For each `t_i` in `T`: `st = speakingStateAt(state, t_i, config)`; increment `count[st]`.
  - `N = |T|` (>= 1). `percentByState[s] = (count[s] / N) * 100` for each `s`, divided once at the end.
- **Sum is 100 by construction** when `durationMs > 0`: every sample is classified into exactly one state, so `Σ count[s] = N` and `Σ percentByState[s] = 100` (within float tolerance < 0.01, satisfying T2). (R16)
- Determinism: classification is a pure function of `(state, t_i, config)`; the sample grid is fixed; therefore `percentByState` is deterministic. (R3)
- **Integer-count basis / invariants-only testing:** `percentByState[s] = (count[s] / N) * 100` is derived from the **integer** sample counts `count[s]`. Tests assert **invariants only** — sum is 100 (±0.01) when `durationMs > 0`, each value in `[0, 100]`, all zeros when `durationMs === 0`, all four keys present — never exact percentage values, since those depend on the sample grid and step size.

**Step size = `sampleStepMs`, default 100 ms.** Rationale: with `pauseThresholdMs = 2000`, a 100 ms step yields ~20 samples within the shortest resolvable pause and ~100 samples per `windowMs = 10000` window, so state transitions (including the `paused` onset exactly at `threshold`) are captured to within 100 ms. A 5-minute run = ~3001 samples × O(log n) ≈ tens of thousands of ops — negligible. It is tunable in `config.ts` if a future run needs finer resolution.

## 8. Design decisions answering the six approval conditions

For review, each condition and the design's answer:

- **C1 — `percentByState` determinism (fixed-step sampling, step size).** Fixed-step sampling from `0` to `endT` inclusive at `sampleStepMs` (default **100 ms**), always including the `endT` endpoint. State at each sample comes from the pure `speakingStateAt`. Sum = 100 by construction when `durationMs > 0`; all zeros when `durationMs === 0`. See §7.4.
- **C2 — snapshot takes `t` as a parameter and computes `paused` at `t`.** `liveSnapshot(state, t, config)`; `paused` is derived from any open silence evaluated at `t` via `findSilenceAt`, not only when an event arrives. See §6.
- **C3 — words-in-window from cumulative `totalWords` at window start.** Chosen: **last milestone at or before the window-start time** (binary search), not interpolation. Window is half-open `(windowStart, t]`; `wordsInWindow = wordsAt(t) − wordsAt(windowStart)`. See §6.1–6.2.
- **C4 — determinism property test clarified.** The property is: *calling a read function twice on the same state returns structurally equal output* (`liveSnapshot(S, t)` twice; `sessionSummary(S, endT)` twice). It is **not** "ingest `E` then ingest `E` again appended." Separately, R3's re-run property is: build state from `E` twice from a fresh start → equal states → equal outputs. Both are purity tests of reads, neither concatenates the sequence with itself. See §10.2.
- **C5 — equal timestamps.** **Allowed.** Timestamps must be **non-decreasing** (`event.t >= lastT`), not strictly increasing; `event.t === lastT` is accepted (not ignored by R2). Edge handling is already defined: a `silenceStart`/`silenceEnd` at the same `t` yields a 0-length interval (never paused, never counted); ties in `totalWords` at the same `t` are accepted as no-progress. *Reconciliation with the generator:* the "valid sequences: increasing timestamps" wording in your instruction is read as **non-decreasing** to match this decision. See §8.1 / §10.3.
- **C6 — fast-check event-sequence generator as its own task.** Not built in design; specified here so `tasks.md` can include it as a standalone task. Acceptance: a reusable generator producing **valid** sequences — non-decreasing timestamps, non-decreasing (cumulative) word counts, balanced silences (every `silenceStart` has a later `silenceEnd`; no two `silenceStart`s without a `silenceEnd` between; no `silenceEnd` without an open `silenceStart`). A companion "dirty" strategy injects out-of-order timestamps, decreasing word counts, duplicate `silenceStart`, and stray `silenceEnd` to exercise the ignore rules (R2, R24, R26). See §10.3.

### 8.1 Equal-timestamp note (possible veto point)
Because your generator wording said "increasing" and I decided equal timestamps are allowed, the generator will produce non-decreasing timestamps. If you actually want **strictly increasing** timestamps (forbid equal `t`), say so and I will (a) change the decision to forbid equal `t`, (b) make the generator strictly increasing, and (c) drop the equal-`t` edge handling (or keep it only as a documented "should not occur" guard). Flagging so you can veto.

### 8.2 `minElapsedMs` note (added in rev 3)
`minElapsedMs` (default 3000) gates WPM by elapsed window duration, symmetric to `minWindowWords` (which gates by word count). It returns `null` while `windowDuration < minElapsedMs`, so the first ~3 s of a session show `null` WPM (ghost steady/neutral) even if the speaker is talking fast, preventing sub-second spikes. Tradeoff: a short warm-up where the WPM dial reads "unknown." See §6.2 and the half-open-window note there.

## 9. File → requirement traceability

| Requirement | Where satisfied |
| --- | --- |
| R1 (in-order processing) | `session.ts` ingest |
| R2 (out-of-order ignored) | `session.ts` ingest step 1 each branch |
| R3 (pure/deterministic) | immutability in `session.ts`; purity of `snapshot.ts`/`summary.ts` reads |
| R24 (decreasing words ignored) | `session.ts` §5.1 step 2 |
| R25 (silence only from silence events) | `session.ts` §5.1 step 6 |
| R26 (dup start / stray end ignored) | `session.ts` §5.2 step 2, §5.3 step 2 |
| R4 (snapshot at recent `t`) | `snapshot.ts` `liveSnapshot` |
| R5 (window, early-session, minElapsedMs, minWindowWords) | `snapshot.ts` `wpmAt` §6.2 |
| R6 (wpm never neg/NaN/Inf) | `snapshot.ts` `wpmAt` guards |
| R7 (state priority) | `snapshot.ts` `speakingStateAt` §6.4 |
| R8 (paused from open silence > threshold) | `snapshot.ts` `findSilenceAt` + `speakingStateAt` |
| R9 (null wpm & not paused → steady) | `snapshot.ts` `speakingStateAt` |
| R10 (wpm bands) | `snapshot.ts` `speakingStateAt` |
| R11/R27 (endT default + clamp) | `summary.ts` §7.1 |
| R12 (durationMs) | `summary.ts` §7.2 |
| R13 (averageWpm, pauses included) | `summary.ts` §7.2 |
| R14 (pauseCount incl. in-progress, only if > threshold) | `summary.ts` §7.3 |
| R15 (longestPauseMs) | `summary.ts` §7.3 |
| R16/R17 (percentByState sum/all-zeros) | `summary.ts` §7.4 |
| R18 (never NaN/Inf) | guards in `wpmAt`, `summary.ts` |
| R19 (pauseCount ≤ silenceStart count) | `summary.ts` §7.3 (only opened silences counted) |
| R20 (pauses non-overlapping, non-negative) | `session.ts` §5.2/5.3 + half-open intervals |
| R21–R23 (config) | `config.ts` + `config?` params |
| C1–C6 | all files; no imports outside `core` |

A3 (no imports from audio/stage/pdf/DOM) is enforced by keeping `core/` self-contained; `index.ts` exports only the public API.

## 10. Testing strategy

### 10.1 Unit tests (T1)
One describe-block per public function: `createSession`, `ingest` (per event type + each ignore rule), `liveSnapshot` (incl. early-session, paused-at-`t` between events), `sessionSummary` (incl. empty session, in-progress pause, `endT` clamp). Plus targeted edge cases: equal timestamps, 0-length silences, ties in `totalWords`, `minElapsedMs` boundary (2999/3000 ms). For `sessionSummary`'s `percentByState`, unit tests assert **invariants only** (sum, range, all-zeros, key presence), never exact percentages.

### 10.2 Property tests (T2) — including the determinism clarification (C4)
Each invariant in requirements T2 gets a dedicated `fast-check` test:
- `wpm` never negative/NaN/Infinity (R6).
- `percentByState` sums to 100 (within 0.01) **when `durationMs > 0`**; all zeros when `durationMs === 0` (R16).
- Pauses never overlap, never negative length (R20).
- `longestPauseMs >=` every counted pause (R15).
- `pauseCount <=` number of `silenceStart`s (R19).
- **Determinism (C4)** — two parts, both required:
  - *Read purity:* `liveSnapshot(S, t)` called twice → structurally equal; `sessionSummary(S, endT)` called twice → structurally equal.
  - *Re-run purity (R3):* build state from `E` from a fresh `createSession()` twice → states structurally equal → snapshots/summaries equal. This is **not** "ingest `E` then ingest `E` appended."
- Raising `pauseThresholdMs` never increases `pauseCount` (R22).
- A `words` event never starts/ends/resets a silence (R25).
- A `words` event with decreasing `totalWords` is ignored and changes no output (R24).
- Early-session `wpm` is `null` until `windowDuration >= minElapsedMs` **and** `>= minWindowWords` words in the window (R5).
- `endT` clamped to `>= lastT`; summary stable for any `endT >= lastT` (R27).

### 10.3 Event-sequence generator (own task — C6)
Specified here; implemented as a standalone task in `tasks.md`. Two strategies:
- **`validSequence`** (for the invariant property tests): non-decreasing timestamps (per §8.1), non-decreasing cumulative `totalWords`, balanced silences, optional single trailing open silence (to exercise the in-progress case). Yields a `SessionState` (via folding `ingest`) plus a suggested `endT >= lastT`.
- **`dirtySequence`** (for the ignore-rule tests): injects out-of-order timestamps, decreasing `totalWords`, duplicate `silenceStart`, and stray `silenceEnd`, so R2/R24/R26 are exercised. The oracle is "the dirty events produce the same state as the equivalent clean sequence with those events removed."

`fast-check` arbitraries: non-negative integer timestamps with a configurable max gap; `totalWords` as a non-decreasing counter; silence open/close as a balanced-parenthesis stream interleaved with word events.

## 11. What is NOT in this design (deferred)
- No persistence, no clock, no audio, no UI. (scope lock)
- `pdfjs-dist` is not added. (C6)
- The event-sequence generator is specified but not yet a task. (built in `tasks.md`)
- No "Present mode", graveyard, séance, backend, accounts, or audio storage. (scope lock)

---

**Status: Design updated for `minElapsedMs` (rev 3 of requirements). Approved earlier; `minElapsedMs` reflected here per review.**
