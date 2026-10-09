// @vitest-environment jsdom
//
// N151b (4b) — T6 / R10: a template marked from the materials section must make
// the switcher panel refresh, so the just-added template appears as the active
// one without a manual reload. The wiring: page.js passes
// onTemplatesChanged = templateLibrary.refresh into useMaterialsLocker, and the
// hook calls it after a SUCCESSFUL mark (markMaterialAsTemplate). The real hook is
// mounted (createRoot + act), mirroring useMaterialsLocker.markTemplate.test.js.
//
// RED on HEAD: useMaterialsLocker accepts only { currentUser, chat } and never
// calls an onTemplatesChanged callback, so the spy is never invoked. GREEN after
// Step 5.
//
// Mutation that must RED: detach onTemplatesChanged from the mark success path.
// No-op CONTROL that must survive: a .pdf mark is a no-op and must NOT fire the
// callback; a FAILED mark (client returns { ok:false }) must NOT fire it either —
// the refresh is tied to success, not to every click.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/supabase/client", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("../../lib/supabase/materials", () => ({
  listMaterials: vi.fn(async () => []),
  uploadMaterial: vi.fn(async () => ({})),
  downloadMaterialBlob: vi.fn(async () => ({ blob: REMOTE_BLOB })),
  removeMaterial: vi.fn(async () => ({})),
  safeMaterialName: (n) => n,
}));
vi.mock("../../lib/document/templateLibraryClient", () => ({
  registerTemplateFromBytes: vi.fn(async () => ({ ok: true, row: { id: "row-new" }, selected: true })),
}));

import { useMaterialsLocker } from "./useMaterialsLocker.js";
import { downloadMaterialBlob } from "../../lib/supabase/materials";
import { registerTemplateFromBytes } from "../../lib/document/templateLibraryClient";

const REMOTE_BLOB = { __remote: true, type: "", size: 10 };
const USER = { id: "user-1" };
function chatStub() {
  return { setChatOpen: vi.fn(), addChatAttachments: vi.fn(async () => {}) };
}

let container;
let root;
let api;
let onTemplatesChanged;

function Harness({ currentUser }) {
  api = useMaterialsLocker({ currentUser, chat: chatStub(), onTemplatesChanged });
  return null;
}
async function mount(currentUser = USER) {
  await act(async () => {
    root.render(createElement(Harness, { currentUser }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  downloadMaterialBlob.mockResolvedValue({ blob: REMOTE_BLOB });
  registerTemplateFromBytes.mockResolvedValue({ ok: true, row: { id: "row-new" }, selected: true });
  onTemplatesChanged = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api = null;
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("mark refreshes the template panel (T6 / R10)", () => {
  it("a SUCCESSFUL .docx mark calls onTemplatesChanged", async () => {
    await mount();
    await act(async () => {
      await api.markMaterialAsTemplate({ name: "My Resume.docx", source: "remote" });
    });
    expect(registerTemplateFromBytes).toHaveBeenCalledTimes(1);
    expect(onTemplatesChanged, "a marked template did not refresh the panel").toHaveBeenCalledTimes(1);
  });

  it("[control] a .pdf is a no-op and does NOT refresh the panel", async () => {
    await mount();
    await act(async () => {
      await api.markMaterialAsTemplate({ name: "transcript.pdf", source: "remote" });
    });
    expect(registerTemplateFromBytes).not.toHaveBeenCalled();
    expect(onTemplatesChanged).not.toHaveBeenCalled();
  });

  it("[control] a FAILED mark does NOT refresh the panel (success-only)", async () => {
    registerTemplateFromBytes.mockResolvedValue({ ok: false, error: "You already have a template named \"My Resume\"." });
    await mount();
    await act(async () => {
      await api.markMaterialAsTemplate({ name: "My Resume.docx", source: "remote" });
    });
    expect(registerTemplateFromBytes).toHaveBeenCalledTimes(1);
    expect(onTemplatesChanged).not.toHaveBeenCalled();
  });
});
