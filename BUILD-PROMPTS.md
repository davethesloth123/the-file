# Build prompts — The File
### For Claude Code on the web (claude.ai/code)

---

## Setup, once

**1. Create an empty GitHub repo.** Private is fine. Include a README so it
initialises — cloud sessions clone an existing repo, so it can't be truly empty.

**2. Upload the files through the GitHub web UI** (Add file → Upload files). No
terminal needed. Structure:

```
CLAUDE.md
docs/THE-FILE-bible-v2.md
reference/the-file-mvp.html
reference/character-test.html
reference/design/            <- your design work
tools/character-generator.py
tools/export-glb.py
public/models/sokolov.glb
```

**3. Connect at claude.ai/code.** Sign in, install the Claude GitHub App, grant
access to the repo. Keep the default environment — its trusted network access
reaches npm and PyPI, which is what the build and the Python tools need.

**4. Enable GitHub Pages.** Settings → Pages → Source: **GitHub Actions**.
Session 1 creates the workflow that publishes previews.

---

## How each session goes

Claude works in a cloud VM and pushes a `claude/*` branch. You review the diff,
open the preview URL, and either merge or send corrections into the same session.

Two habits that matter more here than in the terminal:

- **Paste screenshots back.** Claude cannot see the running game. When something
  looks wrong, screenshot the preview and paste it into the session — it accepts
  images directly and it is far more useful than describing the problem.
- **Merge before starting the next session.** Sessions branch from the default
  branch. Starting session 3 before merging session 2 gets you a branch missing
  half the codebase.

---

## Session 1 — Repo, preview pipeline, render

> Set up the project for The File. Read `CLAUDE.md` first, then
> `docs/THE-FILE-bible-v2.md` sections 13–15.
>
> **Do the preview pipeline before anything else.** I work entirely through
> Claude Code on the web and cannot run this locally, so a branch I can't see is
> a branch I can't review. Create `.github/workflows/preview.yml` that runs on
> push to any branch, installs, runs `vite build`, and publishes to GitHub Pages
> with the correct `base` path so assets resolve. Verify the workflow is valid
> before moving on, and tell me the preview URL format to expect.
>
> Then: Vite + TypeScript strict + Three.js. A fixed-60Hz accumulator loop in
> `src/core/clock.ts` — simulation steps at a fixed rate, rendering interpolates.
> This is load-bearing; suspicion accrual must be frame-rate independent.
>
> Then the render pipeline: scene renders to a buffer, split-tone grade shader
> composites to screen, dev-only tuning bench on Tab. Port the grade shader from
> `reference/the-file-mvp.html` exactly — the three tint anchors and the
> luminance-normalisation line are the art direction and must not drift. Drive
> every uniform from `src/data/tuning.json`.
>
> Scene contents: a ground plane and three boxes at different heights, so the
> grade has something to act on. No gameplay.
>
> Push the branch and tell me what to look for in the preview.

---

## Session 2 — Characters

> Read `reference/design/` first — my design work is authoritative on visual
> direction and overrides the bible where they conflict. Then bible section 9.
>
> **Part A — extend the generator.** `tools/character-generator.py` produces one
> body. Parameterise it into archetypes that differ by **silhouette first**,
> since at 5–10m under a three-band ramp and a desaturating grade, silhouette is
> nearly all the player reads:
>
> - `militia` — greatcoat to mid-calf, peaked cap, belt, boots, broad shoulders, upright
> - `civilian_m` — hip-length jacket, flat cap or bare head, varied build
> - `civilian_f` — longer coat, headscarf option, narrower shoulders
> - `civilian_old` — stooped spine, thinner limbs, shorter stride
> - `player` — deliberately unremarkable, mid-range everything
>
> Expose parameters: height, shoulder width, waist, weight, coat length, stoop.
> Emit one GLB per archetype sharing the same 25-bone skeleton and clip set, so
> one animation library drives all of them. **Run the generator in the session and
> commit the GLBs to `public/models/`** — later sessions must not regenerate them.
>
> **Greatcoat warning:** a mid-calf hem rigid to the hips will have thighs punch
> through it at full stride. Weight the lower hem partly to the `UpLeg` bones so
> it swings, and verify at jog speed.
>
> **Part B — gait differentiation.** Per-archetype variants of the walk clip from
> the existing gait parameters: militia slower and stiffer with less arm swing,
> civilians faster with more bob, elderly shorter stride and more stoop. Cheap,
> and it is the most readable difference between a patrol and a passer-by at
> distance.
>
> **Part C — runtime.** `src/actors/actor.ts` loads a GLB, swaps materials to
> `MeshToonMaterial` preserving skinning, builds the normal-pushed outline shell
> (see the trap in `CLAUDE.md`), attaches a mixer. `src/actors/locomotion.ts`
> blends idle→walk→jog with `timeScale = clamp(speed / naturalSpeed, 0.6, 1.75)`,
> `naturalSpeed` from `tuning.json`.
>
> Put eight characters of mixed archetypes in the preview scene, walking loops at
> varied speeds, so I can check silhouettes and foot-slide. Add a `?grade=off`
> URL flag so I can inspect them ungraded.
>
> Acceptance: no foot sliding at any velocity; knees flex backward in every clip;
> each archetype identifiable by silhouette alone with colour removed.

---

## Session 3 — World and materials

> Read `reference/design/` and bible sections 3 and 8.
>
> **Materials first.** Everything is flat toon colour. Because the ramp quantises
> lighting into three hard bands, texture carries *more* surface information here
> than in a PBR pipeline, not less — but only the right kind. Fine detail dies in
> the grade. What survives is **low-frequency value variation**: damp patches,
> staining below windows, plaster repairs, tonal drift across a facade.
>
> Write `tools/texture-generator.py` producing tiling 512² albedo + grime maps
> for weathered stucco, poured concrete, wet asphalt, brick, painted render,
> rusted metal. Value-based rather than hue-based — the grade strips most hue
> anyway. Triplanar sampling so nothing needs UV authoring. **Run it and commit
> the PNGs to `public/textures/`.** Watch the 25MB download budget.
>
> **Then a modular kit.** Facade panels, window bays, ground-floor entrances,
> cornices, roof furniture, balconies, drainpipes. Assemble buildings from the kit
> at load time, driven by `src/data/map.zamostye.json`. Street furniture: tram
> tracks and overhead wires, lamp posts, kiosks, benches, bins, notice boards,
> bare October trees.
>
> Colliders and gameplay volumes come from JSON, never from mesh names.
>
> Add a free-fly camera on `C` so I can inspect the district in the preview.
>
> Acceptance: reads as a place, not a tile set; no two buildings on the avenue
> identical; 60fps at 1080p on integrated graphics. Report triangle and draw call
> counts in the PR — I can't profile this myself.

---

## Session 4 — Patrols, conduct, observation

> Bible sections 5.1, 5.2, 17.
>
> **Write the null-case test before any implementation:** walk through a patrol
> cone for sixty seconds, assert the file is exactly zero. Wire it into CI so the
> preview workflow fails if it ever breaks.
>
> `src/systems/conduct.ts` — one exported function, world state in,
> `{rule, rate, label} | null` out. Rules from `src/data/conduct.json`, evaluated
> in array order, first match wins and reports its own label. Only one conduct is
> ever active.
>
> `src/systems/observation.ts` — cones, range, FOV, LOS raycast against geometry.
> The cone used for detection and the cone drawn on screen must derive from the
> same source. There must be no code path where they can disagree.
>
> Patrols on waypoint beats with an alert FSM. **A patrol breaks its beat only
> when conduct is active AND it can see the player.** Walking past does nothing.
>
> HUD conduct banner: the specific reason and the observer count, visible whenever
> conduct is active.
>
> Add a `?debug=cones` flag forcing all cones visible regardless of intel, so I
> can verify the drawn cone matches the detection cone.

---

## Session 5 — Meters, interaction, first playable level

> Bible sections 5.3, 5.4, 5.7, 7.1, 20.
>
> `src/systems/file.ts` and `confidence.ts` — accrual, tiers, the five-second
> clean-work confidence recovery. Confidence gates *cone visibility*, never cone
> accuracy.
>
> `src/systems/interaction.ts` — proximity prompts, hold-to-act with progress.
> `src/systems/mission.ts` — objectives from JSON, closed type set: `reach`,
> `hold_at`, `talk_to`, `deliver`, `wait_until`.
>
> Then build **"Ordinary Traffic"** as `src/data/missions/ordinary_traffic.json`
> — the tutorial from bible §7.1. Its design job is one lesson: place a patrol so
> the walking route passes directly through its cone, unavoidably, twice, and
> nothing happens. Then the drop at 14/sec while observed, with the patrol forty
> seconds away on its beat. The tutorial for this game is a tutorial in standing
> still.
>
> No onboarding text. If a player can't work it out, that's level design failing,
> not a missing tooltip.
>
> Acceptance: eight minutes of play, start to exit, with no explanation from you.
> This is the build I show people, so the preview must work on a stranger's laptop
> from a cold load.

---

## Session 6 — Economy and the three doors

> Bible sections 5.5, 5.7, 7.5.
>
> Money, Grigori's repeatable courier loop with the ×1.9 contraband multiplier,
> the records clerk (₽130 → −40 file, no confidence cost), and the militia station
> where a name can be given.
>
> **Vera is the point of this session.** Approaching her gives free patrol intel
> that slows every militia beat by 16%. Naming her at the station drops the file
> 45 and confidence 38, removes her from the world permanently, and reverts the
> speed advantage. The cost must be felt mechanically on every subsequent run, not
> shown as a number.
>
> Acceptance: all three doors reachable, none strictly better than the others.

---

## Session 7 — Art pass and instrumentation

> Grade tuning against the real characters and environment. Outline weight. Camera
> feel. Footsteps and ambience — and no detection stinger, ever; the state does
> not announce itself.
>
> Instrument the playtest metric: **time from level start until the player first
> walks through a patrol cone without changing speed.** Log it to console and to
> `localStorage` so I can collect it from testers.
>
> Under three minutes means the design works. Still hugging walls at minute eight
> means the conduct readout has failed and nothing downstream matters.

---

## If the preview breaks

The Action is the only way you see anything, so treat it as critical path. Common
causes in order: wrong Vite `base` path for a project Pages site; assets
referenced absolutely rather than relatively; the workflow missing `pages: write`
permission; Pages source set to "Deploy from a branch" instead of "GitHub Actions".

Paste the failing Action log into the session. Claude can read it and fix the
workflow on the same branch.

---

## Where Claude Design fits

GitHub is the shared substrate. Claude Design imports from a GitHub repo, and
Claude Code works from one — so point Design at the same repo rather than
uploading anything twice.

Design's useful scope here is the **HUD** (it's plain DOM, which is exactly what
Design is for) and a **pitch one-pager** later, once you have screenshots from a
working build. It will not build the game.

The `claude mcp add` command in Anthropic's docs is for the terminal CLI. From
the browser, the practical loop is: design in Claude Design → export → commit to
`reference/design/` → point a Code session at it.
