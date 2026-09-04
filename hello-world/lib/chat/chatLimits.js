// The one request-size constant BOTH lib/chat/chatbot.js and
// lib/chat/refusal.js need, in a module that imports neither of them.
//
// WHY IT LIVES HERE RATHER THAN IN chatbot.js. A2's extraction left
// refusal.js importing MAX_REQUEST_BYTES back from chatbot.js while
// chatbot.js imports the refusal vocabulary from refusal.js -- a genuine
// import cycle. It happened to WORK in both entry orders, because every use
// of the constant inside refusal.js is deferred until call time
// (`refusalMessageFor`, never top-level). That is not a property anyone
// should have to re-derive: one future top-level use of the constant in
// refusal.js -- or a transform that emits `var` for the `const` binding --
// yields `undefined` at module-evaluation time, and `totalBytes - largest >
// undefined` is ALWAYS FALSE, which silently disables AC-52's whole
// multiple-sections branch with nothing red anywhere. There is no
// `import/no-cycle` rule in this repo's eslint config to catch it either.
//
// This is MDN's own prescription for a cycle ("move the shared value into a
// third module both import"), and it costs one file.
//
// WHY 4_500_000, separating what's DOCUMENTED from what's INFERRED. An
// earlier version of this comment stated the inference below as settled
// fact -- it isn't, even though the conclusion (the constant) is still right.
//
// DOCUMENTED: Vercel's own docs give the request body limit as "4.5 MB", with
// no stated unit base (decimal vs. binary). AWS documents Lambda's
// synchronous-invocation payload limit as 6 MiB -- and documents the
// request-line/header/cookie limit as a SEPARATE quota row, not part of that
// 6 MiB body figure.
//
// INFERRED, and only an inference: that the body Vercel forwards to Lambda
// arrives base64-encoded. Neither company's docs say so either way. IF it
// does, the arithmetic ceiling is 6 MiB x 3/4 = 4_718_592 bytes -- exactly
// 4.5 MiB the BINARY reading, which lines up with Vercel's stated "4.5 MB"
// well enough to be a reasonable guess at what they mean, not a derivation
// from a sourced mechanism. A second, weaker inference this comment used to
// make -- that the same 6 MiB envelope also carries the request line, headers
// and cookies, leaving a usable body budget somewhat below 4_718_592 -- does
// NOT hold up: AWS lists those as the separate quota noted above, not a slice
// of the body limit. That justification has been dropped here; it doesn't
// follow from anything documented.
//
// The constant STAYS at 4_500_000 regardless of whether the base64 inference
// is right, because it sits safely under Vercel's documented "4.5 MB" either
// way -- the margin is deliberate slack against an unconfirmed mechanism, not
// a number derived from one. Cost of that choice, stated honestly: a body in
// [4_500_000, ~4_718_592) may be refused client-side even though the platform
// would have carried it. Raising the number toward the inferred ceiling trades
// that false refusal for a real 413 whose message is worse.
export const MAX_REQUEST_BYTES = 4_500_000;
