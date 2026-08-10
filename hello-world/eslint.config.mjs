import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Guard: in the MUI version this app pins, flex props passed as JSX attributes on
  // Stack/Box/etc. are IGNORED (they must go inside `sx`). Passing e.g.
  // `<Stack alignItems="center">` silently does nothing — which produced the
  // oversized/mis-positioned Library buttons. Flag it so it can't regress.
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      // eslint-config-next leaves `no-undef` off (it assumes TypeScript does
      // this job, and this project has no tsconfig — see the development-loop
      // note that `tsc --noEmit` is vacuous here). That left a whole class of
      // defect with no gate at all: `usePracticeAnswer.js` shipped on main
      // referencing an undeclared `replayUrl`/`setReplayUrl`, which took
      // practice mode down with a ReferenceError on first render. It passed
      // lint, passed `npm run build` (an undeclared reference is legal syntax,
      // not a compile error), and passed 2816 tests, because vitest runs with
      // `environment: "node"` and no jsdom, so no test in this repo can render
      // a component or a hook. This rule is the only thing that catches it.
      "no-undef": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXOpeningElement[name.name=/^(Stack|Box|Grid|Grid2|Paper|Card|CardContent|CardActions|Container|Toolbar)$/] > JSXAttribute[name.name=/^(justifyContent|alignItems|alignContent|justifyItems|flexWrap|flexDirection|alignSelf|justifySelf)$/]",
          message:
            "Flex props are ignored as JSX attributes on MUI layout components in this MUI version — put them inside sx={{ … }} instead (e.g. sx={{ alignItems: 'center' }}).",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated (never committed -- see .gitignore) MediaPipe wasm runtime,
    // staged here at build/dev time by scripts/copy-mediapipe.mjs from the
    // installed @mediapipe/tasks-vision package -- third-party vendor JS,
    // not this app's source, same reasoning as the .next/** build output
    // above.
    "public/mediapipe/wasm/**",
  ]),
]);

export default eslintConfig;
