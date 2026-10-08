// @vitest-environment jsdom
//
// The mount-time speech-to-text provider probe, extracted from CopilotClient.js
// with its behaviour unchanged. What it must keep doing: ask the token route's
// GET handler (never the POST, which mints a credential), map the provider to
// its display name, and say nothing (null) for an unknown provider or any
// failure -- a failed probe is not an error the user needs to see.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { useSttProviderName } from "./useSttProviderName.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NAMES = { deepgram: "Deepgram", elevenlabs: "ElevenLabs" };

let container;
let root;
let seen;
function Probe() {
  seen = useSttProviderName(NAMES);
  return null;
}

async function mount() {
  await act(async () => {
    root.render(createElement(Probe));
  });
  for (let i = 0; i < 4; i += 1) await act(async () => {});
}

beforeEach(() => {
  seen = undefined;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("useSttProviderName", () => {
  it("[positive control] reads the provider with a GET and returns its display name", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ provider: "elevenlabs" }) }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/copilot/token", { method: "GET" });
    expect(seen).toBe("ElevenLabs");
  });

  it("returns null for a provider the map does not know", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ provider: "mystery" }) })));
    await mount();
    expect(seen).toBeNull();
  });

  it("returns null when the route answers with an error status or the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ provider: "deepgram" }) })));
    await mount();
    expect(seen).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect(seen).toBeNull();
  });

  it("probes once on mount, not once per render", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ provider: "deepgram" }) }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    await act(async () => {
      root.render(createElement(Probe));
    });
    await act(async () => {
      root.render(createElement(Probe));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seen).toBe("Deepgram");
  });

  it("does not set state after unmount (a response that lands late is ignored)", async () => {
    let release;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ ok: true, json: async () => ({ provider: "deepgram" }) });
          }),
      ),
    );
    await mount();
    expect(seen).toBeNull();
    await act(async () => root.unmount());
    await act(async () => {
      release();
    });
    // No throw / no act warning escaping; the value the last render saw is unchanged.
    expect(seen).toBeNull();
    root = createRoot(container);
  });
});
