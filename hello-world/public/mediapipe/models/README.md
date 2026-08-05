# MediaPipe model files (committed)

These two `.task` files are Google's official MediaPipe Tasks Vision model bundles, committed
here so the practice-copilot's body-language measurement (`lib/copilot/bodyLandmarks.js`) runs
fully on-device: `FilesetResolver`/the landmarker options point at these local paths, and neither
file (nor the wasm runtime staged alongside them at `public/mediapipe/wasm/` by
`scripts/copy-mediapipe.mjs`) is ever fetched from `storage.googleapis.com` or any other CDN at
runtime. See AC-D2-1. **Also see "MediaPipe telemetry" below** — the installed package version
independently calls a Google logging endpoint that has nothing to do with the models/wasm above,
and `bodyLandmarks.js` has to actively block it for "fully on-device" to actually be true.

Both are the smallest/"lite" variant Google publishes where one exists — accuracy is more than
sufficient for a seated head-and-shoulders webcam shot, and repo weight is a real, ongoing cost.

## face_landmarker.task

- Task: face landmark detection with blendshapes and the facial transformation matrix (yaw/
  pitch/roll input for `lib/copilot/bodyLanguage.js`'s `headOrientation`).
- Variant: the only bundle Google publishes for this task (it already bundles the lite face
  detector + face mesh + blendshape models — there is no separate "lite" face_landmarker build).
- Precision: float16.
- Version: `1` (the first/only pinned version MediaPipe has published under this path as of
  writing — `1` in the URL below is a literal path segment, not a placeholder).
- Source URL:
  `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`
- File size: 3,758,596 bytes (3.58 MiB).
- MD5: `b0e7274907a1644404fef66b28dd6d85` (matches the `x-goog-hash` header served alongside the
  file at the URL above — check with `curl -sI <url>` before re-fetching if you want to confirm
  the upstream file hasn't changed).
- Re-fetch with:
  `curl -sS -o public/mediapipe/models/face_landmarker.task "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"`

## pose_landmarker_lite.task

- Task: pose landmark detection (33-point BlazePose topology — shoulders, wrists, nose, etc. —
  used by `lib/copilot/bodyLanguage.js`'s `postureFrom`/`gestureActivity`).
- Variant: **lite** (Google also publishes `pose_landmarker_full` and `pose_landmarker_heavy` —
  deliberately not used here; the accuracy gain over lite doesn't matter for a seated shot and
  both are meaningfully larger).
- Precision: float16.
- Version: `1`.
- Source URL:
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
- File size: 5,777,746 bytes (5.51 MiB).
- MD5: `04a75ddf7c811ac7a1a4523266dd7d88` (same verification approach as above).
- Re-fetch with:
  `curl -sS -o public/mediapipe/models/pose_landmarker_lite.task "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"`

## Total committed size

3,758,596 + 5,777,746 = 9,536,342 bytes (~9.10 MiB / ~9.54 MB) across the two files above.

## Licence

The MediaPipe project (code and published model assets, including these two files) is licensed
under the **Apache License, Version 2.0** — see
https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE. Google's MediaPipe Solutions
documentation pages (the guides these files were sourced from) are separately licensed under the
**Creative Commons Attribution 4.0 License**; that CC-BY-4.0 licensing covers the *documentation
text*, not these binary model files themselves.

Model provenance/attribution and Google's model cards:
- Face Landmarker guide: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker
- Pose Landmarker guide: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker

## What is deliberately NOT committed here

The MediaPipe Tasks Vision **wasm runtime** is intentionally not committed. It is copied out of
the installed `@mediapipe/tasks-vision` npm package into `public/mediapipe/wasm/` by
`scripts/copy-mediapipe.mjs` (wired into `package.json`'s `prebuild` AND `predev` scripts, so
both `npm run build` and a fresh `npm install && npm run dev` stage it automatically) every time
the app is built or the dev server starts, which keeps it version-locked to whatever
`@mediapipe/tasks-vision` version is actually installed — a committed copy would silently drift
out of sync the next time that dependency is bumped. Run `npm run copy-mediapipe` to stage it
locally without doing a full build or starting dev.

Only `vision_wasm_internal.{js,wasm}` (the SIMD build `FilesetResolver.forVisionTasks()` actually
requests when called without `useModule: true`, as `lib/copilot/bodyLandmarks.js` does — confirmed
empirically via a browser network trace, see below) and `vision_wasm_nosimd_internal.{js,wasm}`
(kept defensively for browsers without WASM SIMD, which the loader can fall back to at runtime;
that fallback path itself wasn't reachable to confirm directly in this repo's own SIMD-capable
dev browser) are copied — not `vision_wasm_module_internal.{js,wasm}` (the ES-module build, only
used when `useModule` is explicitly `true`, and, at ~11.5 MiB, the largest of the three pairs).
`scripts/copy-mediapipe.mjs` asserts each of the four required files is present after copying and
fails loudly if the installed package's layout ever changes.

## MediaPipe telemetry (and why `bodyLandmarks.js` patches `fetch`)

**Finding:** `@mediapipe/tasks-vision@1.0.1`'s `vision_bundle.mjs` contains a built-in usage-stats
logger that batches events and POSTs them to `https://odml.pa.googleapis.com/v1/log` — either on a
60-second timer, or immediately when a landmarker's `close()` is called (see the `Fh` class's
`flush()`/`close()` methods in the bundle). `vision.d.ts` declares an `enableLogging(options:
TaskRunnerOptions): void` method on the base `TaskRunner` class that reads like the intended
opt-out point, but it **does not exist on the actual runtime object in the shipped 1.0.1 bundle**
(the declared method has no corresponding implementation) — there is no supported way to disable
this logging in this version.

This matters more here than it normally would: the entire point of this feature is that it runs
locally on every engine, including embedded, specifically so a user who wants no data leaving
their browser can choose it on that basis. Shipping a "fully on-device" feature that phones home
to Google would be exactly the false claim this project has already had to fix in its privacy
copy before.

**Fix:** `lib/copilot/bodyLandmarks.js` installs a narrowly-scoped `fetch` patch
(`installTelemetryGuard`/`removeTelemetryGuard`) before the landmarkers are created: any request
whose hostname matches `odml.pa.googleapis.com` (matched by `isMediaPipeTelemetryUrl`, a small
exported pure function so the matching logic itself is unit-testable without touching `fetch`) is
answered LOCALLY with a synthetic, empty `204` response instead of being sent — the library sees
its logging call "succeed" and moves on, and nothing about it leaves the browser. Every other
request passes straight through untouched. The guard is installed once, lazily, on first model
load, and stays installed for the page's life once a load succeeds (removed only if the load
attempt that installed it ends up failing outright, since nothing is then relying on it).

**Verified empirically**, not assumed: a throwaway browser harness (not part of this diff) loaded
the real installed package against the real staged `/mediapipe/wasm`/`/mediapipe/models` assets,
ran several `detectForVideo` inference ticks on a synthetic canvas frame (proving inference still
works with the patch installed), then called `close()` on both landmarkers to force an immediate
flush. With the guard installed, the guard's own interception log fired exactly twice (once per
landmarker's `close()`) and the browser's network log recorded no request to
`odml.pa.googleapis.com` at all. As a control, a direct unguarded `fetch()` to that exact URL from
the same browser returned a real HTTP `403` from Google's server — confirming the host genuinely
is reachable from this environment (i.e. that the guarded run's silence was the patch working, not
the network being unavailable) and that the interception, not the network, is what stopped it.

**If a future version of `@mediapipe/tasks-vision` implements the documented `enableLogging`
opt-out** (check its `vision.d.ts`/bundle for the option actually taking effect), remove
`installTelemetryGuard`/`removeTelemetryGuard`/`isMediaPipeTelemetryUrl` from
`lib/copilot/bodyLandmarks.js` and pass `enableLogging: false` in the `baseOptions` of both
`createFromOptions` calls instead — the supported mechanism is always preferable to patching a
global once it actually exists.
