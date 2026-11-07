# Ghostlight: Standing Instructions for Kiro

Place this file at `.kiro/steering/instructions.md`. It is loaded into every Kiro session, so keep it short and stable. The long product detail lives in `docs/spec.md`.

## What this project is

Ghostlight is a haunted-theater web app. A speaker uploads slides, rehearses out loud, and a ghost audience reacts to their pace and pauses in real time. After each run they get a "haunting report". It is built for the Kiroween hackathon (Costume Contest category). Design is 20% of the score, so visual polish matters as much as logic.

Audience: students, job candidates, first-time speakers.

## Scope lock (do not build anything outside this list)

IN: PDF upload and slide rendering, live rehearsal, ghost audience reacting to pace and pauses, candle timer, haunting report, Gentle/Rattled/Nightmare dread dial.

STRETCH (only when I explicitly ask): heckler ghosts (LLM Q&A).

OUT (never build, never scaffold, never suggest): Present mode, Graveyard, Séance onboarding, Supabase or any backend, user accounts, audio storage.

If a request seems to need something OUT, stop and ask me.

## Architecture boundaries

- `src/core/`: pure TypeScript logic. No DOM, no browser APIs, no React, no timers. Time comes in as data. Fully unit and property tested.
- `src/audio/`: wraps Web Audio (`AnalyserNode`) and the Web Speech API. Converts browser signals into plain events and feeds them to `core`. No game logic here.
- `src/stage/`: React components, canvas, SVG, CSS. Reads state from `core`. Never computes pace, pauses, or scores itself.
- `src/pdf/`: renders PDF pages to images with `pdfjs-dist`. Nothing else.
- All tunable numbers (thresholds, window sizes) live in `src/core/config.ts`. Never hardcode them elsewhere.

## Code conventions

- TypeScript strict mode. No `any`. No non-null assertions without a comment explaining why.
- Functional style in `core`: pure functions, immutable inputs and outputs.
- Small files. One responsibility per module.
- Name things in plain English. The haunted names (Rushing Wraith, Silence Specter, Filler Poltergeist) belong in `stage` and report copy only, never in `core` types.

## Testing

- Vitest for unit tests, `fast-check` for property-based tests.
- Every function in `core` gets at least one property test.
- Run `npm test` after every task. Do not mark a task done while tests fail.
- Do not weaken or delete a test to make it pass. If a test seems wrong, tell me why.

## Privacy and honesty

- Never store audio. Never send audio or transcripts to our own server (there is none).
- The browser Web Speech API in Chrome sends audio to a cloud service. The UI must say so in one plain sentence.
- Never claim Ghostlight treats or reduces anxiety. Say it gives structured, repeatable practice with feedback.
- Filler-word counts are approximate. Label them that way in the UI.

## Tone of all user-facing copy

Spooky but kind. Supportive, never mocking. Default dread level is Gentle. Text must have high contrast, and nothing important may be conveyed by color or animation alone.

## How we work

1. One spec at a time. Generate requirements, then design, then tasks.
2. I read and approve each stage before you move on. Do not skip ahead.
3. Work one task at a time and stop after each so I can review and commit.
4. Never edit `.kiro/` files, `package.json`, or config files unless the task needs it, and tell me when you do.
5. Keep the dev server working. If you break the build, fix it before doing anything else.
6. When unsure, ask one specific question instead of guessing.

## Things to avoid

- Adding libraries without asking. Current dependencies: React, Vite, `pdfjs-dist`, Vitest, `fast-check`.
- Large rewrites of working code.
- Placeholder logic that looks finished but isn't. If something is stubbed, say so in the code and in your reply.
- Decorative features that don't serve the rehearsal experience.
