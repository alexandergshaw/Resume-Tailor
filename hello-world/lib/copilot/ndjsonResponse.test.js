// ndjsonResponse, moved out of app/api/copilot/answer/route.js (see its header).
// The route's streaming suites (streaming.test.js, route.latency.test.js) reach
// it through POST; this pins the three properties of the wrapper itself, so a
// change to it fails here and not several layers away.

import { describe, it, expect } from "vitest";
import { ndjsonResponse } from "./ndjsonResponse.js";
import { splitFrames } from "./answerStream.js";

describe("ndjsonResponse", () => {
  it("writes every frame as one JSON line, with the NDJSON content type", async () => {
    const res = ndjsonResponse(async (write) => {
      write({ t: "points", points: ["a"] });
      write({ t: "done", points: ["a", "b"] });
    });
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
    const body = await res.text();
    expect(body).toBe('{"t":"points","points":["a"]}\n{"t":"done","points":["a","b"]}\n');
    expect(splitFrames(body).frames).toEqual([
      { t: "points", points: ["a"] },
      { t: "done", points: ["a", "b"] },
    ]);
  });

  it("returns its Response before the producer's first await settles (the connection opens at once)", () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const res = ndjsonResponse(async () => {
      await gate;
    });
    // Reached synchronously, while the producer is still parked on `gate`.
    expect(res).toBeInstanceOf(Response);
    release();
  });

  it("turns a throwing producer into one terminal error frame and still closes the stream", async () => {
    const res = ndjsonResponse(async () => {
      throw new Error("producer blew up");
    });
    expect(splitFrames(await res.text()).frames).toEqual([{ t: "error", error: "producer blew up" }]);
  });

  it("falls back to a generic message when the thrown value carries none", async () => {
    const res = ndjsonResponse(async () => {
      throw {};
    });
    expect(splitFrames(await res.text()).frames).toEqual([{ t: "error", error: "Answer request failed." }]);
  });
});
