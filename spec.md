# Timber Grid — Product and Game Specification

**Document status:** running specification of the game as built on the StarHermit engine.  
**Game index:** 7  
**Genre:** Spatial puzzle  
**Players:** 1 player; optional asynchronous score comparison  
**Targets:** the StarHermit engine 1.30.0: natively in the StarHermit client and in desktop and mobile browsers through the engine's web runtime, landscape and portrait  
**Rendering direction:** a 3D bench on `starhermit:scene` (ported from three.js) under an immediate-mode `starhermit:ui` interface

## 1. Product vision

Timber Grid is a game in which players fit wooden polyominoes into a nine-by-nine board; rows, columns, and three-by-three regions clear. Its signature setting is a handcrafted wooden puzzle bench. The product should feel immediately understandable, responsive within one input, and polished enough that the board or playfield itself is the visual hero. Sessions should begin quickly, make the next useful action obvious without solving the game for the player, and end with a clear explanation of score and progress.

The experience must be original. Do not copy names, layouts, characters, iconography, writing, audio, progression maps, or level data from an existing title. Use an original visual language, original procedural assets, and internally authored content.

### Design pillars

1. **Readable before spectacular:** legal actions, hazards, selection, ownership, and goals remain legible with effects disabled.
2. **One-input confidence:** every press, tap, drag, key, or pointer action gives immediate visual and sonic acknowledgment.
3. **Short path to play:** a returning player reaches the primary playfield in at most two deliberate actions.
4. **Fair mastery:** randomness is seeded and inspectable; outcomes never depend on hidden purchases or invisible stat boosts.
5. **Scalable beauty:** the same art direction survives low-power mobile hardware and high-resolution desktop displays.

## 2. Core game design

### Objective and rules contract

Fit wooden polyominoes into a nine-by-nine board; rows, columns, and three-by-three regions clear.

The rules engine must represent legal actions independently from rendering. It must expose legal-action queries, deterministic resolution, serializable state, a monotonically increasing turn/tick number, and a terminal-state reason. Tutorials and hints call the same legal-action API used by play rather than duplicating rules.

### Core loop

The repeated loop is: **move or place a piece, preview consequences, commit, resolve clears, and replenish the offer**. Input is locked only during the shortest non-interruptible resolution phase. Cosmetic animation may continue after the logical state is ready, but skip/fast-forward must settle every object into the exact deterministic end state.

### Scoring and victory

Score equals cleared cells plus simultaneous-clear and combo bonuses; end when no offered piece fits. Results show a component breakdown rather than one unexplained total. Store integers for score and simulation units; format values only in presentation. Ties use, in order: primary objective completion, fewer invalid actions, lower authoritative elapsed time, then stable session identifier.

### Modes

- **Learn:** interactive lessons introduce one rule at a time and require the player to perform the action.
- **Journey:** authored progression with gradually combined mechanics and periodic mastery stages.
- **Daily:** one shared seed and ruleset per UTC day, synchronized to platform time.
- **Practice:** selectable difficulty, restart, undo where rules permit, and no effect on competitive rating.
- **Challenge:** constrained goals such as move limits, speed targets, altered layouts, or restricted tools.
- **Score chase:** asynchronous global and friends comparisons using validated seeds and rulesets.

### Difficulty and content generation

- Represent content as versioned data: identifier, seed, initial state, goals, allowed mechanics, par values, tutorial flags, and presentation theme.
- Run offline validators to prove basic legality, reachable goals, bounded duration, and absence of soft locks. Logic puzzles additionally require a unique or explicitly accepted solution class.
- Difficulty is measured from solution depth, branching factor, time pressure, motor precision, hidden information, and recovery options—not merely larger numbers.
- Introduce one new concept in isolation, combine it with one known concept, then test mastery before adding another.
- Daily seeds are immutable after publication. If content is defective, mark the day excluded from ranking rather than silently replacing it.

### Game-state model

`boot → title → profile-ready → mode-select → preparing → tutorial/countdown → active ↔ paused/reconnecting → resolving → results → progression`.

Every transition has one owner and an explicit reason. Backgrounding pauses solo simulation. In hosted play, the authoritative clock continues where rules require it, while the returning client receives a fresh snapshot and a concise “while you were away” summary.

## 3. Interaction and user-interface design

### Information hierarchy

1. **Primary:** playfield, current objective, legal interaction target, and immediate danger or turn state.
2. **Secondary:** score/progress, remaining moves or time, opponent/party status where applicable.
3. **Tertiary:** settings, social controls, cosmetics, help, and history.

The 3D bench fills the window between the status bar and the tray but is never the only UI: menus, text, settings and assistive announcements are `starhermit:ui` widgets drawn over it, with the engine's accessibility tree, focus, keyboard and gamepad navigation. One layout model (`native/screens.ts`) frames the board in what the rails leave free.

### Responsive layouts

Layouts follow the window's logical size (window pixels ÷ `ui.preferences().scale`, the window's scale factor times the player's interface size):

- **Wide (≥ 1024 logical px):** the objective, journey and lesson rail on the left, the action rail (Hint, Undo where allowed, Fit board) on the right; the board is framed between them.
- **Compact (< 1024):** the journey and lesson card become a band across the top (the objective stays in the status bar only), the actions a band at the bottom right above the tray; the lesson card can be hidden to a chip.
- **Short landscape (landscape, ≤ 500 logical px high):** rails as side columns, the actions as a column, no brand or player chip, a slim tray with 48 px pieces.
- The status bar wraps like the browser's flex row: the brand at the start, the chips (objective, score, combo), Pause and the player chip packed into lines by their measured widths; a chip wider than the bar wraps as a paragraph.
- The camera is fitted by projection: it pulls back from 0.75 of the authored distance until every board corner (piece height included) sits inside the free rectangle and slides across its view until the board is centred there (the engine has no camera view offset); when the rails leave less than 45 % of the region either way, the whole region is used. **Fit board** (C) refits.
- Large screens, text size and interface size are the runtime's (Options › Accessibility); the UI follows them and the cards scroll when taller than the window, their action buttons kept in view below the scroll.

### Screens and overlays

- **Title/home:** Play is dominant; daily challenge, journey progress, and profile are one level below.
- **Mode setup:** show rules, expected duration, player count, assists, and whether the result is ranked before commitment.
- **Play HUD:** objective, progress, current actor/state, pause, and only context-relevant actions.
- **Pause/settings:** resume first; audio, graphics, controls, accessibility, help, and leave are clearly separated.
- **Results:** outcome headline, score breakdown, progress, achievements, comparison, replay/retry, and next recommended action.
- **Help:** visual rule cards generated from current control mappings and representative legal states.
- Daily challenge, local practice, pause, resume, results, and progression are first-class screens.

### Input

Actions are declared in `starhermit.txt` (`control.*` keys, `engine.gamepad.*` pad defaults, grouped Board / Pieces / Assists) and rebound in the runtime's Options › Controls; the game reads actions, never keys.

| Action | Keys | Pad |
|---|---|---|
| Move target | arrows | D-pad, left stick |
| Select piece 1 / 2 / 3 | 1 / 2 / 3 | LB (piece 1), RB (piece 3) |
| Next piece | N | East (B) |
| Place | Enter, Space | South (A) |
| Undo (Relaxed practice, Learn) | U | West (X) |
| Hint | H | North (Y) |
| Pause / resume | P, Escape | Start |
| Reset camera (Fit board) | C | — |

- The board takes keys and the pad while no widget has focus: an arrow takes focus off a clicked button and back to the board; Enter/Space on a focused widget is the widget's. Every cursor move is announced ("5,4 empty").
- Pointer: hovering moves the target, a press on the board places the selected piece (tap-to-place). A press on a tray piece selects it and, with **Hold to drag pieces** on, picks it up: the target follows the pointer or finger and the release over the board places it. Touch and the mouse a platform reports for one tap are not counted twice.
- Cards: buttons by pointer, touch, Tab/arrows + Enter, or the pad (South activates, East goes back); Escape / East on a card goes back (on the pause card it resumes; the results card stays).
- Haptics (Settings) vibrate briefly on a placement or a refused one (`input.vibrate`).
- Invalid placements are refused by the rules with a sound and "That cell is blocked or out of bounds."; commands carry ids so a double commit cannot place twice.

### Accessibility

- The runtime's Options › Accessibility give interface size, text size, high contrast and reduced motion; the UI applies them and the bench follows reduced motion (no camera shake, motes, ghost bob, chip bursts or pop scaling; clear plates still fade).
- Full keyboard and pad operation with the engine's focus ring; screen readers hear the widgets and `ui.announce` lines for the objective, lessons, every placement and clear, cursor moves, hints, invalid moves, achievements and the round's end (the browser build's live region and board mirror).
- Colour is reinforced by shape and position; Settings › Color palette offers deuteranopia, protanopia and tritanopia palettes for pieces and clear flashes. Left-handed controls mirror the tray order.
- No audio-only gameplay. Sound volumes and mute are the runtime's Options › Audio.

### Localization and language

- Every player-facing string ships in the nine StarHermit locales (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT) plus Simplified Chinese (zh) from the original release: `src/strings.js` (game strings, read by `t()` in `native/i18n.ts`) and `src/sh-i18n.js` (platform-control strings: sign-in, invite, the leaderboard line; zh carries its own copies). Content data stays English and is named at draw time.
- The language is the runtime's interface language (`preferences().language`: the player's choice in Options, else the device's), mapped to the nearest supported locale (`en-AU → en-GB`, `es-MX → es-419`, `fr-CA`, `zh-* → zh`); a change relabels everything on the next frame (the UI is rebuilt every frame) and the round keeps running. The game no longer has its own language select.
- `tests/i18n.test.js` checks every key the native client uses in every locale, with matching placeholders.

## 4. Visual and audio design

### Visual contract

The subject is the active playfield at near-tabletop to room scale, framed so state changes occupy most of the screen. The scene is a handcrafted wooden puzzle bench. Use an authored camera, original procedural geometry, restrained environmental storytelling, and a deterministic visual seed. The no-post-processing baseline must still communicate hierarchy, depth, selection, and state.

### Scene design

- Use physically based lighting and color management with one dominant key, soft environment fill, and contact grounding. Gameplay colors are tested after tone mapping.
- Build reusable semantic meshes for active pieces, board cells, obstacles, targets, and environment modules. Geometry detail follows silhouette importance and camera distance.
- Use instancing for repeated pieces and props, pooled effects, texture atlases where appropriate, and explicit disposal on scene changes.
- Separate render layers for environment, gameplay, selection/ghosts, effects, and UI anchors. Cosmetic particles never intercept raycasts.
- Selection uses a combination of lift/pose, outline or rim, and grounded marker—not bloom alone. Legal targets preview before commit; invalid targets explain why.
- Event hierarchy: input acknowledgment < legal move < combo/goal < round completion. Reserve camera motion, strong emission, and dense particles for the highest tier.
- Audio uses original short transients tied to logical events, layered material impacts, quiet ambience, and adaptive music stems. Randomized pitch/variant is seeded for replay consistency where recording matters.

### Graphics

**Graphics.** The bench is lit by a warm key light with PCF soft shadows in the page's fitted shadow box, a cool fill and a hemisphere bounce (the three.js r170 page's own intensities), with ACES filmic tone mapping (exposure 1.05); fog follows the fitted camera distance. Effects by preset: three.js's `RoomEnvironment` prefiltered with `PMREMGenerator.fromScene` (environment intensity 0.3) for reflections; a detailed tier with rounded cells and pieces (`native/rounded.ts`, three.js's RoundedBoxGeometry), procedural wood grain as colour and (High, Ultra) as a normal map, offset per instance by a WGSL vertex hook, alternating 3×3 region tones, clearcoat-lacquered pieces, a raised frame and a workshop floor; GTAO (`renderer.ao`); bloom limited to the HDR clear effects (threshold 0.95); the colour grade with vignette (`renderer.grade`, display space); FXAA/SMAA/MSAA; clear effects (a glowing additive plate over every cleared cell and a burst of wood chips); ambient motion (drifting sawdust motes and a ghost bob). The region dividers sit on the 3×3 boundaries.

**Graphics levels.** The runtime's Options › Graphics chooses Auto or one of ten levels (quantum … infinite) and owns render scale, pixel-ratio cap, adaptive steps, the frame-rate limit, shadow-map size and MSAA samples. The game reads `frame().quality` (Low, Balanced, High, Ultra) and `frame().levelIndex` each frame and applies the browser build's preset for that tier (`native/quality.ts`), its chip and mote budgets scaled within the tier by the level (1.64× a level, at most 2×). Board, pieces, hit areas and rules are identical on every level.

| Look | Low | Balanced | High | Ultra |
|---|---|---|---|---|
| Shading | Lambert | Standard | Physical (clearcoat pieces) | Physical |
| Shadows (map, held to the level's cap) | off | 1024 | 2048 | 4096 |
| Ambient occlusion | off | off | on (8 samples, ½ res) | high (16, full) |
| Bloom / grade / reflections / detail / ambient motion | off | on | on | on |
| Anti-aliasing | off | FXAA | SMAA | MSAA |
| Wood grain / relief | — | 256 px / no | 512 px / yes | 1024 px / yes |
| Rounded segments, cells / pieces | — | 2 / 2 | 2 / 3 | 3 / 4 |
| Wood chips per clear (low particles 40 %) | 0 | 32 | 64 | 96 |
| Sawdust motes | 0 | 50 | 90 | 150 |

### Camera and motion

- Choose orthographic or low-distortion perspective according to depth requirements; expose framing constants rather than magic offsets.
- Camera transitions use authored duration/easing or critically damped springs and remain interruptible. Never animate by cumulative per-frame lerp.
- Decorative motion is paused or reduced when hidden. Gameplay animation derives from simulation state and interpolation alpha, not frame count.
- Camera shake is low-amplitude, event-tiered, disabled by reduced motion, and never changes raycast truth.

### Performance budgets

- Target 60 fps at the default tier and a stable 30 fps fallback on constrained mobile hardware.
- Default active gameplay: ≤150 draw calls desktop, ≤90 mobile; ≤350k visible triangles desktop, ≤140k mobile; transient particles ≤20k desktop and ≤5k mobile.
- Cap device pixel ratio by quality tier; dynamically lower render scale before dropping simulation rate. UI text remains native resolution.
- Avoid runtime shader compilation during active play by prewarming required variants. Avoid per-frame allocations in simulation/render loops.
- Quality tiers independently control shadows, environment detail, particles, post effects, antialiasing, and render scale; they never alter rules or visibility of hazards.

## 5. Technical architecture

### Client modules

The game is an engine script game: `starhermit.txt` names `engine.entry=native/main.ts`, `engine.version=1.30.0`, `engine.minor=32`, `engine.capabilities=platform,storage,clipboard`.

- `src/rules.js`, `src/content.js`, `src/session.js`: pure deterministic rules (legality, scoring, seeded offers, replay hashes), versioned content (themes, 40 journey stages, challenges, tutorials, daily seed) and the command/undo/snapshot/replay-envelope layer — shared by the client, `server.js` and the Node tests, unchanged by the port.
- `src/progress.js`: progression defaults, the two-device merge, and the migration of the browser build's cloud save and settings keys.
- `native/main.ts`: lifecycle, the state machine (title → mode select → setup → active ↔ paused → results), placement flow, input wiring.
- `native/screens.ts`: the status bar, rails, tray, toast and cards in `starhermit:ui`; `native/style.ts` registers `assets/ui-style.json` (the browser CSS, `tools/ui-style.css`, converted with `npm run css`) and the theme.
- `native/render.ts` (+ `rounded.ts`, `quality.ts`): the bench on `starhermit:scene`, the look per graphics level, picking by a ray against the board plane.
- `native/audio.ts`: the `sfx/*.opus` one-shots through the engine mixer (interface sounds on the `interface` bus, events on `effects`, the 55 Hz ambience bed on `music`), with synthesized fallbacks while a clip loads.
- `native/platform.ts`: saves, settings, device records, achievements, leaderboards, invite link.
- `native/i18n.ts`: the locale and `t()` / `ts()`.

No module mutates rules state except through a validated session command; the renderer consumes serialized snapshots. UI state and simulation state are separate.

### Determinism, replay, and security

- Fixed simulation step where physics exists; quantize authoritative inputs and define stable collision/order rules.
- Use separate seeded random streams for rules, content decoration, and audiovisual variants. Cosmetic randomness never changes rules.
- Replay envelope: schema version, build/content version, seed, initial hash, timestamp offset, ordered commands, periodic state hashes, terminal result.
- Validate all network input for identity, session membership, turn/tick, bounds, rate, payload size, and legal action. Reject duplicates idempotently by command ID.
- Treat client clocks, scores, inventories, roles, physics outcomes, and completion claims as untrusted in competitive contexts.

### Loading and resilience

- The game starts at once; clips load behind the title and the synthesized sounds cover them meanwhile. The environment is prefiltered off the game's thread and lights the bench a few frames later.
- A daily round in progress is kept on the device (`dailySnapshot`) at every placement and when leaving to the title, and offered as "Daily Challenge — Resume" the same UTC day.
- Hiding the window or tab pauses an active round and flushes the save.

## 6. StarHermit integration

### Packaging and launch
- `npm run package` (`tools/package-web.mjs`, `starhermit package --web .`) writes the loader `index.html` (pinned to engine 1.30.0 on wiki.starhermit.com by hash) and `starhermit-files.json`; both are committed and regenerated after every change. `.starhermitignore` leaves `tests/`, `tools/` and `server.js` out of the package. The browser build (its `index.html`, the three.js vendor copy, `starhermit-sdk.js`, `sh-language.js`, `game-options.js`, `ui-scale.js`, `browser-guard.js`, `src/gpu-level.js` and its DOM modules) was removed; it can be recovered from commit ad21ccb. The browser build had no service worker.
- The runtime signs the player in from the launch (StarHermit client or the page's launch token); a guest sees "Sign in with StarHermit" on the title, which opens the runtime's Account dialog (`requestSignIn`). When the session ends, a toast says progress stays on this device.

### Identity, profile and preferences
- The player chip shows `player().displayName` (or the localized "Guest") and, signed in, the save's sync state (Saving… / Saved / Sync failed).
- The game's own settings — theme, colour palette, left-handed, hold to drag, haptics, finished tutorials — are `starhermit:storage` settings (`game.<key>`, synced with the account). Settings also opens the runtime's Options ("Sound, graphics, language and controls …") for everything the runtime owns. The browser build's per-player settings keys are read once (`settings.legacy`), kept where the game still has the setting and removed from the account.
- Progression (journey stage, bests, achievements, totals) is the game's save (`saves`, schema 1): on the device and in the cloud slot. A conflict between devices is resolved by `mergeProgression` (furthest stage, better bests, earliest unlocks, larger totals); a save the account brings in is adopted with a toast. A slot the browser build wrote (the JS SDK's ZIP with `save.json`, key `game:<slug>`) shows as foreign: its checksummed progression is merged with this device's and saved over it once (`replaceForeign`).
- Device-only (`storage`): ranked-round records, play days, the daily round in progress, anonymous funnel events. A guest's browser-build localStorage progress is not reachable from the engine and does not carry over.
- Report a problem is the runtime's (Options); signed in, "Invite a friend" on the title copies the invite link (fetched ahead) to the clipboard.

### Achievements and leaderboards
- Five achievements (first_clear, combo_master, streak_week, journey_20, marathon), idempotent, kept in the progression and listed in Score Chase.
- Signed in, every finished ranked round (Journey, Daily, Challenge) posts its score to the `high-score` board through `score-script.js`: a practice session (`sessions.practice`) whose game socket carries `{type:'result', scores:{'high-score': n}}`; the results card shows "Posting score to the leaderboard…", then "Leaderboard rank: #N" (or posted / not posted). Score Chase shows the device's ranked records and, signed in, the platform board (top 20, display names from `profile`). Every local record keeps ruleset, content version, seed, assists, duration and the replay verification.

### Sessions and transport
- The game is solo and offline-capable; no rooms, chat or voice.

### Publishing and operations
- The platform script is `score-script.js` (`server=score-script.js`); `server.js` is the local dev host (not packaged). The user publishes; pushing does not publish.

## 7. Content, economy, and retention

- Launch scope: tutorial sequence, at least 40 authored stages or equivalent procedural depth, daily challenge, practice, five visual themes, and a mastery track.
- Cosmetic rewards may alter materials, trails, board surrounds, ambience, or profile flourishes, but never hitboxes, timing windows, information, or power.
- Reward cadence: early feedback every session, meaningful unlock every 3–5 sessions, and long-term goals visible without manipulative countdowns.
- No real-money wagering, paid random rewards, forced advertising, energy pressure, punitive streak loss, or purchases that affect competitive outcomes.
- Notifications, if ever added by the host, are opt-in, frequency-capped, quiet-hour aware, and never use false urgency.

## 8. Analytics and privacy

Measure tutorial completion, first meaningful action time, session duration bands, level attempts, quit state, input modality, performance tier, reconnect success, and accessibility feature usage only in aggregate. Use random session identifiers, short retention, and explicit consent where required. Never collect message content, drawings, voice, private board notes, or exact pointer trails as analytics.

Success targets for the first public test: median first-play time under 20 seconds, tutorial completion above 80%, crash-free sessions above 99.5%, p95 input acknowledgment below 100 ms locally, and at least 95% of supported mobile sessions holding their selected frame-rate tier.

## 9. Testing and acceptance criteria

### Rules and content

- Unit-test every legal action, invalid-action reason, scoring component, terminal state, and serialization migration.
- Property-test deterministic replay: the same version, seed, and commands produce identical state hashes.
- Fuzz malformed commands and generated content; prove no hangs, NaN physics, impossible mandatory states, or unbounded loops.
- Golden-test representative easy, medium, hard, interrupted, resumed, and terminal sessions.

### Interface and accessibility

- `npm test` runs the Node tests (`tests/rules.test.js`, `tests/progress.test.js`, `tests/i18n.test.js`) and `tests/native.mjs`: the web index matches the files, `tsc -p .` passes, `starhermit check .` passes with no warning, and every `tests/native/*.play` script drives the real UI offscreen (`--render-check --guest`): `challenge-round.play` plays Tight Bench to its results with the keyboard (with pause/resume and Score Chase), `journey-stage.play` opens Settings and Help, toggles a setting and clears Journey stage 1.
- `node tools/browser-play.mjs` loads the packaged loader in headless Chrome at 1366×768 (keyboard: Play, Learn, a hint and a placement, the pause card) and 390×844 (taps on the cards, a placement) and fails on console errors or the runtime's error screen; `~/games/tools/engine-web-smoke.mjs` checks start-up.

### Graphics and performance

- Produce fixed-camera captures for every quality tier, deterministic seed sweeps, no-post baselines, debug-view mosaics, and 10-minute temporal stability runs.
- Profile CPU, GPU, memory, shader compilation, draw calls, triangles, texture memory, and garbage collection on representative desktop and mobile classes.
- Verify effects cannot obscure legal targets, alter picking, leak resources, or continue expensive updates while hidden.

### Platform and network

- Test expired/rotated tokens, privacy settings, rate limits, offline start, reconnect at each game state, duplicate commands, out-of-order events, server restart, and version mismatch.
- Verify achievement idempotency, leaderboard validation, friends-only filtering, cloud-save conflict handling, and server-time countdown accuracy.
- For hosted sessions, test disconnect/rejoin, abandonment, timeout, invitation expiry, result reconciliation, replay access, moderation controls, and authoritative cheat attempts.

## 10. Definition of done and non-goals

This specification is ready for implementation when rules examples, content schema, wireframes for all responsive breakpoints, visual target frames, accessibility annotations, authoritative message schema, achievement definitions, leaderboard definitions, and performance test devices are approved.

This document does **not** authorize implementation, asset production, monetization work, native wrappers, real-money systems, or copying any existing product. The initial build should favor one excellent core loop and a coherent original visual identity over feature breadth.
