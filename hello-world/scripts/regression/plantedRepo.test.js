// Lane A plantedRepo.js hard-delete refusal (design M-18, §10.3; T3-S9-4). `removePlantedRepo` does a
// recursive, forced filesystem delete gated only by `isPlantedRoot`. Before this file, no `.test.js`
// ever called it with a non-planted path - every existing call runs as teardown against a genuine
// planted root, so the refusal itself had never been exercised.
import { describe, test, expect } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { materializePlantedRepo, removePlantedRepo, isPlantedRoot, PLANTED_PREFIX } from './plantedRepo.js';

describe('removePlantedRepo hard-delete refusal (T3-S9-4)', () => {
  test('refuses a path outside os.tmpdir() entirely, and creates/deletes nothing', () => {
    const target = join(process.cwd(), 'definitely-not-a-planted-root-xyz');
    expect(isPlantedRoot(target)).toBe(false);
    expect(existsSync(target)).toBe(false);
    expect(() => removePlantedRepo(target)).toThrow(/not a planted root/);
    expect(existsSync(target)).toBe(false);
  });
  test('refuses a real directory inside os.tmpdir() that lacks the rt-t3-fixture- segment', () => {
    const decoy = mkdtempSync(join(tmpdir(), 'not-a-t3-fixture-'));
    try {
      expect(isPlantedRoot(decoy)).toBe(false);
      expect(() => removePlantedRepo(decoy)).toThrow(/not a planted root/);
      expect(existsSync(decoy)).toBe(true);
    } finally {
      rmSync(decoy, { recursive: true, force: true });
    }
  });
  test('[positive control] removes a genuine planted root (the guard does not block a legitimate delete)', () => {
    const { root } = materializePlantedRepo({ entries: [], corpusOnly: true });
    expect(existsSync(root)).toBe(true);
    expect(root.includes(PLANTED_PREFIX)).toBe(true);
    expect(isPlantedRoot(root)).toBe(true);
    const result = removePlantedRepo(root);
    expect(result).toEqual({ removed: resolve(root) });
    expect(existsSync(root)).toBe(false);
  });
});
