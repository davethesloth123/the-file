# THE FILE

**Game bible and build specification · v2.0**
Third-person stealth · Cel-shaded · Browser (WebGL)
Solo / small team · Working prototype exists

This document merges the design bible and the technical spec. Part One is the
game. Part Two is how it looks and sounds. Part Three is how it gets built.

Companion files:
- `the-file-mvp.html` — working prototype, reference implementation
- `character-test.html` — character rig inspector
- `character-generator.py` — procedural humanoid generator
- `export-glb.py` — GLB exporter
- `sokolov.glb` — the rig, standard format

---

# PART ONE — THE GAME

## 1. The pitch

In Moscow in 1978, a metrology engineer named Andrei Sokolov spends about twenty
seconds a week working for American intelligence. The rest of the time he walks
to work, queues for bread, and takes his daughter to the clinic.

The state is not hunting him. It has no idea he exists. It is simply watching
everybody, all the time, and writing down what it sees — and once something is
written down it is never removed.

**The File is a stealth game where being seen is free and being noticed is fatal.**

### Logline

*A father runs errands for the CIA in the gaps between ordinary things, while a
file on him grows one sighting at a time, and the only ways to make it smaller
all cost him somebody.*

### On the name

The file is the antagonist. Not the militia, not the KGB, not any person — the
document, growing in an office Andrei will never enter, compiled by people who
have never met him and are not especially interested in him.

It also names the meter. The player watches a bar called The File for ten hours,
and the bar and the title are the same object.

*Store subtitle if needed:* THE FILE — *Moscow, 1978*
*Alternates held in reserve:* ORDINARY TRAFFIC · NO ADVERSE TRACES · LEGEND

### 400-character elevator

> Moscow, 1978. You run errands for the CIA between ordinary things. The state
> isn't hunting you — it watches everyone and writes it down. Walking past a
> patrol is free; only conduct is priced, and suspicion never fades. Every way
> to shrink your file costs you someone. Cel-shaded, graded like faded Cold War
> film stock.

---

## 2. Design pillars

Four rules. Every mechanic must serve one; anything that serves none gets cut.

### I. Presence is free. Conduct is priced.

Walking down the street in full view of a militia patrol costs nothing, ever.
The city is safe to inhabit. What costs you is *behaviour* — running, loitering,
servicing a drop, standing where you have no reason to stand.

This inverts the genre default. In most stealth games the world is hostile and
safety is the exception; here the world is indifferent and danger is something
you bring into it yourself. The player explores, walks, looks around, lives in
the city — and then tenses for twenty seconds when the work happens.

### II. Nothing is ever taken out of the file.

Suspicion does not decay. There is no thirty-second timer. What the state saw,
it keeps. This makes the file a *resource you spend* rather than a punishment
you wait out. A file at 61 is a biography.

### III. The game never lies to you.

Vision cones are always in the correct place, facing the correct direction, at
the correct range. Intel is never falsified. The handler does not deceive the
player.

Information can be **withheld** — you may not have earned it, or bought it. It
is never **wrong**. Every failure must be traceable to a decision the player
made with the information they had. The moment a player suspects the interface
of cheating, tension becomes frustration and the design collapses.

### IV. Every exit costs somebody.

There is no clean solution to a full file. Pay, and the money came from
somewhere dangerous. Inform, and a person disappears. Wait, and an operation
fails without you. The moral weight comes entirely from making all three doors
real and none of them free.

---

## 3. Setting

**Zamostye district, Moscow. October 1978 to July 1980.**

An invented raion on the wrong side of the river — pre-war stucco terraces going
to seed, post-war concrete infill, a tram line, a design bureau, a militia
station, a monument nobody looks at.

The period is chosen deliberately. Late stagnation: détente is dying, the shops
are thin, and the city is being scrubbed for the **1980 Summer Olympics**. Over
the campaign the security apparatus visibly tightens — more patrols, new
checkpoints, longer document checks — because Moscow is preparing to be looked
at by the world.

The difficulty ramp is therefore **diegetic**. It rises because the calendar
advances, not because a designer turned a dial, and the player feels the
deadline in the streets months before anyone mentions it.

Two real events anchor the arc without appearing on screen: the invasion of
Afghanistan in December 1979, which hardens everything overnight, and the
Olympic **prophylaxis** — the documented pre-games removal of people with
records from the capital. The second is the endgame. Andrei's file becomes a bus
ticket out of Moscow.

---

## 4. Protagonist

**Andrei Vasilyevich Sokolov**, 41. Metrology engineer, State Design Bureau No. 12.

He calibrates measuring instruments. Dull, precise, unglamorous work that does
two things for the design: it gives him **legitimate reason to travel** between
industrial sites across the city, and it puts him next to **specifications** —
tolerances, materials, test logs — exactly the dry technical material real
intelligence services want and film never depicts.

He is not a spy. He was never trained. He is a man who said yes once.

### Why he said yes

His daughter **Lidiya**, 9, has a condition managed by a drug manufactured in
West Germany. It is not available. It arrives through hard-currency channels,
black market, monthly, expensive.

This is the hook, and mechanically it is the spine of the economy: **money is
not optional**. Every month the medicine must be bought or Lidiya worsens, which
means the player cannot avoid risky work and play safe. The courier runs are not
a side activity. They are the reason he is in the street at all.

His wife **Marina** does not know. Her not knowing is a mechanic in Act II.

### Supporting cast

| | Role | Mechanical function |
|---|---|---|
| **Whitaker** | CIA handler, diplomatic cover | Voice only. Gates intel by confidence. Never lies. |
| **Vera** | Neighbour, quietly dissident | Free patrol intel. The first name available to give away. |
| **Grigori** | Fence, north-west alley | Courier work, equipment, purchasable intel. |
| **The clerk** | Records office | Converts money into file reduction, no trust cost. |
| **Nikolai** | Colleague, Act II | The person Andrei is made to recruit. |

---

## 5. Core mechanics

### 5.1 Conduct — the heart of the design

The only source of suspicion. Each entry accrues **per second, only while
observed**.

| Conduct | Rate | Notes |
|---|---|---|
| Walking, standing, riding the tram | **0** | Always free. This is the pillar. |
| Standing still >9s in one spot | 1.6 | Queues and benches exempt |
| Out of your legitimate district | 2.5 | Papers say Zamostye |
| Running | 4.2 | The most common mistake |
| Loitering at a state threshold | 5.5 | Station steps, ministry doors |
| Out after curfew | 6.0 | 23:00–05:00 |
| Talking with a flagged person | 8.0 | Once flagged, not before |
| Servicing a drop / photographing | 14.0 | The twenty seconds |

**Multipliers.** Carrying contraband ×1.9. Carrying operational material ×1.4.
Additional observers are **additive**, not multiplicative — two watchers is twice
as bad, not four times.

**Only one conduct is active at a time.** Rules are evaluated in order of
severity and the first match reports its own label. A stacked list is unreadable
and the player can only be told one thing at once.

**The readout is not optional.** Whenever conduct is active, the player sees the
specific reason and the number of observers. A rule the player cannot see is not
a rule, it is a trap. Pillar III applies to the UI as much as the world.

### 5.2 Observation

- **Militia patrols.** Fixed beats, 62° cones, 17m range, line-of-sight occluded
  by geometry. Cones are drawn if and only if the player has the intel, and are
  always accurate.
- **Fixed posts.** Static, narrow, long range. Predictable. Furniture more than
  threat.
- **Informants.** Civilians with cones that are *never drawn*, at any intel
  level. Discoverable by observation: an informant lingers where others pass
  through, appears at the same spot on different days, and stands alone. The
  information exists in the world; the player earns it by paying attention. This
  respects Pillar III — nothing is hidden that could not be seen.

Patrols only break their beat to look at you when conduct is active **and** they
can see you. A patrol that stops for a man walking is a bug.

### 5.3 The File

| Range | Status | Effect |
|---|---|---|
| 0–10 | No adverse traces | — |
| 11–34 | One sighting logged | Document checks take longer |
| 35–62 | Multiple sightings logged | Random street stops begin |
| 63–86 | Referred for surveillance | A tail appears on some missions |
| 87–99 | Detention order pending | Checkpoints will hold you |
| 100 | — | Arrest. Run ends. |

Bands are named in the state's own language, not the player's. The player reads
themselves as a bureaucracy reads them.

### 5.4 Confidence

The handler's assessment. Rises slowly through clean work; falls sharply when
the player does something he cannot explain.

| Range | What you are given |
|---|---|
| 66–100 | Full patrol pattern · exfil marked · equipment issued |
| 33–65 | Partial pattern · exfil marked · no equipment |
| 0–32 | Location only. Nothing else. |

Confidence gates **quantity of information, never accuracy**. Whitaker is a
professional under pressure who becomes tight-lipped, not a liar. When he stops
telling Andrei things, it is because he has started writing his own report.

**Release valve:** five seconds unobserved starts confidence recovering at
1.2/sec. Without this the two meters become a one-way slide. With it, the
campaign has a rhythm — accumulate heat, launder it at a cost, run clean to earn
back what you spent.

### 5.5 Money

**Sources**
- Courier runs for Grigori — ₽55–85, repeatable, ×1.9 conduct while carrying
- Selling issued equipment — good money, direct confidence hit
- Selling information to Grigori — excellent money, severe confidence hit
- Andrei's salary — ₽140/month, automatic, never enough

**Sinks**
- **Lidiya's medicine — ₽210/month, non-negotiable.** Missed months compound.
- Records clerk bribe — ₽130 for −40 file, zero confidence cost
- Diversion — ₽45
- Patrol pattern from Grigori — ₽70, permanent, bypasses the confidence gate
- Better forged papers — ₽300, reduces checkpoint risk

The medicine is what makes the economy work. Without it, money is a convenience.
With it, money is a monthly threat that pushes the player into the street on
weeks when the sensible play would be staying home.

### 5.6 Papers and checkpoints

Andrei carries internal documents. At a checkpoint, guard scrutiny is a function
of file level, papers quality, whether he is carrying, and time of day.
Outcomes: waved through, questioned (delay and tension, no cost), or held (file
spike, contraband confiscated, run compromised).

Papers degrade per check; forgeries degrade faster. This makes checkpoints a
resource drain rather than a coin flip, and gives the ₽300 papers a clear job.

### 5.7 The three doors

The entire moral architecture, and the thing to show people first.

| | File | Confidence | Money | Other |
|---|---|---|---|---|
| **Pay the clerk** | −40 | — | −₽130 | Money came from somewhere |
| **Inform** | −45 | −38 | — | A named character gone, permanently |
| **Run clean** | — | +slow | — | Time. An operation fails without you. |

None is optimal. That is the design.

---

## 6. Story arc

Twenty months, three acts. Each mission is a day; time advances toward the
Olympics whether the player is ready or not.

### Act I — Errands (Oct 1978 – Apr 1979)

Small work. Dead drops, a car serviced, a document photographed. Whitaker is
warm, professional, careful — asks little, gives a lot.

The act teaches the city and the rules. Its real job is to make the player
comfortable, because comfort is what Act II takes away. The file ends the act
between 15 and 40 depending on mistakes, and the player has probably not yet
faced a hard choice.

**Turn:** Andrei is asked to photograph something inside his own bureau. The
place he is safest becomes the place he does the worst thing.

### Act II — Weight (May 1979 – Dec 1979)

Heavier jobs, and Whitaker gets quieter. Two pressures arrive together.

**The recruitment.** Andrei must bring in a colleague, Nikolai — do to another
man exactly what was done to him. Find the lever, apply it, call it a
conversation.

**Afghanistan.** December 1979 hardens the city overnight. Patrol density up,
checkpoints permanent, curfew enforced. Nothing is explained in dialogue; the
player walks out one morning and the street is different.

By now the file is heavy enough that the three doors are no longer theoretical.

**Turn:** Marina finds something. She does not report him. She asks him to stop,
and he cannot, and the game does not let him explain why.

### Act III — The Games (Jan 1980 – Jul 1980)

The prophylaxis begins. People with records are being removed from Moscow ahead
of the Olympics, and the file becomes a bus ticket away from Lidiya and the
medicine.

Whitaker offers exfiltration. For Andrei. Not the family, not yet, *these things
take time* — and the player has spent twenty months learning exactly what
Whitaker's assurances are worth at each confidence level.

### Endings

Determined by meter state and one late choice. Not a menu.

- **Exfiltrated** — high confidence, high file. He gets out. They do not. Last
  shot is a window in Zamostye from a long way away.
- **Grey man** — low file, moderate everything. He survives. Still there in 1991,
  still with a file, still ordinary traffic.
- **Burned** — file 100. Arrest, and the interrogator reads the file back to him.
  Every entry is something the player did.
- **Cut loose** — confidence near zero. Whitaker stops coming. Andrei is alone in
  Moscow with everything he did and nobody to have done it for.
- **All three out** — high confidence *and* ₽1,400 banked *and* file below 30 in
  July 1980. Very hard, no signpost, no achievement. Some players never learn it
  was there.

---

## 7. Key missions

### 7.1 "Ordinary Traffic" — *tutorial, October 1978*

**Setup.** A film cassette taped under a bench in the park off Sadovaya. Collect
it, walk four hundred metres, leave it behind a downspout.

**Design job.** Teach the pillar and nothing else. A patrol is placed so the
walking route passes *directly through* its cone, unavoidably, twice. Nothing
happens. The player will brace for it, and nothing will happen, and that is the
entire lesson.

Then the drop: fourteen points per second while observed, and the patrol is
forty seconds away on its beat. The player must wait. The tutorial for this game
is a tutorial in standing still.

**Failure.** Cannot fail. Being caught costs file, and the file follows into Act
I — a better teacher than a restart.

### 7.2 "The Metrology of Small Things" — *Act I turn, March 1979*

**Setup.** Bureau No. 12, Andrei's own workplace. Photograph the tolerance logs
for a batch of pressure transducers, third floor.

**Design job.** Invert the spatial rule. Presence here is *completely* free — he
works here, has keys, nobody questions him on any floor at any hour. The building
has no cones at all.

Except the records room has a duty clerk, and the corridor has a colleague
working late who is not an informant and not a threat, and who will simply
*remember*, later, when asked, that Sokolov was on the third floor at nine.

**Introduces.** Delayed consequence. Nothing accrues during the mission. Six days
later the file jumps 18 points with no explanation and the player works out why
on their own.

**Choice.** The colleague can be avoided by waiting ninety minutes of in-game
time for him to leave — a long, boring, tense ninety minutes in an empty
building. Or walk past and take the hit. The correct play is the boring one, and
the game will not say so.

### 7.3 "A Man Called Nikolai" — *Act II, August 1979*

**Setup.** Recruit Nikolai Abramov, a colleague with access Andrei lacks.
Whitaker supplies the lever: Nikolai's brother-in-law has an emigration
application that could be helped along, or ruined.

**Design job.** No patrols, no cones, no stealth. Three conversations across
three weeks — canteen, bus stop, Nikolai's flat.

**Introduces.** The player chooses how hard to push at each stage. Push gently
and Nikolai may refuse: mission fails, confidence drops. Push hard and he agrees:
confidence rises, and Nikolai now exists in the world with **his own file**, a
second bar the player caused and cannot control.

**Why it matters.** It converts the central relationship from something done *to*
the player into something the player does. Whatever Whitaker is to Andrei, Andrei
is now that to Nikolai — and Nikolai joins the list of names available to give
away.

### 7.4 "Prophylaxis" — *Act III, February 1980*

**Setup.** A contact in the district soviet reports the removal lists are being
compiled. Four in-game weeks to get the file below 35 or be removed from Moscow.

**Design job.** The three doors, under a clock, with twenty months of prior
decisions determining which are even open.

- **Pay** needs ₽130 on top of February's medicine. Affordable if the player has
  run couriers all campaign. Not, if they played safe.
- **Inform** needs a name. By now there are several — Vera, Grigori, Nikolai —
  and each removes something concrete. Naming Grigori closes the courier economy
  permanently. Naming Nikolai ends the operation Andrei recruited him for.
- **Wait** means four weeks of no work, no courier money, and a missed March
  medicine payment.

**Intent.** There is no correct answer and the game must never imply there was.
The player's small decisions already chose which door is survivable. The mission
presents the bill.

### 7.5 "Vera's Window" — *optional, any time from Act II*

**Setup.** Not assigned. The militia station is on the map from hour one, and
from the moment the file passes 18 the player can walk in and give a name.

**Design job.** The only mission the player gives themselves. No briefing, no
marker, no objective text. A building that has been sitting there the whole time
while the file got heavier.

**Consequence.** Vera is removed from the world. Her patrol tip — worth a 16%
speed reduction on every militia beat in Zamostye — goes with her, permanently.
Confidence drops 38, which for most players cuts off equipment.

Two missions later an NPC mentions Vera's flat is being reallocated. Nobody says
anything to Andrei. Nobody suspects him. The game does not judge him.

**Intent.** The cheapest door has the highest price, paid in instalments over the
rest of the campaign rather than at the counter.

---

# PART TWO — ART DIRECTION

## 8. Palette and grade

Cel shading on a three-band toon ramp with hard `NearestFilter` steps, outlines
in warm brown-black, over a full-screen **split-tone grade**.

The grade is the identity. Desaturate to ~0.26 — not to zero — then push
highlights to warm cream, midtones to khaki, shadows to a cool grey-green. The
tension between warm highs and cool lows reads as period film stock; a uniform
brown wash reads as mud. Lifted blacks throughout, because emulsion never gave a
true zero. Grain weighted heavier in shadow.

### The three anchors

```glsl
const vec3 T_SHADOW = vec3(0.38, 0.41, 0.43);   // cool grey-green
const vec3 T_MID    = vec3(0.73, 0.63, 0.44);   // khaki
const vec3 T_HIGH   = vec3(1.02, 0.93, 0.72);   // warm cream
```

Move these three vectors and the whole game moves with them. Colder East Berlin,
greener Eastern Bloc — it is a three-line change.

### The critical line

```glsl
vec3 toned = desat * tint / max(dot(tint, LUMA), 0.001);
```

Normalising the tint by its own luminance shifts hue **without darkening the
image**. This is the difference between a grade and a filter, and it is the one
line to not touch.

### Default values

| Uniform | Value | |
|---|---|---|
| `uSat` | 0.26 | Desaturation floor, not zero |
| `uSepia` | 0.92 | Split-tone strength |
| `uWarm` | 1.00 | Tint intensity |
| `uContrast` | 1.14 | About mid-grey |
| `uLift` | 0.52 | Lifted blacks |
| `uVignette` | 0.58 | |
| `uGrain` | 0.055 | Weighted `(1.0 - l*0.65)` |
| `uRedKeep` | 0.45 | See below |

### Red is reserved

Vision cones, collar tabs, banners, station lintels, alarm states. **Nothing the
player owns or controls is ever red.**

Under heavy desaturation this makes red the only saturated thing on screen, which
does two jobs at once: the strongest possible readability aid for threat, and it
says what the game is about without a line of dialogue. Red is partially
protected from the grade's desaturation at 0.45 — emphasis rather than Sin City.

```glsl
float redness = clamp((c.r - max(c.g, c.b)) * 2.4, 0.0, 1.0);
col = mix(col, c, redness * uRedKeep);
```

### Base materials

Pre-warmed so the grade nudges rather than fights. Grading sepia over cool blue
geometry produces mud.

```
road   0x46423a    ochre  0xc09550    trim   0x35301f
kerb   0x6b6355    sage   0x77785f    stone  0xa79e88
roof   0x544c3e    bone   0xb4a88e    STATE  0xc0201f
                   rust   0x9a7350
```

Sky and fog: `0xb3a992`, fog range 52–180m. Sun `0xffeec4` at 1.2. Hemisphere
`0xc4baa2` over `0x453c2c` at 0.6.

### References

- **L.A. Noire** — the grade, specifically the split-tone rather than the brownness
- **Soviet modernist civic architecture** — Kyiv, Tashkent, Chișinău. The flat,
  heavy, geometric later stuff, not Stalinist wedding cakes
- **Papers, Please** — the discipline of making bureaucracy the antagonist
- **Sable / Firewatch** — proof that a limited palette and confident art direction
  beat fidelity
- **Tarkovsky, Stalker** — texture, weather, wet concrete, a place that has been
  damp a long time

---

## 9. Characters

**Decision: procedurally generated for the MVP, commissioned later if needed.**

This was originally specced as "buy a stylised pack and retarget Mixamo." That is
still the right answer for ship quality. It is **not** the right answer for the
MVP, because a procedural generator has been built and works, and it brings
advantages a purchased pack does not: the entire cast varies for free, proportions
are a parameter, and there is no licence attached to anything.

### What the generator produces

2,078 triangles, 25 bones, four animation clips, exports to standard GLB.

The body is **lofted from anatomical cross-sections**, not assembled from
primitives. Superelliptical sections (`n≈2.6` for the trunk) because a real torso
is roughly 1.5× wider than it is deep, and circular sections make everyone look
like a bollard.

What the loft gives, in order of how much each contributes to reading as human:

1. **A head with structure** — twelve levels through cranium, temple, brow, eye
   line, cheek, jaw, chin, plus a brow ridge and ears. Under three-band toon
   shading a brow shelf is what makes a head read as a face, and it costs ~40
   triangles.
2. **Hands and shoes existing at all.** Tapered stumps and cones did enormous
   damage; mittens and shoes cost very little.
3. **Shoulder shelf and tapered waist** — deltoid mass at the shoulder, ribcage,
   waist in, calf bulge above the ankle.
4. **Smooth normals computed from the surface**, not guessed analytically.

### The skeleton contract

Bone names follow **Mixamo convention minus the prefix**, deliberately, so free
mocap retargets onto this rig without a mapping table when the time comes.

```
Hips → Spine → Spine1 → Spine2 → Neck → Head → HeadTop_End
Spine2 → {Left,Right}Shoulder → Arm → ForeArm → Hand → Hand_End
Hips   → {Left,Right}UpLeg → Leg → Foot → Toe_End
```

Rest pose is an A-pose, metres, Y-up, total height 1.78m.

### ⚠ Rotation sign convention

Limb bones point **downward** (−Y). This trips everyone, including the first
version of this rig, where every knee hyperextended.

```
hip flexion   (leg swings forward)  = NEGATIVE X
knee flexion  (heel toward buttock) = POSITIVE X
elbow flexion (hand comes up)       = NEGATIVE X
```

To verify: a point at local `(0,-1,0)` rotated `+30°` about X lands at
`z = -0.5`, i.e. backward. Backward is correct knee flexion.

The hips being inverted too is easy to miss — a flipped sine wave is just a phase
shift and still looks like walking. Check the knees, always.

### Animation clips

| Clip | Duration | Natural speed | Notes |
|---|---|---|---|
| `idle` | 4.4s | — | Weight shift, head drift, soft knees |
| `walk` | 1.00s | 2.05 m/s | 36° hip swing, 44° knee fold |
| `jog` | 0.64s | 4.05 m/s | 45° swing, 72° knee, 9° forward lean |
| `crouch` | 3.2s | — | Squat, right hand reaching down |

### Stride locking

Each clip carries its natural ground speed as **data**, and playback rate is
derived from actual velocity:

```js
action.timeScale = clamp(actualSpeed / naturalSpeed, 0.6, 1.75);
```

No foot sliding at any pace, and the same code drives every character. This is
also why player walk speed is 2.4 m/s and not 2.9 — the old speed forced a
`timeScale` high enough to look comedic.

### ⚠ Outlines on skinned meshes

Inverted-hull outlines work on static geometry and **fail on skinned meshes**:
scaling a SkinnedMesh scales about the mesh origin at the feet, so the outline
grows upward and floats off the ground.

**Solution used:** clone the geometry, push every vertex 16mm along its own
normal at load, bind the shell to the *same skeleton* with `side: BackSide`.

```js
const SHELL = BODY.clone();
const p = SHELL.attributes.position, n = SHELL.attributes.normal, T = 0.016;
for (let i = 0; i < p.count; i++)
  p.setXYZ(i, p.getX(i)+n.getX(i)*T, p.getY(i)+n.getY(i)*T, p.getZ(i)+n.getZ(i)*T);
shell.bind(mesh.skeleton, mesh.bindMatrix);
```

This is fine for the MVP. At ship scale, replace with a post-process depth+normal
edge pass — cheaper with many characters, and one global line-weight control.

### Variation

One geometry, one clip set, per-instance variation:

- **Height** — group scale 0.93–1.06. Scales about the feet, so this is genuine
  height variation.
- **Coat colour** — per-instance `MeshToonMaterial`.
- **Attachments** — caps and collar tabs are plain meshes parented to the `Head`
  and `Spine2` bones, so they follow animation for free without being part of the
  skinned geometry.

### Known compromise

The coat is **hip-length, not a greatcoat**. At a 36° stride the thigh travels
~25cm forward at knee height, and a long rigid hem would have legs punching
through it. A proper greatcoat needs the hem weighted partly to the legs, or
cloth sim. Worth doing eventually; not for the MVP.

---

## 10. Camera

Auto-trailing third person, GTA IV lineage.

| | Preset 1 | Preset 2 | Preset 3 |
|---|---|---|---|
| Distance | 4.7 | 6.6 | 9.8 |
| Shoulder offset | 0.70 | 0.00 | 0.00 |
| Focus height | 1.50 | 1.62 | 1.75 |
| Pitch | 0.15 | 0.22 | 0.36 |
| FOV | 55 | 56 | 52 |

- **Recentres behind the player** at 2.4 rad/s, but only while forward input is
  held — so strafing and reversing don't fight the camera.
- **Manual look suspends recentre for 2.2s**, then eases back.
- **Collision raycast** pulls the camera in on geometry, min 1.4m.
- **FOV opens 7°** when running. Small, and it does most of the work of making
  running feel like running.
- **No pointer lock.** No mode to get trapped in, and the demo stays playable in
  a browser tab with one hand.

---

## 11. Sound

Sparse and diegetic. Trams, boots on wet stone, radios through open windows, the
specific acoustics of a stairwell.

**No stinger when a patrol notices you.** The state does not announce itself. The
only cue is the readout and the sound of footsteps stopping.

Score is minimal — single instruments, long tones — and enters when the **file
moves**, not when danger appears. Music means consequence, not threat.

---

## 12. Interface and brand system

For UI design work, this is the system.

### Type

Monospace throughout. `SF Mono / Roboto Mono / Menlo / Consolas`. Bureaucratic,
typewritten, cold — the state's vocabulary in the state's typeface.

| Role | Size | Tracking | Case |
|---|---|---|---|
| Meter label | 10px | 0.24em | UPPER |
| Meter status note | 10px | 0.08em | UPPER |
| Objective | 13px | normal | Sentence |
| Conduct banner | 11px | 0.20em | UPPER |
| Radio message | 13px | 0.03em | Sentence |
| Speaker attribution | 10px | 0.22em | UPPER |
| Title display | clamp(40–70px) | −0.03em | UPPER, 700 |

### Colour

```
--paper  #ded2b8   text, player-side meters
--state  #b8322c   the file, threat, authority — never anything else
--ink    #14120e   panel backgrounds at 0.90 alpha
--mute   rgba(222,210,184,0.42)   labels, secondary
--gain   #cbb37a   money earned
```

### Components

- **Meters** — 6px track, 1px border at 0.22 alpha, label row with value
  right-aligned. File fills red, confidence fills paper.
- **Conduct banner** — top centre, solid red at 0.92 when observed, ink at 0.85
  when not. Reason on the first line, observer count on the second.
- **Action prompt** — bottom centre, keycaps in 1px outlined boxes, costs in red,
  gains in gold.
- **Radio** — left border 2px, paper for the handler, red when the relationship
  is damaged.

Errors and empty states explain what happened and what to do, in the interface's
voice, never apologising. Every label names what the player controls, never how
the system is built.

---

# PART THREE — BUILD

## 13. Stack

- **Three.js** (current release — the prototypes pin r128 only because of the CDN)
- **TypeScript**, strict
- **Vite** for dev server and build
- **Rapier** (WASM) for collision, replacing the prototype's hand-rolled AABB
- No React. The HUD is plain DOM.

Browser deployment removes every barrier to a stranger trying the demo. Godot 4
is the serious alternative — better tooling, heavier WASM export, worse fit for
agentic code work.

## 14. Repo structure

```
src/
  main.ts                 bootstrap, loop
  core/
    clock.ts              fixed-step accumulator
    input.ts              key/mouse map, rebindable
    events.ts             typed pub/sub
  render/
    renderer.ts           WebGLRenderer, buffers
    toonify.ts            material swap on load
    outline.ts            shell geometry (MVP) → edge pass (later)
    grade.ts              split-tone shader
    camera.ts             trailing rig, recentre, collision
  world/
    level.ts              GLB env + JSON volumes
    collision.ts          Rapier bodies from volumes
    nav.ts                waypoint graph
  actors/
    actor.ts              transform, skeleton, mixer
    locomotion.ts         speed → clip blend + timeScale
    player.ts  patrol.ts  civilian.ts  npc.ts
  systems/
    conduct.ts            THE conduct table. single source of truth.
    observation.ts        who sees whom, this frame
    file.ts  confidence.ts  economy.ts
    interaction.ts        proximity prompts, hold-to-act
    mission.ts            objective state machine
  ui/
    hud.ts  prompt.ts  radio.ts  bench.ts
  data/
    tuning.json  conduct.json  prices.json
    map.zamostye.json
    missions/*.json  npcs/*.json  dialogue/*.json
tools/
  character-generator.py  export-glb.py
public/
  models/  anim/  textures/  audio/
```

## 15. Conventions

- Y-up, right-handed. **1 unit = 1 metre.** Never deviate.
- +Z is north. The avenue runs north–south.
- Radians internally, degrees only in JSON.
- **Fixed 60Hz simulation step** with an accumulator; render interpolates. The
  prototypes use variable `dt`, which is fine for a toy and will produce
  different suspicion accrual at 30fps versus 144fps. In a game where the meter
  *is* the design, that is a broken contract, not a rounding error.
- All gameplay numbers live in `data/*.json`. **No tuning constant appears in a
  `.ts` file.** This is the rule that lets design iterate without engineering.

## 16. Data schemas

### `tuning.json`

```jsonc
{
  "player": { "walk": 2.4, "jog": 5.2, "turnRate": 10.0, "radius": 0.42 },
  "vision": { "range": 17.0, "fovDeg": 62, "alertRise": 2.0,
              "alertFall": 0.9, "loseTime": 2.6 },
  "file":   { "max": 100, "tiers": [
                { "at": 0,  "label": "No adverse traces" },
                { "at": 11, "label": "One sighting logged" },
                { "at": 35, "label": "Multiple sightings logged" },
                { "at": 63, "label": "Referred for surveillance" },
                { "at": 87, "label": "Detention order pending" } ] },
  "confidence": { "start": 100, "cleanDelay": 5.0, "cleanRate": 1.2,
                  "tiers": [ { "at": 0, "intel": "none" },
                             { "at": 33, "intel": "partial" },
                             { "at": 66, "intel": "full" } ] },
  "locomotion": { "clips": {
      "idle":   { "natural": 0 },
      "walk":   { "natural": 2.05 },
      "jog":    { "natural": 4.05 },
      "crouch": { "natural": 0 } },
    "blendTime": 0.22, "timeScaleClamp": [0.6, 1.75] },
  "camera": { "recentreRate": 2.4, "manualHold": 2.2, "jogFovBoost": 7,
              "views": [
                { "dist": 4.7, "shoulder": 0.70, "focus": 1.50, "pitch": 0.15, "fov": 55 },
                { "dist": 6.6, "shoulder": 0.00, "focus": 1.62, "pitch": 0.22, "fov": 56 },
                { "dist": 9.8, "shoulder": 0.00, "focus": 1.75, "pitch": 0.36, "fov": 52 } ] }
}
```

### `conduct.json`

The most important file in the project.

```jsonc
{
  "rules": [
    { "id": "service",     "rate": 14.0, "label": "Servicing a dead drop" },
    { "id": "flagged",     "rate":  8.0, "label": "Talking with a flagged person" },
    { "id": "curfew",      "rate":  6.0, "label": "Out after curfew" },
    { "id": "threshold",   "rate":  5.5, "label": "Loitering on {place}" },
    { "id": "running",     "rate":  4.2, "label": "Running in the street" },
    { "id": "offDistrict", "rate":  2.5, "label": "Outside your district" },
    { "id": "loitering",   "rate":  1.6, "label": "Standing about too long",
      "after": 9.0 }
  ],
  "multipliers": { "contraband": 1.9, "operational": 1.4 },
  "observerScaling": "additive"
}
```

Evaluated in array order; **first match wins and reports its own label**.

### `map.zamostye.json`

Environment is a GLB. This carries everything the mesh cannot.

```jsonc
{
  "env": "models/zamostye.glb",
  "colliders": [ { "type":"box", "pos":[-30,7.5,-58], "size":[20,15,22] } ],
  "districts": [ { "id":"zamostye", "legitimate":true,
                   "poly":[[-80,-100],[80,-100],[80,100],[-80,100]] } ],
  "restricted":[ { "id":"station_steps", "pos":[50,-8], "r":7.5,
                   "label":"the station steps" } ],
  "waypoints": { "avenue_n":[-9,52], "avenue_s":[-9,-62] },
  "spawns":    { "player":[0,62], "grigori":[-55,66], "vera":[-47,-33] }
}
```

### `missions/*.json`

```jsonc
{
  "id": "ordinary_traffic",
  "act": 1, "date": "1978-10-14",
  "brief": "handler.brief.ordinary_traffic",
  "objectives": [
    { "id":"collect", "type":"hold_at", "pos":[-46,-14], "seconds":2.6,
      "conduct":"service", "label":"Service the dead drop",
      "onComplete":[ { "set":"carrying", "value":true },
                     { "radio":"handler.now_carrying" } ] },
    { "id":"exit", "type":"reach", "pos":[0,82],
      "label":"Clear the district",
      "revealIf": { "confidence": ">=33" } }
  ],
  "fail": [ { "when":"file>=100", "ending":"burned" } ]
}
```

Objective `type` is a **closed set**: `reach`, `hold_at`, `talk_to`, `deliver`,
`wait_until`. Adding a sixth is an engineering task; adding a mission is not.

### Save schema

```jsonc
{
  "version": 1,
  "campaign": { "date":"1979-03-08", "act":2, "missionsDone":["..."] },
  "meters":   { "file":47.2, "confidence":61, "money":340 },
  "flags":    { "vera_named":false, "nikolai_recruited":true,
                "intel_purchased":true, "medicine_missed":0 },
  "npcs":     { "vera":"alive", "grigori":"alive", "nikolai":"recruited" }
}
```

`localStorage`, one slot, autosave between missions. Version field from day one.

## 17. System specs and acceptance criteria

Each is a ticket. None is done until its criteria pass.

### Conduct

Single exported function. Given world state, returns `{rule, rate, label} | null`.

- ✅ Walking within a patrol cone at any distance for 60 seconds accrues **exactly zero**
- ✅ Running within a cone accrues `4.2 × observers` per second
- ✅ Only one rule reports at a time, highest in the array
- ✅ Accrual identical at 30fps and 144fps (fixed step)
- ✅ Grep `src/` for `4.2` and find nothing

### Observation

- ✅ Cone position and rotation match the rendered fan to within a pixel, always
- ✅ LOS raycast respects geometry; standing behind a wall breaks it
- ✅ Cone *visibility* gated by intel; cone *truth* never is
- ✅ Informants have cones never rendered at any intel level
- ✅ Patrols break their beat only when conduct is active **and** they can see you

### Locomotion

- ✅ No foot sliding at any velocity (`timeScale = speed / natural`)
- ✅ Blend idle → walk → jog continuous, no popping
- ✅ Knees flex backward in every clip (positive X — see §9)
- ✅ Same code path for player, militia, civilians, NPCs

### Camera

- ✅ Recentres only while forward input held
- ✅ Manual look suspends 2.2s, then eases back
- ✅ Never clips geometry
- ✅ Three presets on `V`, scroll adjusts within the active preset
- ✅ No pointer lock anywhere

### Rendering

- ✅ Toon material on every loaded mesh, skinning preserved
- ✅ Outline shell binds to the same skeleton, sits on the ground
- ✅ Grade uniforms from `tuning.json`, bench panel dev-only
- ✅ Red preserved through desaturation at the configured amount
- ✅ 60fps at 1080p on integrated graphics, 20 skinned characters visible

## 18. Budgets

| | Target | Ceiling |
|---|---|---|
| Frame time | 16.6ms | 22ms |
| Draw calls | 180 | 300 |
| Triangles | 250k | 400k |
| Skinned characters visible | 20 | 30 |
| Character triangles | 2.1k | 8k |
| Total download | 25MB | 40MB |
| Shadow map | 2048² | 2048² |

Download budget matters more than it looks. A browser demo that takes ninety
seconds to load is a demo most people close.

## 19. Input

| Action | Key | Gamepad |
|---|---|---|
| Move | WASD | Left stick |
| Hurry | Shift | Left trigger |
| Act | F (hold) | A (hold) |
| Diversion | G | B |
| Cycle camera | V | Right stick click |
| Look | Mouse drag | Right stick |
| Grade bench | Tab | — |

Rebindable from day one, stored in the save. Gamepad support is cheap in the
Gamepad API and makes the demo playable at a show.

## 20. MVP scope

The goal is not a slice of the game. It is to **prove the thesis in eight minutes
to someone who has not read this document.**

That thesis: *presence is free, conduct is priced, and every way out costs
somebody.* Anything that does not demonstrate it is cut.

**In:** one district · one mission (dead drop + exit) · all three meters with the
conduct readout · the courier loop · two of the three doors (clerk and Vera) ·
Vera herself · full art direction.

**Out:** papers and checkpoints · informants · curfew · the calendar layer ·
Lidiya and the medicine · Nikolai · conversation system · save persistence ·
audio beyond footsteps · multiple missions · rideable tram.

**Vera must be in the MVP.** She is the entire moral argument in one NPC and the
demo does not work without her.

## 21. Build order

Dependency-ordered tickets. Each independently testable, each a separate session.

1. **Scaffold** — Vite, TS, Three.js, fixed-step loop, empty scene
2. **Render pipeline** — colour buffer, grade pass, bench panel
3. **Character load** — GLB in, toonify traversal, shell outline, mixer on idle
4. **Locomotion** — speed-blended clips, `timeScale` stride lock, foot-slide check
5. **Camera** — trailing rig, recentre, collision, three presets
6. **Level** — GLB environment, JSON colliders into Rapier, player collision
7. **Patrols** — waypoint beats, cones, LOS, alert FSM, animation states
8. **Conduct + observation** — the table, the accrual, the HUD banner
9. **Meters** — file, confidence, tiers, intel gating of cone visibility
10. **Interaction** — proximity prompts, hold-to-act, one working dead drop
11. **Mission runner** — JSON objectives, closed `type` set, completion and fail
12. **Economy** — money, Grigori's courier loop, contraband multiplier
13. **The three doors** — clerk, station, Vera and the hole she leaves
14. **Civilians** — ambient routes, shared locomotion
15. **Audio** — footsteps, ambience, the deliberate absence of a detection stinger
16. **Save** — schema, autosave, migration stub
17. **Art pass** — grade tuning, line weight, camera feel

Tickets 1–8 are the risky half. If conduct does not feel right at ticket 8, stop
and fix it before building anything on top.

## 22. Guardrails for agentic work

- **Never invent a tuning number.** If a value is needed and absent from
  `data/*.json`, stop and ask. Numbers that appear from nowhere cannot be audited
  and will silently break the design.
- **Never hardcode content.** Missions, NPCs, prices and dialogue belong in JSON.
  If a feature requires touching `.ts` to add content, the schema is wrong — fix
  the schema.
- **Never let the game lie.** Pillar III is a code-level constraint. Any rendering
  path that could display a cone in a position other than the one used for
  detection is a bug regardless of how it looks.
- **One system per session.** The ticket order has real dependencies.
- **Test the null case first.** The first test written should be *"walk through a
  cone for sixty seconds, assert file is exactly zero."* That single assertion
  protects the entire design thesis.

## 23. Reference implementation

`the-file-mvp.html` is a working single-file prototype. It is not the
architecture — it is variable-timestep, has no data layer, and pins r128 — but it
is a **behavioural reference**. When the rewrite disagrees with it about how
something feels, the prototype is usually right.

What it already proves:

- Behaviour-based conduct with the readout is legible without a tutorial
- Auto-recentring camera at 2.4 rad/s feels correct
- Stride-locked locomotion eliminates foot slide across the full speed range
- The grade holds up over stylised low-poly geometry
- 16 skinned characters with shell outlines run comfortably at 60fps
- Red-reserved discipline reads instantly as threat

`character-test.html` inspects the rig alone — all four clips, variable playback
rate, skeleton overlay, grade on and off.

## 24. The playtest

Five people who play games and have not read this document. Watch for one moment:
**the first time they walk past a patrol without slowing down.**

Under three minutes and the design works. Still hugging walls at minute eight and
the conduct readout has failed, and nothing downstream is worth building yet.

Instrument this rather than eyeballing it.

## 25. Open questions

- **Environment art source.** Same buy-versus-build question as characters, still
  unanswered. Modular Soviet-era kit is faster; bespoke makes Zamostye a place
  rather than a tile set. The character generator suggests procedural is more
  viable here than assumed.
- **Is Andrei ever in physical danger?** Current answer: no. No combat, no chases,
  no weapons. Arrest is the fail state and happens quietly in an office. Probably
  correct, and the single hardest thing to sell to anyone expecting a stealth
  game. Have the answer ready before the pitch.
- **How much of Lidiya and Marina?** Too little and the medicine is an
  abstraction; too much and it becomes a family drama with a stealth minigame.
  Suspect: never leave the flat, always through a doorway, no more than four
  scenes.
- **Does Whitaker ever appear on screen?** Currently a voice and a set of
  instructions. An argument exists for keeping it that way permanently.
- **Greatcoats.** Needs hem weights on the legs or cloth sim. Deferred.
- **Dialogue system.** Act II needs one, the MVP does not. Sketch the schema
  before mission 7.3 is built.
- **Localisation.** All player-facing strings should be keys from day one
  (`handler.brief.ordinary_traffic`) even though only English exists.
  Retrofitting string keys is miserable.

---

*The File · bible and build specification v2.0 · not for circulation*
