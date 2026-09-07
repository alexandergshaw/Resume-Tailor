// THE PLANTED SECRETS.
//
// One shared fixture, because a redaction function whose tests never feed it a
// secret is vacuous -- that exact defect shipped in this repo and only mutation
// caught it. Every entry is a real credential SHAPE for something this app
// actually holds; `literal` is the string that must never appear in any
// downloadable artifact, and `where` names the surface it arrives on.
//
// It lives under test/helpers/ rather than beside the modules it tests for a
// measured reason: lib/sourceScan/exportReachability.sweep.test.js classifies
// anything under test/ as a test file, so this fixture needs no shipping
// importer -- while a .js under lib/ with no shipping importer would (rightly)
// fail that sweep, and importing it from a sibling .test.js would re-execute
// that file's whole describe tree.
export const PLANTED_SECRETS = [
  {
    id: "supabase-anon-jwt",
    where: "NEXT_PUBLIC_SUPABASE_ANON_KEY, and the access_token inside sb-*-auth-token",
    literal:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTcwMDAwMDAwMH0.QmxhaEJsYWhTaWduYXR1cmVHb2VzUmlnaHRIZXJlMTIz",
  },
  {
    id: "supabase-service-role",
    where: "SUPABASE_SERVICE_ROLE_KEY (server-only, but an error message can echo it)",
    // DO NOT make this body look realistic again. A previous version used a
    // token-shaped run of lowercase hex, and GitHub's push protection --
    // correctly -- refused the whole push as a leaked Supabase Personal Access
    // Token. The body below is deliberately shouty and non-hex so no scanner
    // mistakes it for a live credential, while still exercising the rule under
    // test: activityRedaction.js's named pattern is
    // /\bsb[a-z]?[-_][A-Za-z0-9_-]{16,}/, which accepts underscores and
    // uppercase, so this literal is still redacted exactly like the real shape.
    // The push-protection gate IS the check that keeps this honest -- it fails
    // loudly, unlike a comment asking the next editor to be careful.
    literal: "sbp_EXAMPLE_FIXTURE_NOT_A_REAL_TOKEN_00000",
  },
  {
    id: "gemini-api-key",
    where: "GEMINI_API_KEY, echoed verbatim by some Google SDK errors",
    literal: "AIzaSyD-1234567890abcdefghijklmnopqrstuvw",
  },
  {
    id: "openai-style-key",
    where: "an STT or model provider key from the sk-/pk- family",
    literal: "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD",
  },
  {
    id: "bearer-header",
    where: "an Authorization request header",
    literal: "Bearer 9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c",
  },
  {
    id: "session-cookie",
    where: "document.cookie / a Set-Cookie response header",
    literal: "sb-abcdefghijklmnop-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJzZWNyZXQifQ",
  },
  {
    id: "password",
    where: "a sign-in form field",
    literal: "hunter2-correct-horse-battery-staple",
  },
  {
    id: "refresh-token",
    where: "the refresh_token in a Supabase auth response",
    literal: "v1.MRq7Xk3pLd0aZbY9-refresh-token-value-here",
  },
];

export const secretLiteral = (id) => PLANTED_SECRETS.find((s) => s.id === id).literal;
