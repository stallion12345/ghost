# Core Module (`src/core`) — Tasks

Source: `.kiro/specs/core/requirements.md` (rev 2, approved) and `.kiro/specs/core/design.md` (approved).
Convention: **one task at a time**, stop after each for review and commit. **Every task ends with `npm test` and `npm run build` green.** No new dependencies (C6). No edits outside `src/core/` except `index`-barrel wiring, and only what a task needs.

Ordering rule honored: the fast-check generator (Task 5) comes before every property test that uses it (Tasks 6, 7).

---

## Task 1 — Config, types, and barrel skeleton

**Files:** `src/core/config.ts`, `src/core/types.ts`, `src/core/index.ts`.
**Implement:**
- `config.ts`: `CoreConfig` type and `defaultConfig` exactly as in design §3 (six fields incl. `sampleStepMs: 100`).
- `types.ts`: `SpeechEvent`, `SpeakingState`, `LiveSnapshot`, `SessionSummary` from design §3/§4 (public types only; no `SessionState` here — that's Task 2).
- `index.ts`: re-export `CoreConfig`, `defaultConfig`, and the four types.
**Tests:** smoke test (`src/core/config.test.ts`) so the suite is never empty — asserts every numeric config value is positive and finite, and `steadyMinWpm < steadyMaxWpm`. Import `describe`/`it`/`expect` from `vitest` explicitly (Vitest globals stay off; no `tsconfig` change).
**Covers:** R21, R23 (config in one place, overridable via param), C1/C3/C6.
**Done when:** `npm test` and `npm run build` pass.

## Task 2 — Session state and ingest

**Files:** `src/core/session.ts`; update `index.ts`.
**Implement:**
- `SessionState` (design §4, internal/opaque — not re-exported shape, only the type alias).
- `createSession(): SessionState` (empty state).
- `ingest(state, event, config?) -> SessionState` — pure, returns new state; all branches in design §5 (words / silenceStart / silenceEnd), incl. R2 out-of-order ignore, R24 decreasing-words ignore + ties as no-progress, R25 words never touch silence, R26 dup-start / stray-end ignored. Equal timestamps allowed.
**Tests (unit):** per event type and each ignore rule; equal-timestamp words/silence; 0-length silence; tie `totalWords`; ingest does not mutate input.
**Covers:** R1, R2, R3 (immutability), R24, R25, R26, C2.
**Done when:** `npm test` and `npm run build` pass.

## Task 3 — Snapshot: WPM and speaking state at a time `t`

**Files:** `src/core/snapshot.ts`; update `index.ts` to export `liveSnapshot` and `speakingStateAt`.
**Implement:**
- `wordsAt(state, tau)` — binary search rightmost milestone with `t <= tau`, else 0 (design §6.1).
- `wpmAt(state, t, config)` — early-session clamp to `firstT`, half-open window `(windowStart, t]`, null until `minWindowWords`, never neg/NaN/Inf (design §6.2).
- `findSilenceAt(state, t)` — open-silence then closed-interval membership, half-open `[start, end)` (design §6.3).
- `speakingStateAt(state, t, config)` — priority paused>rushing>slow>steady (design §6.4).
- `liveSnapshot(state, t, config)` — `{ t, wpm, state }` (design §6.5).
**Tests (unit, hand-built states via `ingest`):** early-session `wpm` null until 5 words; wpm bands (slow/steady/rushing); `paused` at a `t` between/after events when an open silence exceeds threshold; 0-length silence not paused; `wpm` reported (possibly stale) while `paused`; snapshot at `t < firstT` returns steady/null.
**Covers:** R4–R10, R6, R5/D6, R8, R9, R25 (words don't affect silence state).
**Done when:** `npm test` and `npm run build` pass.

## Task 4 — Summary: scalars, pauses, and `percentByState` sampling

**Files:** `src/core/summary.ts`; update `index.ts` to export `sessionSummary`.
**Implement:** `sessionSummary(state, endT?, config) -> SessionSummary` (design §7):
- `endT` default = `lastT`; clamp `endT = max(endT, lastT)` (R11/R27).
- `durationMs`, `totalWords`, `averageWpm = totalWords/(durationMs/60000)` with pauses included, guarded to 0 (R12/R13/D7).
- Pauses from closed silences + open-at-`endT`, each length `> pauseThresholdMs`; `pauseCount`, `longestPauseMs` (R14/R15/R19/R20).
- `percentByState` via fixed-step sampling `0..endT` at `sampleStepMs`, always sampling `endT`; all-zeros when `durationMs === 0` (R16/D1). Percentages from **integer** `count[s]/N*100`.
**Tests (unit, hand-built states):** empty session → fully zeroed summary; `endT` default + clamp; in-progress pause counted at `endT`; `averageWpm` includes pauses; `longestPauseMs` is the max. For `percentByState`: assert **invariants only** (sum = 100 ±0.01 when `durationMs > 0`; all-zeros when `0`; each in `[0,100]`; four keys present) — never exact percentages.
**Covers:** R11–R20, R16/D1, R27, D7.
**Done when:** `npm test` and `npm run build` pass.

## Task 5 — fast-check event-sequence generator (own task)

**Files:** `src/core/testing/generators.ts` (test-only helper; colocated with tests, not exported from `index.ts`).
**Implement:** two `fast-check` arbitraries/functions:
- `validSequence`: non-decreasing timestamps, non-decreasing cumulative `totalWords`, balanced silences (every `silenceStart` has a later `silenceEnd`; no two starts without an end between; no stray end), optional single trailing open silence. Yields an event array plus a suggested `endT >= lastT`.
- `dirtySequence`: injects out-of-order timestamps, decreasing `totalWords`, duplicate `silenceStart`, stray `silenceEnd`.
**Tests (property over the generators themselves):** every `validSequence` satisfies the validity invariants; every `dirtySequence` folds (via `ingest`) to the same state as the equivalent sequence with the dirty events removed (oracle for the ignore rules R2/R24/R26). Depends only on `session.ts`.
**Covers:** enables Tasks 6–7; exercises R2/R24/R26 via the dirty oracle.
**Done when:** `npm test` and `npm run build` pass.

## Task 6 — Property tests: snapshot & ingest invariants

**Files:** `src/core/__tests__/snapshot.property.test.ts` (or colocated per existing test layout).
**Implement (fast-check, using Task 5's `validSequence`/`dirtySequence`):**
- `wpm` never negative / NaN / Infinity for any sequence and any `t` in `[0, endT]` (R6).
- Early-session `wpm` is `null` until at least `minWindowWords` words in the window (R5/D6).
- A `words` event never starts/ends/resets a silence: silence state at `t` is invariant to inserting extra `words` events (R25).
- A `words` event with decreasing `totalWords` is ignored: same state as the sequence with it removed (R24).
- C4 read-purity: `liveSnapshot(S, t)` and `speakingStateAt(S, t)` called twice return structurally equal results (not sequence concatenation).
**Covers:** R5, R6, R24, R25, C4 (snapshot half).
**Done when:** `npm test` and `npm run build` pass.

## Task 7 — Property tests: summary & determinism invariants

**Files:** `src/core/__tests__/summary.property.test.ts`.
**Implement (fast-check, using Task 5's generators):**
- `percentByState` sums to 100 (±0.01) when `durationMs > 0`; all zeros when `durationMs === 0`; each value in `[0,100]`; four keys present — **invariants only** (R16/D1).
- `longestPauseMs >=` every counted pause length (R15).
- `pauseCount <=` number of `silenceStart` events (R19).
- Raising `pauseThresholdMs` never increases `pauseCount` (R22).
- Pauses never overlap and never negative length (R20).
- R3 re-run determinism: building state from `E` twice (fresh `createSession`) yields equal states and equal summaries.
- R27: summary stable for any `endT >= lastT`; `endT < lastT` is clamped to `lastT`.
- C4 read-purity: `sessionSummary(S, endT)` called twice returns structurally equal results.
**Covers:** R3, R15, R16, R19, R20, R22, R27, C4 (summary half).
**Done when:** `npm test` and `npm run build` pass.

## Task 8 — Coverage audit and final verification

**Files:** none new (add tests only if a gap is found).
**Implement:**
- Audit every R- and T-requirement against the test suite; list any uncovered requirement and add a covering test for it.
- Verify A3: grep `src/core` for forbidden imports (`react`, `dom`, `window`, `AudioContext`, `performance`, `Date`, `setTimeout`, `setInterval`) — none expected.
- Verify A4: no dependency added to `package.json`.
- Confirm A1/A2: `npm test` and `npm run build` pass; dev server still starts (`npm run dev` — note: started manually, not as a blocking step).
**Covers:** A1–A5; closes the spec.
**Done when:** `npm test` and `npm run build` pass and every R/T requirement is mapped to a test.

---

**Status: Task list generated. Stopping before running anything.**
8 tasks. The generator (Task 5) precedes all property tests that use it (Tasks 6, 7). Tell me to start, and I'll run **Task 1 only** and stop for review. Reorder or adjust before I begin if you'd like.
