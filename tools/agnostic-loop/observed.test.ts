import { expect, it } from 'vitest';
import { applyApprovedPatch } from './observed';
import { digest } from './json';
it('applies exact approved UTF-8 byte ranges rather than character offsets or prose', () => {
  const original = Buffer.from('caf\u00e9'); const expected = Buffer.from('cafe');
  expect(applyApprovedPatch(original,{originalHash:digest(original),replacements:[{start:3,end:5,text:'e'}],expectedHash:digest(expected)})).toEqual(expected);
  expect(() => applyApprovedPatch(original,{originalHash:digest(original),replacements:[{start:3,end:4,text:'e'}],expectedHash:digest(expected)})).toThrow('expected hash');
  expect(() => applyApprovedPatch(original,{originalHash:digest(original),replacements:[{start:4,end:9,text:'e'}],expectedHash:digest(expected)})).toThrow('bounds');
});
