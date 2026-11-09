# Core Module (`src/core`) — Requirements

Source: `.kiro/specs/spec.md` section 5 (the product spec mistakenly calls itself `docs/spec.md`).
Stage: **Requirements** (rev 2 approved; rev 3 adds `minElapsedMs` per review). Design and tasks follow.

## 1. Purpose

`src/core` is the pure-logic engine of Ghostlight. It turns a stream of speech events — timestamps plus cumulative word counts and silence markers — into a live snapshot of how the speaker is doing, and into a final session summary. It is the first thing built and tested, before any audio capture or visuals exist.

The module is deliberately decoupled from the browser: it never reads a clock, touches the DOM, uses React, sets timers, or calls any Web API. Time arrives as data (milliseconds since session start). This makes it fully unit- and property-testable without a browser.

## 2. Scope

**In scope for this spec**
- Ingesting an ordered stream of `SpeechEvent`s.
- Computing live WPM over a rolling window (with early-session fallback).
- Deriving a `SpeakingState` from WPM and silences.
- Producing a `LiveSnapshot` at any point and a `SessionSummary` at the end (with an `endT`).
- One config module exporting all tunable thresholds.
- Unit tests and property-based tests.

**Out of scope (do not build here)**
- Mic capture, silence detection, word counting (those live in `src/audio`, second spec).
- Ghost visuals, candles, report rendering (those live in `src/stage`, third spec).
- PDF rendering (`src/pdf`).
- Any persistence, backend, accounts, or audio storage.
- Filler-word detection (report concern; approximate labeling handled in stage/report).

## 3. Data contract

### 3.1 Inputs — `SpeechEvent`

A discriminated union. Timestamps `t` are milliseconds since the session started.

```ts
type SpeechEvent =
  | { type: 'words'; t: number; totalWords: number }   // cumulative words spoken so far
  | { type: 'silenceStart'; t: number }
  | { type: 'silenceEnd'; t: number };
```

Notes:
- `totalWords` is **cumulative** and monotonically non-decreasing across `words` events (see R24 for what happens if it decreases).
- A `silenceStart`/`silenceEnd` pair brackets one silence interval. Silence is driven only by these events — never by `words` events (see R25).

### 3.2 Config — `src/core/config.ts`

All tunable numbers live here and are exported from one place. No thresholds are hardcoded elsewhere. Starting defaults:

| Setting | Default | Meaning |
| --- | --- | --- |
| `windowMs` | 10000 | rolling window length for live WPM |
| `pauseThresholdMs` | 2000 | a silence longer than this counts as a pause |
| `steadyMinWpm` | 110 | below this, speaking is `slow` |
| `steadyMaxWpm` | 170 | above this, speaking is `rushing` |
| `minWindowWords` | 5 | below this word count in the window, WPM is treated as unknown |
| `minElapsedMs` | 3000 | minimum elapsed window (ms) before WPM is reported; below this WPM is `null` (R5/D8) |

### 3.3 Outputs

```ts
type SpeakingState = 'steady' | 'rushing' | 'slow' | 'paused';

type LiveSnapshot = {
  t: number;
  wpm: number | null;       // null when there is not enough data yet
  state: SpeakingState;
};

type SessionSummary = {
  durationMs: number;
  totalWords: number;
  averageWpm: number;
  pauseCount: number;
  longestPauseMs: number;
  percentByState: Record<SpeakingState, number>; // sums to 100 when durationMs > 0; all zeros when 0
};
```

The haunted names (Rushing Wraith, Silence Specter, Filler Poltergeist) belong in `src/stage` and report copy only. They must never appear in `core` types or function names.

## 4. Functional requirements

Each requirement has an ID so design and tasks can reference it.

### Events & ordering
- **R1** — Core accepts a sequence of `SpeechEvent`s and processes them in arrival order.
- **R2** — Events are expected to arrive in non-decreasing timestamp order. An event whose `t` is less than that of an already-processed event (out-of-order) is **ignored**, not thrown. Ignoring must not corrupt internal state or later computations.
- **R3** — Feeding the exact same event sequence twice yields identical output (pure and deterministic). No hidden mutable global state affects results.
- **R24** — A `words` event whose `totalWords` is less than the largest `totalWords` seen so far (a decreasing word count) is **ignored**. It does not corrupt state or affect any output. (Ties — equal to the prior max — are accepted as no-progress.)

### Silence is event-driven
- **R25** — Silence is driven only by `silenceStart`/`silenceEnd` events. A `words` event never starts a silence, never ends a silence, and never resets the silence timer. Words arriving during a silence do not change the silence state.
- **R26** — A `silenceStart` received while a silence is already in progress is **ignored**. A `silenceEnd` received when no silence is in progress is **ignored**. (Keeps pauses non-overlapping; see R20.)

### Live snapshot
- **R4** — At any point, core can produce a `LiveSnapshot` for the most recently processed time `t`.
- **R5** — `wpm` is computed from the words spoken within the trailing `windowMs` window, using cumulative `totalWords`. Early in the session, when elapsed time since the first event is less than `windowMs`, the window is the **elapsed time so far** rather than the full `windowMs` (the window is clamped to session start). `wpm` is `null` until the window/elapsed duration is at least `minElapsedMs` **and** at least `minWindowWords` words have been spoken within it. Elapsed time is measured from `firstT` (the first accepted event's time), not a fixed session start of 0. At exactly `minElapsedMs`, WPM computes normally.
- **R6** — `wpm` is never negative, `NaN`, or `Infinity`. Division-by-zero and empty-window cases yield `null`, never a bad number.
- **R7** — `state` is derived by priority, highest first: `paused` → `rushing` → `slow` → `steady`. The first matching rule wins.
- **R8** — `paused` holds when there is an open silence (a `silenceStart` with no matching `silenceEnd` yet, per R25/R26) and, as of `t`, it has lasted longer than `pauseThresholdMs`.
- **R9** — When data is insufficient (`wpm === null`) and not paused, `state` is `steady`.

### State classification from WPM
- **R10** — When `wpm` is known (not null): above `steadyMaxWpm` ⇒ `rushing`; below `steadyMinWpm` ⇒ `slow`; otherwise ⇒ `steady`. `paused` still overrides these per R7/R8.

### Session summary
- **R11** — A `SessionSummary` can be produced at the end of a session. The summary function accepts an optional `endT` argument. The app always passes `endT`; if omitted (tests only), it defaults to the last event's `t`.
- **R27** — `endT` is **clamped** to be no earlier than the last event's `t`: `endT = max(endT, lastEventT)`. This prevents a final in-progress pause from being truncated and keeps the summary stable for any `endT` ≥ last event.
- **R12** — `durationMs` is the elapsed time from the first event's `t` to the (clamped) `endT`. It is `0` for an empty session and never negative.
- **R13** — `averageWpm = totalWords / (durationMs / 60000)`, computed over the **full duration with pauses included** (i.e., `durationMs` is total elapsed time, silence and all — pauses are not subtracted). Guarded so it is never `NaN`/`Infinity`; an empty or zero-duration session yields `0`.
- **R14** — `pauseCount` counts only silences whose length exceeds `pauseThresholdMs`. A silence still in progress at `endT` counts if it has already exceeded the threshold (evaluated at the clamped `endT`).
- **R15** — `longestPauseMs` is the maximum length among counted pauses, or `0` if there were none. It is at least as large as every individual pause.
- **R16** — `percentByState` distributes session time across the four `SpeakingState`s as percentages that **sum to 100 (within 0.01) when `durationMs > 0`**. When `durationMs === 0`, all four values are `0`. Each key is always present in the record.
- **R17** — An empty session (no events) returns a valid, fully zeroed summary: `durationMs: 0`, `totalWords: 0`, `averageWpm: 0`, `pauseCount: 0`, `longestPauseMs: 0`, and `percentByState` all zeros (`steady: 0`, `rushing: 0`, `slow: 0`, `paused: 0`). Consistent with R16's `durationMs === 0` rule.
- **R18** — Outputs never contain `NaN` or `Infinity` for any valid (including empty) input.
- **R19** — `pauseCount` never exceeds the number of `silenceStart` events received (ignoring the ones dropped by R26).
- **R20** — Pauses never overlap and never have negative length. Redundant/stray silence events are ignored per R26 rather than creating overlapping pauses.

### Config
- **R21** — Every tunable threshold is exported from `src/core/config.ts` and only from there. Behavior modules read config, they do not redefine numbers.
- **R22** — Raising `pauseThresholdMs` never increases `pauseCount` for the same event sequence (monotonic relationship).
- **R23** — Config values are plain data and can be overridden for tests without mutating a shared global (purity per R3).

## 5. Architecture constraints (non-functional)

- **C1** — `src/core` is pure TypeScript only. No DOM access, no browser APIs, no React, no timers, no `Date.now()`/`performance.now()`, no network. Time enters only as data.
- **C2** — Functional style: pure functions, immutable inputs and outputs. Inputs are not mutated.
- **C3** — TypeScript strict mode. No `any`. Non-null assertions require a comment explaining why.
- **C4** — Small files, one responsibility per module.
- **C5** — Plain-English names in types and functions. Haunted names stay out of `core`.
- **C6** — No new dependencies beyond what's installed (React, Vite, `vitest`, `fast-check`). `pdfjs-dist` is not needed for core and must not be added here.

## 6. Testing requirements

- **T1** — Unit tests with Vitest for every public function.
- **T2** — Property-based tests with `fast-check` for every public function in `core`, at minimum these invariants:
  - WPM is never negative, `NaN`, or `Infinity` (R6).
  - `percentByState` sums to 100 (within 0.01) **when `durationMs > 0`**, and is **all zeros when `durationMs === 0`** (R16).
  - Pauses never overlap and never have negative length (R20/R26).
  - `longestPauseMs` ≥ every individual pause (R15).
  - `pauseCount` ≤ number of `silenceStart` events (R19).
  - Feeding the same events twice yields identical output (R3).
  - Raising `pauseThresholdMs` never increases `pauseCount` (R22).
  - A `words` event never starts, ends, or resets a silence (R25).
  - A `words` event with decreasing `totalWords` is ignored and changes no output (R24).
  - Early-session `wpm` is `null` until the elapsed window is at least `minElapsedMs` **and** at least `minWindowWords` words are in the window (R5).
  - `endT` is clamped to ≥ last event `t`; the summary is stable for any `endT` ≥ last event (R27).
- **T3** — Tests do not depend on a browser, clock, or audio.
- **T4** — Tests are not weakened or deleted to make code pass. If a test seems wrong, the reason is reported rather than the test being silently changed.

## 7. Acceptance criteria (definition of done for this spec)

- **A1** — `npm test` passes (all unit + property tests green).
- **A2** — `npm run build` passes (no type errors under strict mode).
- **A3** — `src/core` imports nothing from `src/audio`, `src/stage`, `src/pdf`, or any DOM/React/browser API (verifiable by import inspection).
- **A4** — No new dependency added.
- **A5** — All R-requirements and T-requirements are covered by at least one test; every property invariant in T2 has a dedicated property test.

## 8. Resolved decisions (from review)

Recorded for traceability so design and tasks can reference them.

- **D1 (from Q1)** — `percentByState` sums to 100 when `durationMs > 0`; all four states are `0` when `durationMs === 0`. Baked into R16, R17; property test updated in T2.
- **D2 (from Q2)** — A `silenceStart` while already silent is ignored; a `silenceEnd` with no open silence is ignored. Baked into R26, R20.
- **D3 (from Q3)** — Summary takes `endT`; the app always passes it; if omitted (tests only) it defaults to the last event's `t`; `endT` is clamped to be no earlier than the last event's `t`. Baked into R11, R27, R12.
- **D4 (new a)** — Silence is driven only by silence events, never by `words` events. Baked into R25; covered by T2.
- **D5 (new b)** — A decreasing `totalWords` is ignored. Baked into R24; covered by T2.
- **D6 (new c)** — Early-session WPM uses elapsed time instead of the full window, and is `null` until `minWindowWords` is reached. Baked into R5; covered by T2.
- **D7 (new d)** — `averageWpm` is `totalWords` divided by total duration in minutes, with pauses included. Baked into R13.
- **D8 (added in rev 3)** — `minElapsedMs` (default 3000) added to `config.ts`: `wpmAt` returns `null` when the elapsed window is `< minElapsedMs` (so exactly equal computes). Prevents sub-`minElapsedMs` early-session WPM spikes (a few words in < 3000 ms inflating to hundreds of WPM). Baked into R5 and the config table.

## 9. Remaining open questions

None.

---

**Status: Requirements updated to rev 3 (rev 2 was approved; rev 3 adds `minElapsedMs` per review).**
