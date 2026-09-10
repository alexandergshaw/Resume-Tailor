### R-065 | area: body-language | parallel-safe: yes | automatable: yes

**Summary:** The on-device body-language models are served locally and the vendored runtime's telemetry never leaves the browser. An on-device feature that phones home is not on-device.

**Steps:**
1. Read `hello-world/public/mediapipe/models/README.md` and `hello-world/scripts/copy-mediapipe.mjs`.
2. Read the model and wasm paths, and `isMediaPipeTelemetryUrl` plus the fetch guard, in `hello-world/lib/copilot/bodyLandmarks.js`.
3. Run `npx vitest run --no-file-parallelism lib/copilot/bodyLandmarks.test.js` from `hello-world/`.

**Expected:** The `.task` model files are committed under `public/mediapipe/models/` and loaded from that local path; the wasm runtime is staged from the installed package by the copy script rather than committed, so it stays version-locked, and the script asserts the exact files it must produce. No model or wasm is fetched from any CDN at runtime, and the build needs no network access. `@mediapipe/tasks-vision` 1.0.1 ships a telemetry POST to `odml.pa.googleapis.com` with no working opt-out (`enableLogging` is in its type definitions but absent from the shipped bundle), so a scoped guard answers that host locally; `isMediaPipeTelemetryUrl` matches that exact hostname and does NOT match look-alike hosts that merely contain it as a substring or subdomain prefix. The README records the model versions, hashes, licence and re-fetch commands.

### R-066 | area: body-language | parallel-safe: yes | automatable: yes

**Summary:** Posture measurements are geometrically correct. Level shoulders read as level, and the same physical pose measures the same regardless of how close the person sits or what aspect ratio the camera has.

**Steps:**
1. Read `postureFrom` and its threshold constants in `hello-world/lib/copilot/bodyLanguage.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/bodyLanguage.test.js` from `hello-world/`.

**Expected:** Landmark 11 is the subject's ANATOMICAL left shoulder, which in the unmirrored frame the sampler feeds MediaPipe sits at the LARGER image x. Perfectly level shoulders therefore must report a tilt near 0 and never near 180 — the tests build the fixture unmirrored and assert this explicitly, because the original implementation reported 180 for a level sitter and, since the true signal sat on atan2's branch cut, averaged a real wobble down to a fabricated 0. Tilt is symmetric with opposite signs when the lower shoulder swaps sides. Slouch is scale-invariant across distance from the camera, and tilt and slouch are aspect-ratio corrected so a 4:3 and a 16:9 frame agree. Shoulder tilt and lean depend only on the shoulder landmarks — a nose below the visibility threshold may null slouch alone.

### R-067 | area: body-language | parallel-safe: yes | automatable: yes

**Summary:** No body-language figure is reported unless enough of the answer was actually visible. A percentage computed over a handful of detected frames is not a measurement of the answer.

**Steps:**
1. Read `summarizeBodyLanguage`, `MIN_COVERAGE_RATIO` and the per-signal sample minimums in `hello-world/lib/copilot/bodyLanguage.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/bodyLanguage.test.js` from `hello-world/`.

**Expected:** An aggregate is null when the frames that produced it fall below `MIN_COVERAGE_RATIO` of ALL sampled ticks, not merely when an absolute count is unmet — a face detected in a handful of hundreds of ticks yields no confident percentage. Every derived value is null rather than 0 or false below its minimum, and the reported sample counts match the samples actually used. Head-movement deltas are taken only between genuinely consecutive ticks, so a gap where the camera was off or the face was lost does not manufacture movement. A fresh summary object is returned per call. Empty, single-sample and all-invalid input produce no NaN or Infinity anywhere.

### R-068 | area: body-language | parallel-safe: yes | automatable: no

**Summary:** The sampler reports why it could not measure, rather than reporting nothing as if it were a measurement of stillness.

**Steps:**
1. Read `BodyLanguageSampler` in `hello-world/lib/copilot/bodyLandmarks.js`: the failure reasons, the track-active check, the overrun guard, the model cache and `stop()`.
2. Read how `AnswerReview` renders the unavailable state and `partiallyOff`.

**Expected:** Each distinct failure — no camera, camera off, model load failed, no frames, not ready, inference failed, no samples — is reported as its own machine-readable reason, never swallowed into a silent zero. `hadVideo` derives from whether any VALID sample was captured, not from track presence, so a camera switched off for the whole answer reports as off rather than as a dark, motionless shot; a camera off for part of it sets `partiallyOff`, which the UI states. Sampling is skipped while the track is disabled or muted, and while the offscreen video reports zero dimensions or an insufficient readyState. A tick that overruns the interval is skipped rather than queued. The landmarkers are cached across answers, per-answer state is not, a failed load closes what it constructed and retries are bounded, and `stop()` is safe without `start()`, twice, and immediately after `start()`.

