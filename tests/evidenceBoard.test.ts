import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CAMPAIGN_CASES } from '../src/data/campaign';
import { EVIDENCE_BOARDS } from '../src/data/evidenceLinks';
import { addBoardEdge, edgeKey, evaluateBoard, getBoardDefinition, getBoardHint, normalizeBoardEdges } from '../src/systems/evidenceBoard';
import { createCaseProgress } from '../src/systems/campaign';
import { createExtensions, normalizeExtensions } from '../src/systems/v3Storage';
import { renderEvidenceBoard } from '../src/ui/EvidenceBoard';

const requiredEdges = (caseId: string): string[] => getBoardDefinition(caseId).links.filter((link) => link.required).map((link) => edgeKey(link.from, link.to));

describe('optional evidence chains and hostile saved edges', () => {
  it('defines increasing source chains for all five real campaign cases', () => {
    assert.deepEqual(EVIDENCE_BOARDS.map((board) => board.links.filter((link) => link.required).length), [2, 4, 6, 6, 8]);
    for (const level of CAMPAIGN_CASES) {
      const board = getBoardDefinition(level.id);
      assert.deepEqual(board.nodeIds, level.equipment.map((device) => device.id));
      assert.equal(new Set(board.links.map((link) => edgeKey(link.from, link.to))).size, board.links.length);
      const required = new Set(requiredEdges(level.id));
      const chained = new Set(board.chains.flatMap((chain) => chain.pairs.map((pair) => edgeKey(...pair))));
      assert.deepEqual(chained, required, `${level.id}: each required pair belongs to a described chain`);
      for (const link of board.links) {
        assert.ok(board.nodeIds.includes(link.from) && board.nodeIds.includes(link.to));
        assert.ok(link.explanation.length > 45, `${level.id}/${link.title}`);
        assert.ok(edgeKey(link.from, link.to).length <= 80);
      }
      const evaluation = evaluateBoard(board, [...required], board.nodeIds);
      assert.equal(evaluation.complete, true, level.id);
      assert.equal(evaluation.completedChainIds.length, board.chains.length);
      assert.equal(evaluation.requiredCount, required.size);
    }
  });

  it('keeps unsupported known comparisons for correction without allowing them to replace proof', () => {
    const board = EVIDENCE_BOARDS[0]!;
    const unsupported = edgeKey('projector', 'network');
    const before = requiredEdges(board.caseId);
    const attempt = addBoardEdge(board, before, board.nodeIds, 'projector', 'network');
    assert.equal(attempt.added, true);
    const evaluation = evaluateBoard(board, attempt.edges, board.nodeIds);
    assert.equal(evaluation.complete, false);
    assert.deepEqual(evaluation.missingRequiredKeys, []);
    assert.deepEqual(evaluation.invalidKeys, [unsupported]);
    assert.match(evaluation.edges.find((edge) => edge.key === unsupported)!.feedback, /назнач|нужн|обязатель/);
    assert.equal(evaluateBoard(board, [unsupported], board.nodeIds).confirmedRequiredCount, 0);
    assert.equal(evaluateBoard(board, attempt.edges.filter((key) => key !== unsupported), board.nodeIds).complete, true);
    assert.deepEqual(before, requiredEdges(board.caseId), 'adding a pair does not mutate the caller save');
  });

  it('cannot count duplicate, reversed, self, foreign-case, uninspected, oversized or damaged pairs', () => {
    const board = EVIDENCE_BOARDS[0]!;
    const key = edgeKey('pc-bank', 'lab-timetable');
    const forged: unknown[] = [key, 'pc-bank~lab-timetable', 'pc-bank~pc-bank', 'hall-sensor~hall-schedule',
      'pc-bank~unknown-device', 'pc-bank~network', 'pc-bank~lab-timetable~network', 'pc-bank~\u0000',
      `${'x'.repeat(64)}~${'y'.repeat(64)}`, null, 12, { toString: () => key }, '__proto__~constructor'];
    assert.deepEqual(normalizeBoardEdges(board, forged, ['pc-bank', 'lab-timetable']), [key]);
    assert.deepEqual(normalizeBoardEdges(board, null, board.nodeIds), []);
    assert.deepEqual(normalizeBoardEdges(board, [key], []), []);
    assert.deepEqual(normalizeBoardEdges(board, [key], ['pc-bank']), []);
    assert.throws(() => edgeKey('pc-bank', 'pc-bank'), RangeError);
    assert.throws(() => edgeKey('pc-bank', '<script>'), RangeError);
    assert.throws(() => edgeKey('a'.repeat(64), 'b'.repeat(64)), RangeError);
    assert.throws(() => getBoardDefinition('__proto__'), RangeError);
    const denied = addBoardEdge(board, [], ['pc-bank'], 'pc-bank', 'lab-timetable');
    assert.equal(denied.added, false);
    assert.match(denied.feedback, /осмотрите/);
  });

  it('checks every required edge, while accepting explanatory comparisons and control examples', () => {
    for (const board of EVIDENCE_BOARDS) {
      const required = requiredEdges(board.caseId);
      const missing = evaluateBoard(board, required.slice(1), board.nodeIds);
      assert.equal(missing.complete, false);
      assert.deepEqual(missing.missingRequiredKeys, [required[0]]);
      const supplemental = board.links.filter((link) => !link.required).map((link) => edgeKey(link.from, link.to));
      assert.equal(evaluateBoard(board, [...required, ...supplemental], board.nodeIds).complete, true);
      assert.equal(evaluateBoard(board, supplemental, board.nodeIds).complete, false);
    }
    const kitchen = EVIDENCE_BOARDS[2]!;
    const sameDailyEnergy = evaluateBoard(kitchen, [edgeKey('kitchen-oven', 'kitchen-warmer')], kitchen.nodeIds).edges[0]!;
    assert.equal(sameDailyEnergy.status, 'confirmed');
    assert.match(sameDailyEnergy.feedback, /6 кВт·ч.*6/);
    const thermal = EVIDENCE_BOARDS[3]!;
    assert.equal(evaluateBoard(thermal, [edgeKey('thermal-window-a', 'thermal-door')], thermal.nodeIds).invalidKeys.length, 0);
  });

  it('preserves unsupported pairs and the canonical representation in extension storage', () => {
    const board = EVIDENCE_BOARDS[0]!;
    const save = createExtensions();
    const first = addBoardEdge(board, [], board.nodeIds, 'pc-bank', 'lab-timetable');
    const repeated = addBoardEdge(board, first.edges, board.nodeIds, 'lab-timetable', 'pc-bank');
    assert.equal(repeated.added, false);
    assert.deepEqual(repeated.edges, first.edges);
    save.boards[board.caseId] = addBoardEdge(board, repeated.edges, board.nodeIds, 'projector', 'network').edges;
    const restored = normalizeExtensions(JSON.parse(JSON.stringify(save)))!;
    assert.deepEqual(restored.boards[board.caseId], save.boards[board.caseId]);
    assert.equal(evaluateBoard(board, restored.boards[board.caseId], board.nodeIds).invalidKeys.length, 1);
  });

  it('keeps electrical group, heat and final aggregate explanations scientifically distinct', () => {
    const lab = EVIDENCE_BOARDS[0]!;
    assert.match(lab.links.find((link) => link.from === 'pc-bank' && link.to === 'lab-timetable')!.explanation, /76,8 кВт·ч/);
    assert.match(lab.links.find((link) => link.from === 'monitor-bank' && link.to === 'lab-timetable')!.explanation, /19,2 кВт·ч.*96 кВт·ч/);
    const thermal = EVIDENCE_BOARDS[3]!;
    assert.match(thermal.links.find((link) => link.to === 'thermal-inspection' && link.from === 'thermal-gym-window')!.explanation, /122,88 кВт·ч тепла.*не показание электросчётчика/);
    const final = EVIDENCE_BOARDS[4]!;
    assert.match(final.links.find((link) => link.from === 'final-kitchen' && link.to === 'final-fridge')!.explanation, /не создаёт новую электрическую нагрузку/);
    assert.match(final.links.find((link) => link.from === 'final-meter' && link.to === 'final-projector')!.explanation, /31,88.*120.*151,88.*не является мощностью одного проектора/);
    assert.match(final.links.find((link) => link.to === 'final-thermal' && link.from === 'final-meter')!.explanation, /не складываются в показание электросчётчика/);
  });

  it('reveals one specific comparison only at the third hint tier and requires actual inspection', () => {
    const board = EVIDENCE_BOARDS[0]!;
    const hintOne = getBoardHint(board, [], board.nodeIds, 1);
    const hintTwo = getBoardHint(board, [], board.nodeIds, 2);
    const hintThree = getBoardHint(board, [], board.nodeIds, 3);
    assert.match(hintOne, /время|необходимость/);
    assert.match(hintTwo, /Ожидание без занятий/);
    assert.doesNotMatch(hintTwo, /«Компьютеры» и «Расписание»/);
    assert.match(hintThree, /«Компьютеры» и «Расписание»/);
    assert.doesNotMatch(hintThree, /pc-bank|lab-timetable/);
    const locked = getBoardHint(board, [], [], 3);
    assert.match(locked, /осмотреть и записать/);
    assert.doesNotMatch(locked, /76,8|80 ×/);
    assert.match(getBoardHint(board, requiredEdges(board.caseId), board.nodeIds, 3), /все заданные цепочки подтверждены/);
  });

  it('renders keyboard/touch operations, saved SVG edges, formulas and guarded original load data', () => {
    const level = CAMPAIGN_CASES[0]!;
    const progress = createCaseProgress(level);
    const options = { edges: requiredEdges(level.id), selectedId: 'pc-bank', checked: false, hintLevel: 0 as const };
    const locked = renderEvidenceBoard(level, progress, options);
    assert.match(locked, /data-action="board-node" data-id="pc-bank" aria-pressed="false" disabled/);
    assert.doesNotMatch(locked, /class="board-wire /);
    assert.match(locked, /Часовой график откроется/);
    assert.doesNotMatch(locked, /80 Вт × 6/);
    progress.inspectedIds = ['pc-bank', 'monitor-bank', 'lab-timetable'];
    const original = JSON.stringify(progress);
    const active = renderEvidenceBoard(level, progress, { ...options, checked: true, feedback: '<script>unsafe</script>' });
    assert.match(active, /class="board-wire confirmed"/);
    assert.match(active, /data-action="board-remove" data-edge="/);
    assert.match(active, /data-action="board-check"/);
    assert.match(active, /data-action="board-hint"/);
    assert.match(active, /aria-pressed="true"/);
    assert.match(active, /80 Вт × 6.*10 ч\/день/);
    assert.match(active, /96 кВт·ч \/ 20 д\./);
    assert.match(active, /Часовой график дела · мощность в кВт/);
    assert.match(active, /&lt;script&gt;unsafe&lt;\/script&gt;/);
    assert.doesNotMatch(active, /<script>unsafe/);
    assert.equal(JSON.stringify(progress), original, 'rendering and evaluation never change completed or legacy campaign fields');
  });
});
