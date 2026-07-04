import { makeCrudHandlers } from "@/lib/llm/engines/tailor-lite/library/crudRoute";
import { validatePersona } from "@/lib/llm/engines/tailor-lite/library/validate";

export const runtime = "nodejs";

const handlers = makeCrudHandlers({ table: "tailor_personas", validate: validatePersona });
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
