/** A closed outer schema works with strict providers while runtime validates the body. */
export const outcomeSchema = {
  type: 'object', additionalProperties: false,
  properties: { outcomeJson: { type: 'string', description: 'A serialized JSON WorkerOutcome object matching the supplied contract, without Markdown fences.' } },
  required: ['outcomeJson'],
};
