#!/usr/bin/env node
// Build-time staging of the MediaPipe Tasks Vision wasm runtime: copies the
// wasm loader + binary files out of node_modules/@mediapipe/tasks-vision's
// own `wasm/` directory into public/mediapipe/wasm, so the browser loads
// them from this app's own origin instead of MediaPipe's default
// storage.googleapis.com CDN (see public/mediapipe/models/README.md for why
// that matters, and lib/copilot/bodyLandmarks.js for where the copied path
// is actually used).
//
// Copying (rather than committing this directory, the way the .task model
// files under public/mediapipe/models ARE committed) keeps the wasm runtime
// version-locked to whatever @mediapipe/tasks-vision version is actually
// installed -- a committed copy would silently drift out of sync the next
// time the dependency is bumped, and nothing would catch it.
//
// Wired into package.json's "prebuild" AND "predev" scripts, so both
// `npm run build` and `npm run dev` always run this first on a fresh
// checkout (BUG-11) -- and runnable on its own too
// (`node scripts/copy-mediapipe.mjs` or `npm run copy-mediapipe`).
//
// lib/copilot/bodyLandmarks.js calls `FilesetResolver.forVisionTasks(basePath)`
// WITHOUT `useModule: true`, and verified empirically (see
// public/mediapipe/models/README.md's "MediaPipe telemetry" section, which
// records the browser network trace this was confirmed against) that doing
// so only ever requests `vision_wasm_internal.{js,wasm}` -- never the
// `vision_wasm_module_internal.*` pair (the ES-module build, ~11.5 MiB,
// only used when `useModule` is explicitly true). The `nosimd` pair is kept
// defensively for browsers without WASM SIMD support, which the SIMD/no-SIMD
// feature detection inside vision_wasm_internal.js itself can fall back to
// at runtime -- that fallback wasn't reachable in this repo's own dev/CI
// browser (which supports SIMD) to confirm directly. Only these four are
// copied (BUG-15) -- not the whole wasm/ directory -- and each is asserted
// present after copying (BUG-12), so a future @mediapipe/tasks-vision
// version that renames or drops one of them fails this script LOUDLY
// instead of silently shipping a broken or bloated runtime.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const REQUIRED_WASM_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);

const DEST_DIR = path.join(__dirname, "..", "public", "mediapipe", "wasm");

function resolveWasmSourceDir() {
  // require.resolve("@mediapipe/tasks-vision") gives the package's main
  // entry file (vision_bundle.cjs); its directory is the package root, and
  // the wasm assets live in a `wasm/` subdirectory there. The package's
  // `exports` map deliberately does not expose "./package.json" as an
  // importable subpath, so that shortcut isn't available here.
  const entryFile = require_.resolve("@mediapipe/tasks-vision");
  return path.join(path.dirname(entryFile), "wasm");
}

function main() {
  let srcDir;
  try {
    srcDir = resolveWasmSourceDir();
  } catch (err) {
    throw new Error(
      `copy-mediapipe: could not resolve @mediapipe/tasks-vision -- run "npm install" first. (${err.message})`,
    );
  }
  if (!fs.existsSync(srcDir)) {
    throw new Error(`copy-mediapipe: expected wasm directory not found at ${srcDir}`);
  }

  // Start clean every run so a file left over from a previously installed
  // package version can never linger and silently get served instead of
  // the current one.
  fs.rmSync(DEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEST_DIR, { recursive: true });

  let totalBytes = 0;
  for (const name of REQUIRED_WASM_FILES) {
    const srcPath = path.join(srcDir, name);
    if (!fs.existsSync(srcPath)) {
      throw new Error(
        `copy-mediapipe: expected file "${name}" was not found in ${srcDir} -- the installed ` +
          "@mediapipe/tasks-vision package layout may have changed; update REQUIRED_WASM_FILES " +
          "in this script (and re-verify which files lib/copilot/bodyLandmarks.js's " +
          "FilesetResolver call actually requests) to match.",
      );
    }
    const destPath = path.join(DEST_DIR, name);
    fs.copyFileSync(srcPath, destPath);
    const size = fs.statSync(destPath).size;
    if (size === 0) {
      throw new Error(`copy-mediapipe: copied file "${name}" is empty -- something went wrong staging it.`);
    }
    totalBytes += size;
  }

  const mb = (totalBytes / (1024 * 1024)).toFixed(1);
  console.log(
    `copy-mediapipe: staged ${REQUIRED_WASM_FILES.length} file(s) (${mb} MB) from ${srcDir} to ${DEST_DIR}`,
  );
}

main();
