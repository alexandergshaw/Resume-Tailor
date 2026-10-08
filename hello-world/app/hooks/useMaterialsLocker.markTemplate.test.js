// @vitest-environment jsdom
//
// N151a (4b) — the markMaterialAsTemplate handler on useMaterialsLocker
// (plan Step 6). The hook half of the mark flow: derive the template name from
// the material's filename (trailing ".docx" stripped), resolve the bytes (local
// File or a remote download), and POST via registerTemplateFromBytes. This is
// the "remote item fetches bytes FIRST" half of T11 and the "<M minus .docx>"
// naming of T9, measured where the derivation actually happens.
//
// The real hook is mounted (createRoot + act), exactly as the repo's other hook
// wiring tests do. registerTemplateFromBytes (the client) and the materials
// storage fns are mocked so this isolates the handler's own decisions.
//
// RED on HEAD: useMaterialsLocker returns no markMaterialAsTemplate, and
// templateLibraryClient does not exist (module-not-found). GREEN after Steps 5-6.

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
  registerTemplateFromBytes: vi.fn(async () => ({ ok: true, row: { id: "row-new" } })),
}));

import { useMaterialsLocker } from "./useMaterialsLocker.js";
import { downloadMaterialBlob } from "../../lib/supabase/materials";
import { registerTemplateFromBytes } from "../../lib/document/templateLibraryClient";

const REMOTE_BLOB = { __remote: true, type: "" };
const LOCAL_FILE = { name: "My Resume.docx", __local: true };

const USER = { id: "user-1" };
function chatStub() {
  return { setChatOpen: vi.fn(), addChatAttachments: vi.fn(async () => {}) };
}

let container;
let root;
let api;

function Harness({ currentUser }) {
  api = useMaterialsLocker({ currentUser, chat: chatStub() });
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
  registerTemplateFromBytes.mockResolvedValue({ ok: true, row: { id: "row-new" } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api = null;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("markMaterialAsTemplate — name derivation + bytes source (Step 6)", () => {
  it("exposes markMaterialAsTemplate", async () => {
    await mount();
    expect(typeof api.markMaterialAsTemplate, "hook does not expose markMaterialAsTemplate").toBe("function");
  });

  it("a REMOTE .docx item downloads its bytes FIRST, then POSTs with the name minus .docx", async () => {
    await mount();
    await act(async () => {
      await api.markMaterialAsTemplate({ name: "My Resume.docx", source: "remote" });
    });
    expect(downloadMaterialBlob, "remote bytes were not fetched before POST").toHaveBeenCalledTimes(1);
    expect(downloadMaterialBlob.mock.calls[0]).toEqual([expect.anything(), "user-1", "My Resume.docx"]);
    expect(registerTemplateFromBytes).toHaveBeenCalledTimes(1);
    const arg = registerTemplateFromBytes.mock.calls[0][0];
    expect(arg.kind).toBe("resume");
    expect(arg.name).toBe("My Resume"); // trailing .docx stripped, not sanitized/lowercased
    expect(arg.blob).toBe(REMOTE_BLOB); // the bytes it just fetched
  });

  it("a LOCAL .docx item uses its in-session File directly (no download)", async () => {
    await mount();
    await act(async () => {
      await api.markMaterialAsTemplate({ name: "My Resume.docx", source: "local", file: LOCAL_FILE });
    });
    expect(downloadMaterialBlob).not.toHaveBeenCalled();
    expect(registerTemplateFromBytes).toHaveBeenCalledTimes(1);
    expect(registerTemplateFromBytes.mock.calls[0][0].blob).toBe(LOCAL_FILE);
    expect(registerTemplateFromBytes.mock.calls[0][0].name).toBe("My Resume");
  });

  it("[control] a .pdf item NO-OPS — never POSTs (the .docx-only rule, not a generic save)", async () => {
    await mount();
    await act(async () => {
      await api.markMaterialAsTemplate({ name: "transcript.pdf", source: "remote" });
    });
    expect(registerTemplateFromBytes).not.toHaveBeenCalled();
  });

  it("signed out: refuses with a materials error and does not POST", async () => {
    await mount(null);
    await act(async () => {
      await api.markMaterialAsTemplate({ name: "My Resume.docx", source: "remote" });
    });
    expect(registerTemplateFromBytes).not.toHaveBeenCalled();
    expect(api.materialsError, "no sign-in prompt surfaced").toBeTruthy();
  });
});

// WHAT THIS CANNOT CATCH: it stubs the client, so the server-side register+
// select+resolve join is T9, and the button's presence/gate is the
// ApplyingControls mount (T10/T11).
