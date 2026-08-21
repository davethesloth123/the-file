# AGENTS.md

These instructions apply to the entire repository.

## Branch safety

- Development belongs on the existing `gameplay-overhaul-v0.2` branch.
- Before editing, run `git branch --show-current` and confirm it prints
  `gameplay-overhaul-v0.2`.
- Never develop or commit directly on `main`. If the checkout is on `main`,
  switch to `gameplay-overhaul-v0.2` before making changes.
- Inspect `git status --short` before and after work. Preserve unrelated user
  changes and stage only files that belong to the current task.

## Project context

The File is a third-person stealth game set in Moscow in 1978. Read
`CLAUDE.md` before every task; consult `docs/THE-FILE-bible-v2.md` for detailed
design requirements. Visual work must also follow the authoritative material
in `reference/design/`.

The four code-level design pillars are:

1. Presence is free; only conduct is priced.
2. Suspicion never decays. Only explicit player transactions may reduce it.
3. The game never lies. Detection cones must use the same pose and tuning as
   their rendered representation; intel may be withheld but never falsified.
4. Every exit has a cost; no resolution path may become strictly superior.

## Stack and runtime

- TypeScript in strict mode, built with Vite.
- Three.js/WebGL rendering; plain DOM HUD, no framework.
- Vitest for unit tests.
- npm with the committed `package-lock.json`.
- Use Node 22 (matching CI) or another version satisfying Vite's engine
  requirement (`20.19+` or `22.12+`). Old system Node installations will not
  run this project.
- The current collision implementation is the hand-rolled AABB/surface system
  in `src/world/collision.ts`; Rapier is described as a future replacement,
  not the current runtime.

## Install, run, and verify

From the repository root:

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/the-file/`. The `/the-file/` base path is required
because it matches the GitHub Pages deployment configured in `vite.config.ts`.

Run all existing gates before handing off changes:

```sh
npm test
npm run check:numbers
npm run build
```

Useful visual-test URLs and controls:

- `?lineup` shows the labelled character archetype lineup.
- `?grade=off` disables the post-process grade.
- `?pos=x,z[,y]` overrides the player spawn for interior/interaction checks.
- `?cam=x,y,z,tx,ty,tz` pins a screenshot camera.
- `C` toggles the free inspection camera; `Tab` opens the grade bench.

For visual or gameplay work, load the game in a browser, check the console for
errors and warnings, and verify that models, textures, and audio resolve under
the configured base path.

## Architecture map

- `src/main.ts`: browser composition root, input, scene/UI wiring, and render loop.
- `src/game/`: awaited archetype bootstrap and the render-independent
  `GameSession` fixed-step phases.
- `src/core/`: fixed 60 Hz clock, strings, and audio.
- `src/actors/`: shared actor/animation setup, inertial player state,
  locomotion, reusable NPC routines/attention, and patrol behavior.
- `src/systems/`: conduct, observation, file, confidence, economy,
  interaction, and the JSON-driven branching mission graph.
- `src/world/`: procedural level assembly and collision/ground surfaces.
- `src/render/`: renderer, third-person/free cameras, toon materials, world
  materials, and the post-process grade/ink pass.
- `src/ui/`: HUD, radio messages, and the developer grade bench.
- `src/data/`: all gameplay tuning, map/content definitions, strings,
  archetypes, materials, prices, audio, and mission JSON. `content.ts` is the
  runtime validation/resolution boundary; do not cast raw content into types.
- `public/`: committed runtime GLBs, textures, and WAV files.
- `tools/`: deterministic asset generators; generated outputs are committed.

## Implementation rules

- The simulation must remain fixed at 60 Hz through `FixedClock`; rendering
  interpolates between simulation states.
- Never invent or hardcode a gameplay tuning number in TypeScript. Put tuning
  in the appropriate `src/data/*.json` file. `npm run check:numbers` must pass.
- Missions, NPCs, routes, prices, dialogue, and map layout are data. If new
  content requires TypeScript edits, extend the data schema/system instead of
  hardcoding the instance.
- All player-facing copy must be a key in `src/data/strings.en.json` and read
  through `str(...)`.
- Preserve the null-case test: walking through a patrol cone for 60 seconds
  must leave the file exactly zero.
- Keep changes scoped to one system or ticket. Avoid broad refactors unless a
  task explicitly calls for one.
- Add or update focused tests for simulation and mission logic. Keep gameplay
  tests deterministic and independent of render frame rate.
- Do not regenerate assets casually. When a generator is intentionally run,
  commit and review its output so later sessions do not drift.
- Character limb bones point down `-Y`: forward hip flexion is negative X,
  knee flexion is positive X, and elbow flexion is negative X. Always inspect
  knees after animation changes.
- Do not scale a skinned outline shell independently around the feet; the GLB
  outline geometry is pre-expanded and bound to the same skeleton.

## Definition of done

A change is ready only when its acceptance criteria pass, TypeScript/build and
tests are clean, `npm run check:numbers` passes, the browser console is clean,
and the presence-is-free null case remains green.
