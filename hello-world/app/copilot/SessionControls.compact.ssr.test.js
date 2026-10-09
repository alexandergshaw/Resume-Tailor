// N144b M2 / C10 — SessionControls' compact branch renders to a string with no
// window. Its own file (NOT the jsdom one) so it runs in the repo's DEFAULT
// node environment, where `window`/`matchMedia`/`localStorage` are all absent —
// what a server render actually sees. Precedent: CollapsibleAid.ssr.test.js.
//
// The module-scope choice store the tuck uses hydrates at import time; its
// factory guards on `typeof localStorage === "undefined"`, so neither the
// import nor a compact server render may throw. This is a REGRESSION GUARD: it
// passes on HEAD (today SessionControls renders fine server-side), and its job
// is to stay green once the store and CollapsibleAid are added — a store that
// touched storage at module scope, or a CollapsibleAid rendered unguarded,
// would turn it red.
//
// RED on HEAD only in the sense that the compact branch does not exist yet, so
// this exercises the current inline render server-side; it becomes a true guard
// of the new branch once M2 lands. Disclosed as a guard in the notes artifact.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ThemeProvider } from "@mui/material/styles";

import { makeTheme } from "@/app/theme/index.js";
import SessionControls from "./SessionControls.js";

const props = {
  live: true,
  stop: () => {},
  onStartSession: () => {},
  status: "live",
  startedAt: 1_000,
  elapsed: 0,
  autoDraft: true,
  setAutoDraft: () => {},
  copyTranscript: () => {},
  clearAll: () => {},
  finals: [{ text: "x" }],
  questions: [{ id: 1 }],
  downloadLog: () => {},
  sessionLogHasEvents: true,
  compact: true,
};

describe("SessionControls — compact server render", () => {
  it("renders to string without a window and includes the Stop control", () => {
    let html;
    expect(() => {
      html = renderToString(
        createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(SessionControls, props)),
      );
    }).not.toThrow();
    // The inline control that is present in every state — a minimal proof the
    // tree rendered rather than a specific tucked-vs-inline claim (that is the
    // jsdom file's job; SSR has no viewport to decide the disclosure default).
    expect(html).toContain("Stop");
  });
});
