import type { Context, LoopState } from './types';
import { assignmentBlockers } from './engine';
import { validateState } from './validation';

export function nextAssignments(state: LoopState, context: Context): { eligible: string[]; blocked: Record<string,string[]> } {
  const s = validateState(state), eligible: string[] = [], blocked: Record<string,string[]> = {};
  for (const item of Object.values(s.items).sort((a,b) => a.id.localeCompare(b.id))) {
    const reasons = assignmentBlockers(s,item,context);
    if (reasons.length) blocked[item.id] = reasons; else eligible.push(item.id);
  }
  return { eligible, blocked };
}
