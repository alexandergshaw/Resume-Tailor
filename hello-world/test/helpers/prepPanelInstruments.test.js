// @vitest-environment jsdom
//
// INSTRUMENT CANARIES for test/helpers/prepPanelInstruments.js. They prove
// each helper discriminates against a local fixture with a KNOWN answer, so a
// helper that silently returns "" or [] cannot make an N50 assertion pass for
// the wrong reason. Not N50 coverage; green on HEAD by design.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import Box from "@mui/material/Box";
import {
  norm,
  visibleText,
  collapsedBehindAControl,
  hiddenByAncestry,
  accessibleName,
  controlName,
  headingElements,
  headingLevel,
  interactiveBefore,
  follows,
  unpinnedVerticalMargins,
  verticalMargins,
  isDeclaredLength,
  groupNameOf,
} from "./prepPanelInstruments.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(element) {
  await act(async () => root.render(element));
  return container;
}

describe("prepPanelInstruments canaries", () => {
  it("visibleText drops [hidden], aria-hidden and display:none subtrees and keeps prose", async () => {
    const el = await mount(
      createElement(
        "div",
        null,
        createElement("span", null, "shown "),
        createElement("span", { hidden: true }, "hidden-attr "),
        createElement("span", { "aria-hidden": "true" }, "aria-hidden "),
        createElement("span", { style: { display: "none" } }, "display-none"),
      ),
    );
    expect(norm(visibleText(el))).toBe("shown");
  });

  it("MEASURED jsdom fact the N50 disclosure tests rest on: a closed <details> does NOT hide its children by itself, and an authored :not([open]) rule does", async () => {
    const el = await mount(
      createElement(
        "div",
        null,
        createElement("details", { id: "bare" }, createElement("summary", null, "S1"), createElement("div", null, "bare-body")),
        createElement(
          Box,
          { component: "details", id: "ruled", sx: { "&:not([open]) > :not(summary)": { display: "none" } } },
          createElement(Box, { component: "summary" }, "S2"),
          createElement(Box, null, "ruled-body"),
        ),
      ),
    );
    const text = norm(visibleText(el));
    expect(text).toContain("bare-body");
    expect(text).not.toContain("ruled-body");
    expect(text).toContain("S2");
  });

  it("hiddenByAncestry sees a control hidden by its WRAPPER, which visibleText(control) alone cannot", async () => {
    const el = await mount(
      createElement(
        "div",
        null,
        createElement("div", { style: { display: "none" } }, createElement("button", { id: "wrapped" }, "Restore")),
        createElement("div", null, createElement("button", { id: "shown" }, "Restore")),
      ),
    );
    const wrapped = el.querySelector("#wrapped");
    expect(norm(visibleText(wrapped)), "the blind spot this helper exists for").toBe("Restore");
    expect(hiddenByAncestry(wrapped, el)).toBe(true);
    expect(hiddenByAncestry(el.querySelector("#shown"), el)).toBe(false);
  });

  it("collapsedBehindAControl fires on a closed <details> and aria-expanded=false, not on an open one or plain prose", async () => {
    const el = await mount(
      createElement(
        "div",
        null,
        createElement("details", null, createElement("p", { id: "inside" }, "buried")),
        createElement("details", { open: true }, createElement("p", { id: "visible" }, "shown")),
        createElement("div", { "aria-expanded": "false" }, createElement("p", { id: "collapsed" }, "also buried")),
        createElement("p", { id: "plain" }, "plain prose"),
      ),
    );
    const by = (id) => el.querySelector(`#${id}`);
    expect(collapsedBehindAControl(by("inside"), el)).toBe(true);
    expect(collapsedBehindAControl(by("visible"), el)).toBe(false);
    expect(collapsedBehindAControl(by("collapsed"), el)).toBe(true);
    expect(collapsedBehindAControl(by("plain"), el)).toBe(false);
  });

  it("accessibleName prefers aria-labelledby, then aria-label, then visible content; controlName ignores paint visibility", async () => {
    const el = await mount(
      createElement(
        "div",
        null,
        createElement("span", { id: "lbl" }, "Named by reference"),
        createElement("h3", { "aria-labelledby": "lbl" }, "ignored"),
        createElement("h3", { "aria-label": "Named by label" }, "ignored too"),
        createElement("h3", null, "Visible ", createElement("span", { "aria-hidden": "true" }, "(decoration)"), "name"),
        createElement("button", { id: "hid", style: { display: "none" } }, "Restore ", createElement("span", null, "Why this role version 3")),
      ),
    );
    expect(headingElements(el).map(accessibleName)).toEqual(["Named by reference", "Named by label", "Visible name"]);
    const hid = el.querySelector("#hid");
    expect(accessibleName(hid)).toBe("");
    expect(controlName(hid)).toBe("Restore Why this role version 3");
  });

  it("headingElements counts by ROLE, and headingLevel honours aria-level", async () => {
    const el = await mount(
      createElement(
        "div",
        null,
        createElement("h3", null, "real"),
        createElement("h3", { role: "presentation" }, "not a heading"),
        createElement("div", { role: "heading", "aria-level": "4" }, "aria heading"),
      ),
    );
    expect(headingElements(el).map(headingLevel)).toEqual([3, 4]);
  });

  it("interactiveBefore reports a button before the target and not one after it; a summary counts as interactive", async () => {
    const el = await mount(
      createElement(
        "div",
        null,
        createElement("button", null, "before"),
        createElement("details", null, createElement("summary", null, "sum before")),
        createElement("h3", { id: "target" }, "Heading"),
        createElement("button", null, "after"),
      ),
    );
    const target = el.querySelector("#target");
    expect(interactiveBefore(el, target).map((n) => norm(n.textContent))).toEqual(["before", "sum before"]);
    expect(follows(target, el.querySelectorAll("button")[1])).toBe(true);
    expect(follows(el.querySelectorAll("button")[1], target)).toBe(false);
  });

  it("the margin guard bites on a NEW unpinned member and stays silent on a pinned one; the unit is the discriminator", async () => {
    const el = await mount(
      createElement(
        "div",
        null,
        createElement(Box, { component: "p", sx: { m: 0 } }, "pinned"),
        createElement(Box, { component: "figure", sx: {} }, "a new figure nobody pinned"),
      ),
    );
    expect(unpinnedVerticalMargins(el).map((r) => r.text)).toEqual(["a new figure nobody pinned"]);
    expect(verticalMargins(el.querySelector("p")).marginTop).toBe("0px");
    expect(isDeclaredLength(verticalMargins(el.querySelector("figure")).marginTop)).toBe(false);
  });

  it("MEASURED jsdom fact AC-N50.4 rests on: an INHERITED font-size and colour read back from a declaring ancestor; an undeclared one reads the default", async () => {
    const el = await mount(
      createElement(
        "div",
        null,
        createElement(Box, { id: "p", sx: { fontSize: 12.5, color: "var(--text-secondary)" } }, createElement("span", { id: "kid" }, "kid")),
        createElement("span", { id: "bare" }, "bare"),
      ),
    );
    const cs = (id) => getComputedStyle(el.querySelector(`#${id}`));
    expect(cs("kid").fontSize).toBe("12.5px");
    expect(cs("kid").color).toBe("var(--text-secondary)");
    expect(cs("bare").color).not.toBe("var(--text-secondary)");
    expect(cs("bare").fontSize).not.toBe("12.5px");
  });

  it("groupNameOf returns the enclosing role=group's name, and empty outside any group", async () => {
    const el = await mount(
      createElement(
        "div",
        null,
        createElement("div", { role: "group", "aria-label": "Why this role" }, createElement("button", { id: "in" }, "x")),
        createElement("button", { id: "out" }, "y"),
      ),
    );
    expect(groupNameOf(el.querySelector("#in"))).toBe("Why this role");
    expect(groupNameOf(el.querySelector("#out"))).toBe("");
  });
});
