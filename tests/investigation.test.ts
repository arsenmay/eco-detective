import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SCHOOL_CASE } from '../src/data/schoolCase';
import { canSubmitReport, evaluateReport, getInvestigationSavings, getMonthlyBaseline, inspectEquipment } from '../src/systems/investigation';
import { createProgress } from '../src/systems/storage';
import type { Progress } from '../src/types';

function collectRequiredEvidence(): Progress {
  return SCHOOL_CASE.requiredDeviceIds.reduce(inspectEquipment, createProgress());
}

describe('investigation evidence and reports', () => {
  it('adds distinct inspections without mutating or inflating the original progress', () => {
    const initial = createProgress();
    const inspected = inspectEquipment(initial, 'pc-bank');
    assert.deepEqual(initial.inspectedIds, []);
    assert.deepEqual(inspected.inspectedIds, ['pc-bank']);
    assert.strictEqual(inspectEquipment(inspected, 'pc-bank'), inspected);
    assert.throws(() => inspectEquipment(inspected, 'unknown'), RangeError);
  });

  it('requires evidence of duration and safe operation, not merely any three objects', () => {
    const optionalOnly = ['monitor-bank', 'lighting', 'teacher-pc'].reduce(inspectEquipment, createProgress());
    assert.equal(canSubmitReport(optionalOnly), false);
    assert.throws(() => evaluateReport(optionalOnly, 'idle-computers'), RangeError);
    assert.equal(canSubmitReport(collectRequiredEvidence()), true);
    const duplicates = { ...createProgress(), inspectedIds: ['pc-bank', 'pc-bank', 'pc-bank'] };
    assert.equal(canSubmitReport(duplicates), false);
  });

  it('gives an explanatory failed answer and allows correcting it', () => {
    const first = evaluateReport(collectRequiredEvidence(), 'projector');
    assert.equal(first.correct, false);
    assert.equal(first.progress.reportSolved, false);
    assert.equal(first.progress.reportAttempts, 1);
    assert.match(first.explanation, /0,6 кВт·ч/);
    const second = evaluateReport(first.progress, 'idle-computers');
    assert.equal(second.correct, true);
    assert.equal(second.progress.reportAttempts, 2);
    assert.equal(second.progress.reportSolved, true);
    assert.match(second.explanation, /96 кВт·ч/);
  });

  it('explains why critical network equipment and all-off proposals are unsafe', () => {
    const ready = collectRequiredEvidence();
    const network = evaluateReport(ready, 'network');
    const allOff = evaluateReport(ready, 'all-off');
    assert.equal(network.correct, false);
    assert.match(network.explanation, /без разрешения специалиста нельзя/);
    assert.equal(allOff.correct, false);
    assert.match(allOff.explanation, /прерывает необходимую связь/);
    assert.throws(() => evaluateReport(ready, 'fabricated-option'), RangeError);
  });

  it('keeps solved progress stable when the report is reopened', () => {
    const solved = evaluateReport(collectRequiredEvidence(), 'idle-computers').progress;
    const repeated = evaluateReport(solved, 'idle-computers');
    assert.strictEqual(repeated.progress, solved);
    assert.equal(repeated.progress.reportAttempts, 1);
    assert.strictEqual(evaluateReport(solved, 'projector').progress, solved);
  });

  it('unlocks only the approved projected savings and keeps the baseline intact', () => {
    const ready = collectRequiredEvidence();
    assert.equal(getInvestigationSavings(ready), 0);
    const solved = evaluateReport(ready, 'idle-computers').progress;
    assert.ok(Math.abs(getInvestigationSavings(solved) - 96) < 1e-9);
    assert.ok(Math.abs(getMonthlyBaseline() - 151.88) < 1e-9);
    assert.equal(getInvestigationSavings({ ...solved, inspectedIds: [] }), 0);
  });

  it('refuses evidence from another case and bounds repeated report attempts', () => {
    const otherCase = { ...collectRequiredEvidence(), caseId: 'other-case' };
    assert.equal(canSubmitReport(otherCase), false);
    assert.throws(() => inspectEquipment(otherCase, 'pc-bank'), RangeError);
    const repeated = evaluateReport({ ...collectRequiredEvidence(), reportAttempts: 1_000 }, 'projector');
    assert.equal(repeated.progress.reportAttempts, 1_000);
  });
});
