# Ghostlight: Rules for Cline

Place this file at `.clinerules/ghostlight.md` in the repo root. Cline loads it automatically. The long product detail is in `docs/spec.md`, and the active spec is in `.kiro/specs/core/`. Treat those files as the source of truth.

## Read first, every new session

1. `docs/spec.md`
2. `.kiro/specs/core/requirements.md`
3. `.kiro/specs/core/design.md`
4. `.kiro/specs/core/tasks.md`

If a rule here conflicts with those files, stop and ask me. Do not choose silently.

## What this project is

Ghostlight is a haunted-theater web app. A speaker uploads slides, rehearses out loud, and a ghost audience reacts to their pace and pauses in real time. After each run they get a "haunting report". It is a Kiroween hackathon entry (Costume Contest category). Design is 20% of the score.

Audience: students, job candidates, first-time speakers.

## Scope lock

IN: PDF upload and slide rendering, live rehearsal, ghost audience reacting to pace and pauses, candle timer, haunting report, Gentle/Rattled/Nightmare dread dial.

STRETCH (only when I explicitly ask): heckler ghosts.

OUT (never build, scaffold, or suggest): Present mode, Graveyard, Séance onboarding, Supabase or any backend, user accounts, audio storage.

If a request seems to need something OUT, stop and ask.

## How to work

- Use Plan mode first. Describe what you will change and which files, then wait for my approval before acting.
- Do one task from `.kiro/specs/core/tasks.md` at a time. Stop after each task so I can review.
- Do not start the next task until I say so.
- When a task is done, tick its checkbox in `tasks.md` and nothing else in `.kiro/`.
- Do not edit `requirements.md`, `design.md`, or `docs/spec.md` unless I ask. If you think one is wrong, tell me and explain.
- When unsure, ask one specific question instead of guessing.
- Never mark a task done while `npm test`, `npm run build`, or `npm run lint` fails.

## Gates (run all three after every task and report the results)

```powershell
npm test
npm run build
npm run lint
```

Report the real output summary, not "it passed". Include the test count.

## Architecture boundaries

- `src/core/`: pure TypeScript logic. No DOM, no browser APIs, no React, no timers, no `Date`, no `performance`, no `Math.random`. Time arrives as data. Functions never mutate their inputs.
- `src/audio/`: wraps Web Audio (`AnalyserNode`) and the Web Speech API. Converts browser signals into plain events for `core`. No game logic here.
- `src/stage/`: React components, canvas, SVG, CSS. Reads state from `core`. Never computes pace, pauses, or scores itself.
- `src/pdf/`: renders PDF pages to images. Nothing else.
- All tunable numbers live in `src/core/config.ts`. Never hardcode thresholds elsewhere.
- Haunted names (Rushing Wraith, Silence Specter, Filler Poltergeist) belong only in `stage` and report copy, never in `core` types.

## Code conventions

- TypeScript strict mode is on. No `any`. No non-null assertions without a comment explaining why.
- No semicolons, single quotes, 2-space indent.
- Extensionless relative imports.
- `verbatimModuleSyntax` is on: use `import type` for type-only imports and `export type` for type re-exports.
- `erasableSyntaxOnly` is on: use string unions, never `enum`.
- Small files, one responsibility each.

## Testing

- Vitest for unit tests, `fast-check` for property tests.
- Import `describe`, `it`, `expect` explicitly from `vitest`. Vitest globals are off. Do not enable them.
- Every function in `core` gets at least one property test (in the property-test tasks).
- Do not weaken, skip, or delete a test to make it pass. If a test seems wrong, tell me why first.
- Tests assert invariants, not exact percentages that depend on sampling details.

## Do not change without asking me first

- `package.json` (except the `test` script, if I say so)
- Any `tsconfig*.json`, `vite.config.ts`, `eslint.config.js`
- Any dependency, including adding or upgrading a package
- Anything outside `src/` and the spec files above

Current dependencies: React, React DOM, Vite, TypeScript (pinned to ~5.9.3), ESLint, Vitest, `fast-check`. `pdfjs-dist` is NOT installed yet and must not be installed until I ask.

## Environment (Windows, PowerShell)

- Use PowerShell syntax. No `mkdir -p`, no `rm -rf`, no `&&` chaining assumptions. Run commands one at a time.
- My network is slow and sometimes intercepted. If a command seems stuck, wait and tell me. Do not cancel an `npm install` partway, because that corrupts `node_modules`.
- If `npm` fails with a certificate error, the fix is `$env:NODE_OPTIONS="--use-system-ca"`. Never run `npm config set strict-ssl false`.
- Never use `--force` or `--legacy-peer-deps`. If there is a dependency conflict, show me the first lines of the error and stop.
- Do not touch `C:\Users\INEWTON\package.json` or anything outside this repo folder.
- Do not delete `node_modules` or `package-lock.json` unless I ask.

## Git

- Do not run `git commit` or `git push`. I commit myself after reviewing.
- Never rewrite history. Never commit `node_modules` or `dist`.
- The `.kiro/` folder must stay committed. It is hackathon evidence. Never add it to `.gitignore`.

## Privacy and honesty

- Never store audio. There is no backend.
- The Chrome Web Speech API sends audio to a cloud service. The UI must say so in one plain sentence.
- Never claim Ghostlight treats or reduces anxiety. Say it gives structured, repeatable practice with feedback.
- Filler-word counts are approximate. Label them that way in the UI.

## Tone of user-facing copy

Spooky but kind. Supportive, never mocking. Default dread level is Gentle. Text must have high contrast, and nothing important may be conveyed by color or animation alone.

## After each task, report in this format

- Files created or changed (full paths)
- Test, build, and lint results (counts and any warnings)
- Anything you skipped, stubbed, or were unsure about
- Anything that touched a file on the "do not change" list (should be none)

## Current state (update this section as we go)

- Task 1 (config, types, barrel, smoke test): done.
- Task 2 (session and ingest, 12 tests): done. Strict mode enabled in both tsconfig files.
- Pending additions to Task 2, do these before Task 3:
  - Test that a `words` event during an open silence does not close it, and a `words` event with no open silence does not open one (R25).
  - Test that `NaN`, `Infinity`, or negative `t`, and `NaN` or non-integer `totalWords`, are ignored without throwing.
  - Test that an ignored event (out-of-order, decreasing `totalWords`, invalid) does not change `lastT`.
- Task 3 (snapshot) requirements:
  - The snapshot at `t` uses only events at or before `t`, because summary sampling will ask about past times.
  - Closed silence intervals must be available for past `t`. Confirm session state stores them.
  - The pause rule is strictly longer than `pauseThresholdMs`. Test at exactly the threshold and one millisecond over.
  - WPM returns `null`, never `Infinity` or `NaN`, at `t = 0` or when elapsed time is zero.
  - With equal-timestamp milestones, the lookup returns the last milestone at or before the window start.
- Tasks 4 to 8: as listed in `tasks.md`.

## Current state (update this section as we go)

- Tasks 1 to 4 are done: config, types, session/ingest, snapshot, summary. 41 tests pass. Strict mode is on. `minElapsedMs` (3000) exists in config.
- Pending Task 4 revisions, do these first and stop:
  1. Change `percentByState` sampling to start at `firstT` (not 0): samples at `firstT`, every `sampleStepMs`, and always `endT`. If there are no events it stays all-zeros. Update requirements, design, and tests.
  2. Add a directional test: 30 s of steady speech followed by 10 s of silence gives `paused > 0`; a longer pause gives a larger `paused` than a shorter one. No exact percentages.
  3. Confirm `percentByState` gets each sample's state from the same `speakingStateAt` function that `liveSnapshot` uses, not a separate copy of the rules. Show me the line.
  4. Add a design note: the first `minElapsedMs` of a session has `null` WPM and counts as `steady`, as a known limitation.
- Task 5 (fast-check generators), after I approve the Task 4 revisions:
  - Valid generator: non-decreasing timestamps, non-decreasing integer `totalWords`, alternating silence start and end, sometimes ending with an open silence. Bound sizes so tests stay fast.
  - Dirty generator: out-of-order timestamps, decreasing `totalWords`, `NaN`, `Infinity`, negative `t`, duplicate `silenceStart`, stray `silenceEnd`.
  - The generators get their own tests that verify valid output really is valid and dirty output really contains bad events.
  - One property: ingesting a dirty event leaves state unchanged.
  - No new dependencies.
- Tasks 6 and 7 (property tests): if a property fails and fast-check shrinks to a counterexample, report it to me. Do not weaken, narrow, or delete the property to make it pass.
- Task 8: coverage audit, as listed in `tasks.md`.