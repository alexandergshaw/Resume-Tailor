// The NDJSON response wrapper behind /api/copilot/answer's streaming branch,
// moved out of app/api/copilot/answer/route.js purely to keep that file inside
// the band route.wiring.test.js pins (the route had to grow for N162's additive
// coding section, and this is the one block of it that is a function of its
// arguments alone: no Supabase client, no Gemini client, no request). The same
// move answerPrompts.js, answerAids.js and answerContext.js made out of that
// file earlier. Behaviour-preserving to the byte: the body below is what the
// route held, comment included. `streamAnswer`, named below, is still the
// route's own function and the only caller.
//
// Wraps a NDJSON body around `producer`, which writes `{t:"points",...}` /
// `{t:"done",...}` / `{t:"error",...}` frames via `write`.
//
// WHAT THIS DOES AND DOES NOT PROMISE. `ReadableStream` calls `start()`
// synchronously from its own constructor and does not await it, so this
// function returns its Response as soon as `producer` reaches its first
// await: the CONNECTION opens immediately, with no posting lookup ahead of
// it. That is the whole of the guarantee. It
// says nothing about when the first `points` frame arrives, and the caller
// is what decides that — `streamAnswer` deliberately does its
// company-facts wait (up to lib/copilot/answerCompanyFacts.js's deadline)
// inside the producer.
//
// The sentence this replaces claimed the first points frame "is never sat
// behind anything but the model call itself". That stopped being true the
// moment AC-V4's facts deadline was awaited in POST, ahead of the
// stream-vs-not branch — by up to 2.5s, on the request a candidate is
// actively staring at. Moving the wait in here is what makes the connection
// half true again; overstating the frame half is what let the regression go
// unnoticed, so the two are now stated apart.
export function ndjsonResponse(producer) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (frame) => controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
      try {
        await producer(write);
      } catch (err) {
        // Safety net only — `producer` (streamAnswer) already catches its own
        // failures and writes an `error` frame itself. This guards against a
        // bug in producer leaving the stream open with no terminal frame.
        write({ t: "error", error: err?.message || "Answer request failed." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
