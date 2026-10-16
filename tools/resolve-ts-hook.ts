// A Node ESM loader hook, passed via `--experimental-loader` in the
// `backlog:*` npm scripts in package.json. It exists to resolve ONE thing:
// this directory's own extensionless relative imports (`from "./yaml-codec"`)
// when cli.ts is executed directly by `node --experimental-strip-types`.
//
// Why this has to exist at all: Node's type-stripping deliberately does NOT
// perform extension resolution - every relative specifier needs an explicit,
// real extension, measured directly against this file's own directory:
//
//   import { add } from "./a";      // extensionless - ERR_MODULE_NOT_FOUND
//   import { add } from "./a.ts";   // works, but...
//
// ...`.ts` in an import path is exactly what `npx tsc --noEmit` rejects
// (TS5097) unless `allowImportingTsExtensions` is turned on in tsconfig.json
// - which this task's file list does not include, so it cannot be touched.
// Extensionless imports are what the rest of this repo and vitest both
// already expect, so that is what every module in tools/agnostic-loop/ uses;
// this hook is the one place that teaches the real Node runtime (never
// vitest, which resolves extensionless specifiers on its own and never loads
// this file) to do the same thing tsc and vite already do.
//
// Node's own deprecation notice on `--experimental-loader` points at
// `register()` from `node:module` as the longer-term replacement API; this
// file exports the hook function either way asks for (`resolve`), so it
// works as a `--experimental-loader` target today and could be re-registered
// via `register()` later without changing this file at all.

type ResolveContext = Record<string, unknown>;
type NextResolve = (specifier: string, context: ResolveContext) => Promise<unknown>;

const HAS_EXTENSION = /\.[a-zA-Z0-9]+$/;

export async function resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve): Promise<unknown> {
  if (specifier.startsWith(".") && !HAS_EXTENSION.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Not every extensionless relative specifier is one of ours (a JSON
      // file resolved by its directory, say) - fall through to the normal
      // resolution below rather than masking a real error.
    }
  }
  return nextResolve(specifier, context);
}
