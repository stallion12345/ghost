# Ghostlight: Product and Core Spec

Place this file at `docs/spec.md`. Reference it in Kiro chat when starting each spec so it doesn't have to be pasted. Kiro will turn it into `requirements.md`, `design.md`, and `tasks.md` under `.kiro/specs/`.

## 1. One-liner

A haunted theater where you rehearse your presentations in front of a ghost audience that reacts to how you speak.

## 2. Story (for the pitch and in-app copy)

Every speaker has a ghost: the version of themselves that froze, shook, or went blank. Ghostlight lets you rehearse in front of that ghost until it has nothing left to scare you with. The name comes from the theater tradition of leaving one bulb burning on an empty stage. As you improve, more lights come on.

Ghostlight does not claim to treat anxiety. It gives structured, repeatable practice with feedback.

## 3. Scope

IN: PDF upload and slide display, live rehearsal, ghost audience reactions, candle timer, haunting report, dread dial.
STRETCH: heckler ghosts.
OUT: Present mode, Graveyard, Séance, backend, accounts, audio storage.

## 4. User flow

1. Open the app and read a one-line privacy note.
2. Upload a PDF. Slides render in the theater screen.
3. Press Start. Speak. The ghost audience, candles, and lighting react live.
4. Move through slides by key or click. Each slide has a candle that burns toward a target time.
5. Press Stop. See the haunting report.
6. Repeat. The theater gets brighter as consistency improves across runs.

## 5. Core module (`src/core`): the first spec

This is the first thing we build and test, before any audio or visuals exist.

### 5.1 Inputs

Timestamps are milliseconds since the session started. Core never reads a clock.

```ts
type SpeechEvent =
  | { type: 'words'; t: number; totalWords: number }   // cumulative words spoken so far
  | { type: 'silenceStart'; t: number }
  | { type: 'silenceEnd'; t: number };
```

### 5.2 Config (`src/core/config.ts`)

Starting values. All are tunable and must be exported from one place.

| Setting | Default | Meaning |
| --- | --- | --- |
| `windowMs` | 10000 | rolling window for live WPM |
| `pauseThresholdMs` | 2000 | silence longer than this counts as a pause |
| `steadyMinWpm` | 110 | below this is `slow` |
| `steadyMaxWpm` | 170 | above this is `rushing` |
| `minWindowWords` | 5 | below this, WPM is treated as unknown |

### 5.3 Outputs

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
  percentByState: Record<SpeakingState, number>; // sums to 100
};
```

### 5.4 Behavior rules

- State priority, highest first: `paused`, `rushing`, `slow`, `steady`.
- `paused` means the current silence has lasted longer than `pauseThresholdMs`.
- With too little data (`wpm === null`), state is `steady` unless paused.
- Events may arrive in order only. Out-of-order timestamps are ignored, not thrown.
- An empty session returns a valid zeroed summary. Never NaN, never Infinity.
- Only silences longer than the threshold count toward `pauseCount`.

### 5.5 Property tests (fast-check)

- WPM is never negative, NaN, or Infinity.
- `percentByState` always sums to 100 (within 0.01), for any valid event sequence.
- Pauses never overlap and never have negative length.
- `longestPauseMs` is at least as large as every individual pause.
- `pauseCount` never exceeds the number of `silenceStart` events.
- Feeding the same events twice in a row yields identical output (pure and deterministic).
- Raising `pauseThresholdMs` never increases `pauseCount`.

## 6. Audio layer (`src/audio`), second spec

- Mic volume and silence: Web Audio `AnalyserNode`. Emit `silenceStart` and `silenceEnd`.
- Word count: Web Speech API in Chrome or Edge. Emit `words` events.
- Show a plain debug page first: live volume bar, pause flag, WPM number. No ghosts.
- Test with real voice and accent in week 1. If recognition quality is poor, change approach early.
- Live reactions must not depend on Whisper or any slow transcription.

## 7. Stage layer (`src/stage`), third spec

Ghost reactions map from `SpeakingState`:

| State | Ghost audience |
| --- | --- |
| `steady` | leans in, soft glow |
| `rushing` | drifts apart, flickers |
| `slow` | dims slightly |
| `paused` | goes still |

Reactions must be exaggerated enough to read in a 3-second demo clip.

Other stage elements: candle per slide, ghost light that brightens across sessions, dread dial (Gentle default, Rattled, Nightmare), UI matching the approved mockup but with a project-defense demo slide, not "Q3 Roadmap".

## 8. Haunting report

After each run, show stats as named entities:

- Rushing Wraith: time spent in `rushing`.
- Silence Specter: pause count and longest pause.
- Filler Poltergeist: approximate filler words. Label as approximate.

Keep the tone encouraging. Always end with one concrete suggestion.

## 9. Milestones

| Week | Goal |
| --- | --- |
| 1 | Project runs, steering and spec in place, `core` built and tested, audio debug page working |
| 2 | Stage with live ghost reactions, PDF slides displayed |
| 3 | Candles, haunting report, dread dial, brightening across runs |
| 4 | Polish, demo video, write-up, submission buffer. Heckler ghosts only if everything else is done |

Submission deadline is Dec 4, 2026. Confirm the exact cutoff time and time zone on the official Devpost page.

## 10. Definition of done (for any task)

- `npm test` passes.
- `npm run build` passes.
- The dev server runs and the changed feature is visible or testable.
- No new dependency added without approval.
- No work outside the scope lock.

## 11. Prompt patterns for Kiro

Start a spec:
> Using `docs/spec.md` section 5, create a spec for the core module. Generate requirements first and stop for my review.

Continue:
> Requirements approved. Generate the design and stop for review.

Execute:
> Design approved. Generate tasks. Then run only task 1 and stop.

Fix a bug:
> The state shows `steady` while the pause flag is on. Reproduce it with a failing test first, then fix it.

Check scope:
> Does anything you just built fall outside the scope lock in the steering file? List it.
