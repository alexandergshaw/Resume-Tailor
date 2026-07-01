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
  ]),
]);

export default eslintConfig;
