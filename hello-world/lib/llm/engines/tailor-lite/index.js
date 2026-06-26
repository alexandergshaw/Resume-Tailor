// Single public entrypoint for the deletable tailor-lite module. The engine
// registry imports `embeddedEngine` from here; nothing else in the app reaches
// inside this folder.
export { embeddedEngine, ENGINE_VERSION } from "./engine.js";
