// Pure formatter: a pick() Decision -> the plain-text line(s) printed as SessionStart context.
// Asserted with an exact-string match in its own tests, never a substring — a truncated or
// mis-templated summary is a silent content bug a substring match would miss.

function firstLine(title) {
  return String(title).split("\n")[0];
}

export function formatDecision(decision) {
  switch (decision.type) {
    case "actionable":
      return `Step 0: docs/backlog.yml has an actionable item — ${decision.item.id}: ${firstLine(decision.item.title)} | owns: ${decision.item.owns} | verify: ${decision.item.verify}. Read docs/BACKLOG.md before anything else.`;
    case "unscoped":
      return `Step 0: docs/backlog.yml has ${decision.count} actionable item(s) with no owns/verify yet (${decision.ids.join(", ")}) — scoping one of them is the next action. Read docs/BACKLOG.md before anything else.`;
    case "escalate":
      return `Step 0: no actionable work is pickable. Escalate ${decision.item.id} (${decision.item.state}) to the owner: ${firstLine(decision.item.title)}. Read docs/BACKLOG.md before anything else.`;
    case "empty":
      return "Step 0: docs/backlog.yml is empty. Nothing is owed.";
    default:
      throw new Error(`sessionStartText: unknown decision type ${JSON.stringify(decision.type)}`);
  }
}
