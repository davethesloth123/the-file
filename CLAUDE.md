# CLAUDE.md

Project context for **The File** — a third-person stealth game, Moscow 1978.
Read this before every task. Full design detail is in `docs/THE-FILE-bible-v2.md`.

---

## What this is

The player is a Soviet civilian running errands for the CIA. The state is not
hunting him — it watches everyone and writes it down. Walking past a patrol is
free. Only *conduct* is priced. Suspicion never decays.

There is no combat, no chase, no weapon. Arrest is the fail state and it happens
quietly.

---

## The four pillars

These govern code decisions, not just design ones.

1. **Presence is free. Conduct is priced.** A patrol that reacts to a man walking
   is a bug, not a tuning problem.
2. **Nothing is ever taken out of the file.** Suspicion has no decay path. Only
   explicit player transactions reduce it.
3. **The game never lies.** Cones are always in the true position, facing the true
   direction, at the true range. Intel may be *withheld*; it is never *wrong*. Any
   render path that could draw a cone somewhere other than where detection
   happens is a bug regardless of appearance.
4. **Every exit costs somebody.** No free outs. If a change makes one of the three
   doors strictly better, the change is wrong.

---

## Hard rules

- **Never invent a tuning number.** Every gameplay constant lives in `data/*.json`.
  If a value is needed and absent, stop and ask. `grep -r "4\.2" src/` must return
  nothing.
- **Never hardcode content.** Missions, NPCs, prices, dialogue, map layout are
  data. If adding content requires editing `.ts`, the schema is wrong — fix the
  schema, don't add the content.
- **Fixed 60Hz simulation step** with an accumulator; rendering interpolates.
  Suspicion accrual must be byte-identical at 30fps and 144fps.
- **One system per session.** Don't range across the ticket list.
- **Strings are keys from day one** (`handler.brief.ordinary_traffic`), even though
  only English exists.

---

## Known traps

Both of these were hit during prototyping. Don't rediscover them.

### Bone rotation signs

Limb bones point **downward** (−Y). Therefore:

```
hip flexion   (leg swings forward)  = NEGATIVE X rotation
knee flexion  (heel toward buttock) = POSITIVE X rotation
elbow flexion (hand comes up)       = NEGATIVE X rotation
```

Verify: a point at local `(0,-1,0)` rotated `+30°` about X lands at `z=-0.5`
(backward) — correct knee flexion. The first rig had every knee hyperextending.
Hips inverted are easy to miss because a flipped sine is just a phase shift;
**always check the knees**.

### Outlines on skinned meshes

Scaling a `SkinnedMesh` scales about the mesh origin at the feet, so the outline
grows upward and floats off the ground. Instead, clone the geometry, push each
vertex along its own normal at load, and bind the shell to the *same skeleton*:

```ts
const SHELL = BODY.clone();
const p = SHELL.attributes.position, n = SHELL.attributes.normal, T = 0.016;
for (let i = 0; i < p.count; i++)
  p.setXYZ(i, p.getX(i)+n.getX(i)*T, p.getY(i)+n.getY(i)*T, p.getZ(i)+n.getZ(i)*T);
shell.bind(mesh.skeleton, mesh.bindMatrix);
```

(Post-process depth+normal edge pass is the ship-quality answer. Shell is fine now.)

---

## Working environment

This project is built through **Claude Code on the web**. There is no local
machine. Sessions run in a cloud VM, work is pushed to a `claude/*` branch, and
the human reviews a PR.

Consequences that affect how you work:

- **The human cannot run the game.** Every branch must deploy to a live preview
  URL via the GitHub Action in `.github/workflows/preview.yml`. If that Action is
  red, the session produced nothing reviewable — fixing it takes priority over
  any feature work.
- **You cannot see the result either.** For anything visual, state plainly what
  you expect it to look like so the human can check, and ask for a screenshot
  back rather than assuming.
- **Commit assets, don't generate them per-session.** Anything produced by
  `tools/*.py` gets committed as output (GLB, textures) so later sessions don't
  regenerate it and drift.
- **Keep PRs to one system.** A PR spanning four systems cannot be reviewed by
  one person reading a diff in a browser.

## Stack

Three.js (current) · TypeScript strict · Vite · Rapier for collision · plain DOM
for HUD. No React.

Conventions: Y-up, right-handed, **1 unit = 1 metre**, +Z is north. Radians
internally, degrees only in JSON.

---

## Repo shape

```
src/
  core/     clock (fixed step), input, events
  render/   renderer, toonify, outline, grade, camera
  world/    level, collision, nav
  actors/   actor, locomotion, player, patrol, civilian, npc
  systems/  conduct, observation, file, confidence, economy, interaction, mission
  ui/       hud, prompt, radio, bench
  data/     tuning.json, conduct.json, prices.json, map.*.json, missions/, npcs/
tools/      character-generator.py, texture-generator.py, export-glb.py
docs/       THE-FILE-bible-v2.md
reference/  the-file-mvp.html, character-test.html, design/
public/     models/, textures/, audio/
```

---

## Reference material

- `reference/the-file-mvp.html` — working prototype. **Behavioural reference, not
  architecture.** It is variable-timestep with no data layer and pins an old
  Three.js. Don't copy its structure. When the rewrite disagrees with it about how
  something *feels*, the prototype is usually right.
- `reference/character-test.html` — rig inspector, all clips, skeleton overlay.
- `reference/design/` — the human's own design work. **This is authoritative on
  visual direction and overrides the bible where they conflict.** Read it before
  any art or UI task.
- `tools/character-generator.py` — procedural humanoid, 2078 tris, 25 bones,
  Mixamo-compatible bone names.

---

## Art direction, compressed

Cel shading on a hard three-band toon ramp, over a split-tone grade. The three
anchors are the identity:

```glsl
T_SHADOW (0.38, 0.41, 0.43)   cool grey-green
T_MID    (0.73, 0.63, 0.44)   khaki
T_HIGH   (1.02, 0.93, 0.72)   warm cream
```

`toned = desat * tint / max(dot(tint, LUMA), 0.001)` — normalising by the tint's
own luminance shifts hue without darkening. Don't touch that line.

**Red is reserved for state authority.** Cones, collar tabs, banners, station
lintels, alarm states. Nothing the player owns or controls is ever red. Under
heavy desaturation red becomes the only saturated thing on screen, which is both
the threat-readability system and the thesis.

Base materials are pre-warmed. Grading sepia over cool geometry produces mud.

---

## Definition of done

A ticket is done when its acceptance criteria in the bible pass, `tsc --noEmit` is
clean, and the null case still holds:

> Walk through a patrol cone for sixty seconds. Assert the file is **exactly zero**.

That single assertion protects the entire design. Write it first, keep it green.
