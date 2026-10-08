"use client";

import { useEffect, useState } from "react";

// Extracted from CopilotClient.js (headroom, NOT a feature: that file sits at its
// 950-line ceiling and the example-pool self-heal wiring needed a few lines).
// Behaviour is unchanged; the comment below is the one the effect carried inline.
//
// `providerNames` maps the token route's `provider` field to the display name the
// notices use (CopilotClient.js's STT_PROVIDER_NAMES). It is passed in rather than
// duplicated here so that map keeps exactly one home next to the notices that
// read it; it must be a stable reference (a module constant), which is how the
// effect below stays a once-on-mount probe.
//
// F2: learn which speech-to-text provider is actually live, purely so the
// privacy notices (and the one PracticeClient renders, which reads this as a
// prop) can name it instead of unconditionally saying "Deepgram" the way they
// used to. Hits the token route's GET handler -- NOT fetchSttToken()'s POST --
// because GET mints nothing: it just answers "which provider?" (see
// app/api/copilot/token/route.js). Using POST here would mint a real credential
// on every page view purely to read `.provider` and then throw it away
// unconnected, which is wasteful on any provider and a genuine loss on
// ElevenLabs, whose token is single-use. This runs ahead of, and separately
// from, whatever a session's own createSttStream call does when a session
// actually starts (see lib/copilot/stt/index.js) -- the whole point is to inform
// the user BEFORE they press Start, not only once a session already exists.
// Errors are swallowed: an unreachable/misconfigured provider surfaces for real
// through the normal onError/onStatus("error") path once a session is actually
// started, and this mount-time probe is not it.
//
// Returns the display name, or `null` until the probe resolves (and for a
// provider the map does not know).
export function useSttProviderName(providerNames) {
  const [sttProviderName, setSttProviderName] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/copilot/token", { method: "GET" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        setSttProviderName(providerNames[body?.provider] || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [providerNames]);
  return sttProviderName;
}
