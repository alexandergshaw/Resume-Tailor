import { useEffect, useRef } from "react";

// A ref that always holds the value of the latest committed render. An async
// handler (one that awaits a long request before it acts) reads `.current` to see
// the state as it is now, where a plain closure would hold the render it started
// in. The same shape app/hooks/useDocumentPreview.js uses for its tailoringMapRef.
export function useLatestRef(value) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
