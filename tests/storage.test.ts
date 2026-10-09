import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { INITIAL_POSITION } from '../src/data/schoolCase';
import { clearProgress, createProgress, loadProgress, loadSettings, PROGRESS_STORAGE_KEY, saveProgress, saveSettings, SETTINGS_STORAGE_KEY } from '../src/systems/storage';
import { evaluateReport, inspectEquipment } from '../src/systems/investigation';
import type { Progress } from '../src/types';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  blocked = false;
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null {
    if (this.blocked) throw new Error('Storage blocked');
    return this.values.get(key) ?? null;
  }
  removeItem(key: string): void {
    if (this.blocked) throw new Error('Storage blocked');
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.blocked) throw new Error('Storage quota exceeded');
    this.values.set(key, value);
  }
}

describe('local progress persistence', () => {
  let storage: MemoryStorage;
  let previous: PropertyDescriptor | undefined;
  beforeEach(() => {
    previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    storage = new MemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  });
  afterEach(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });

  function writeRaw(value: unknown): void {
    storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(value));
  }

  it('round trips location, inspected evidence and a solved report', () => {
    let progress: Progress = createProgress();
    for (const id of ['pc-bank', 'projector', 'network']) progress = inspectEquipment(progress, id);
    progress = evaluateReport(progress, 'idle-computers').progress;
    progress.playerPosition = { x: 700, y: 590 };
    assert.equal(saveProgress(progress), true);
    assert.deepEqual(loadProgress(), progress);
    assert.equal(clearProgress(), true);
    assert.equal(loadProgress(), null);
  });

  it('rejects corrupt JSON, incompatible cases, versions and unbounded counters', () => {
    assert.equal(loadProgress(), null);
    storage.setItem(PROGRESS_STORAGE_KEY, '{ broken');
    assert.equal(loadProgress(), null);
    for (const malformed of [
      null,
      [],
      { ...createProgress(), version: 2 },
      { ...createProgress(), caseId: 'another-case' },
      { ...createProgress(), reportAttempts: -1 },
      { ...createProgress(), reportAttempts: 1.5 },
      { ...createProgress(), reportAttempts: 1_001 },
      { ...createProgress(), inspectedIds: 'pc-bank' },
      { ...createProgress(), inspectedIds: [1] },
      { ...createProgress(), updatedAt: 'invalid-date' },
    ]) {
      writeRaw(malformed);
      assert.equal(loadProgress(), null);
    }
    assert.equal(saveProgress({ ...createProgress(), caseId: 'another-case' }), false);
  });

  it('sanitizes duplicate and unknown evidence and resets implausible locations', () => {
    writeRaw({
      ...createProgress(),
      inspectedIds: ['pc-bank', 'unknown-device', 'pc-bank', 'network'],
      playerPosition: { x: 9_999, y: 590 },
    });
    const loaded = loadProgress()!;
    assert.deepEqual(loaded.inspectedIds, ['pc-bank', 'network']);
    assert.deepEqual(loaded.playerPosition, INITIAL_POSITION);
    writeRaw({ ...createProgress(), playerPosition: { x: null, y: 590 } });
    assert.deepEqual(loadProgress()!.playerPosition, INITIAL_POSITION);
  });

  it('preserves actual playable positions at both room walls across a save and reload', () => {
    for (const position of [{ x: 720, y: 138 }, { x: 870, y: 662 }]) {
      const progress = { ...createProgress(), playerPosition: position };
      assert.equal(saveProgress(progress), true);
      assert.deepEqual(loadProgress()!.playerPosition, position);
    }
  });

  it('does not trust a solved flag without the required evidence and an attempt', () => {
    writeRaw({ ...createProgress(), reportSolved: true, reportAttempts: 1 });
    assert.equal(loadProgress()!.reportSolved, false);
    writeRaw({ ...createProgress(), inspectedIds: ['pc-bank', 'projector', 'network'], reportSolved: true });
    assert.equal(loadProgress()!.reportSolved, false);
  });

  it('reports storage failures without pretending that saving succeeded', () => {
    storage.blocked = true;
    assert.equal(saveProgress(createProgress()), false);
    assert.equal(clearProgress(), false);
    assert.equal(loadProgress(), null);
    assert.equal(saveSettings({ reducedMotion: true, showHints: false }), false);
    assert.deepEqual(loadSettings(), { reducedMotion: false, showHints: true });
  });

  it('validates settings and defaults missing or corrupt fields', () => {
    assert.deepEqual(loadSettings(), { reducedMotion: false, showHints: true });
    assert.equal(saveSettings({ reducedMotion: true, showHints: false }), true);
    assert.deepEqual(loadSettings(), { reducedMotion: true, showHints: false });
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ reducedMotion: 'yes', showHints: false }));
    assert.deepEqual(loadSettings(), { reducedMotion: false, showHints: false });
    storage.setItem(SETTINGS_STORAGE_KEY, 'broken-json');
    assert.deepEqual(loadSettings(), { reducedMotion: false, showHints: true });
  });
});
