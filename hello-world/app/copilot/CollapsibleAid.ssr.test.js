// N144a T2/C13 — CollapsibleAid renders to string with no window (plan §7.2,
// risk R14). Its own file because T2 is jsdom and this must run with NO DOM:
// the default node environment, where `window`/`matchMedia`/`localStorage`
// are all absent, which is what a server render actually sees.
//
// useIsMobile() is noSsr and useSyncExternalStore reads getServerSnapshot, so
// the server render must resolve to a value and not throw. AnswerAids only
// mounts after an answer exists (client state), so a full hydration mismatch is
// out of scope; this pins the weaker, real claim: it renders server-side at all.
//
// RED on HEAD: the component does not exist, so the import throws.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ThemeProvider } from "@mui/material/styles";

import { makeTheme } from "@/app/theme/index.js";
import { createChoiceStore } from "@/lib/copilot/choiceStore.js";
import CollapsibleAid from "./CollapsibleAid.js";

describe("CollapsibleAid — server render", () => {
  it("renders to string without a window and includes the label", () => {
    const store = createChoiceStore({
      storageKey: "copilot-ssr-aid",
      defaultValue: null,
      normalize: (v) => (v === "open" || v === "closed" ? v : null),
      crossWindow: true,
    });
    let html;
    expect(() => {
      html = renderToString(
        createElement(
          ThemeProvider,
          { theme: makeTheme("light") },
          createElement(CollapsibleAid, { label: "Tech buzzwords", choiceStore: store }, createElement("p", null, "body")),
        ),
      );
    }).not.toThrow();
    expect(html).toContain("Tech buzzwords");
  });
});
