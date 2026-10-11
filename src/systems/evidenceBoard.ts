import { EVIDENCE_BOARDS, type BoardDefinition, type BoardLink } from '../data/evidenceLinks';

export type { BoardDefinition, BoardLink, BoardChain, BoardPair } from '../data/evidenceLinks';
export type BoardEdge = {
  key: string;
  from: string;
  to: string;
  status: 'confirmed' | 'unsupported';
  title: string;
  feedback: string;
};
export type BoardEvaluation = {
  complete: boolean;
  edges: BoardEdge[];
  missingRequiredKeys: string[];
  invalidKeys: string[];
  completedChainIds: string[];
  requiredCount: number;
  confirmedRequiredCount: number;
  droppedCount: number;
};

const MAX_EDGES = 100;
const MAX_KEY_LENGTH = 80;
const isNodeId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);

/** An undirected key cannot reward the same comparison twice. */
export function edgeKey(from: string, to: string): string {
  if (!isNodeId(from) || !isNodeId(to) || from === to) throw new RangeError('Choose two different known evidence sources');
  const key = from < to ? `${from}~${to}` : `${to}~${from}`;
  if (key.length > MAX_KEY_LENGTH) throw new RangeError('Evidence connection is too long');
  return key;
}

export function getBoardDefinition(caseId: string): BoardDefinition {
  const definition = EVIDENCE_BOARDS.find((board) => board.caseId === caseId);
  if (!definition) throw new RangeError('Unknown evidence board');
  return definition;
}

/** Keep plausible-but-unsupported pairs so players can inspect and remove them. */
export function normalizeBoardEdges(definition: BoardDefinition, raw: unknown, inspectedIds: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const available = new Set(definition.nodeIds.filter((id) => inspectedIds.includes(id)));
  const result = new Set<string>();
  for (const item of raw.slice(0, MAX_EDGES)) {
    if (typeof item !== 'string' || item.length > MAX_KEY_LENGTH) continue;
    const parts = item.split('~');
    if (parts.length !== 2 || !available.has(parts[0]!) || !available.has(parts[1]!)) continue;
    try { result.add(edgeKey(parts[0]!, parts[1]!)); } catch { /* Damaged or self connections do not become progress. */ }
  }
  return [...result];
}

const keyedLinks = (definition: BoardDefinition): Map<string, BoardLink> => new Map(definition.links.map((link) => [edgeKey(link.from, link.to), link]));

export function evaluateBoard(definition: BoardDefinition, raw: unknown, inspectedIds: readonly string[]): BoardEvaluation {
  const normalized = normalizeBoardEdges(definition, raw, inspectedIds);
  const present = new Set(normalized);
  const links = keyedLinks(definition);
  const required = definition.links.filter((link) => link.required).map((link) => edgeKey(link.from, link.to));
  const edges: BoardEdge[] = normalized.map((key) => {
    const [from, to] = key.split('~') as [string, string];
    const link = links.get(key);
    return {
      key, from, to,
      status: link ? 'confirmed' : 'unsupported',
      title: link?.title ?? 'Недостаточная связь для этой цепочки',
      feedback: link?.explanation ?? definition.falseLeads.find((lead) => edgeKey(...lead.pair) === key)?.explanation
        ?? 'Эти источники могут иметь общую тему, но выбранная пара не проверяет одну из доказательных цепочек задания. Сопоставьте прибор с документом о времени, условиях или назначении. Удалите эту связь, чтобы защитить заданные цепочки.',
    };
  });
  const missingRequiredKeys = required.filter((key) => !present.has(key));
  const invalidKeys = edges.filter((edge) => edge.status === 'unsupported').map((edge) => edge.key);
  return {
    complete: missingRequiredKeys.length === 0 && invalidKeys.length === 0,
    edges, missingRequiredKeys, invalidKeys,
    completedChainIds: definition.chains.filter((chain) => chain.pairs.every((pair) => present.has(edgeKey(...pair)))).map((chain) => chain.id),
    requiredCount: required.length,
    confirmedRequiredCount: required.length - missingRequiredKeys.length,
    droppedCount: Array.isArray(raw) ? raw.length - normalized.length : 0,
  };
}

export function addBoardEdge(definition: BoardDefinition, raw: unknown, inspectedIds: readonly string[], from: string, to: string): { edges: string[]; feedback: string; added: boolean } {
  const edges = normalizeBoardEdges(definition, raw, inspectedIds);
  if (!definition.nodeIds.includes(from) || !definition.nodeIds.includes(to) || !inspectedIds.includes(from) || !inspectedIds.includes(to)) {
    return { edges, added: false, feedback: 'Сначала осмотрите и запишите оба источника в этой локации.' };
  }
  let key: string;
  try { key = edgeKey(from, to); } catch { return { edges, added: false, feedback: 'Выберите два разных источника, чтобы создать связь.' }; }
  if (edges.includes(key)) return { edges, added: false, feedback: 'Эта связь уже есть на доске. Порядок выбора источников не меняет сравнение.' };
  if (edges.length >= MAX_EDGES) return { edges, added: false, feedback: 'Доска заполнена. Удалите лишнюю связь перед новой.' };
  return { edges: [...edges, key], added: true, feedback: 'Связь добавлена. Нажмите «Проверить цепочки», чтобы сопоставить её с данными.' };
}

/** Three local hint tiers: method, concrete next source, then exact comparison. */
export function getBoardHint(definition: BoardDefinition, raw: unknown, inspectedIds: readonly string[], tier: 0 | 1 | 2 | 3): string {
  if (tier === 0) return 'ВАТТ: сначала попробуйте сопоставить два записанных источника самостоятельно. Подсказка доступна по кнопке.';
  const evaluation = evaluateBoard(definition, raw, inspectedIds);
  if (evaluation.complete) return 'ВАТТ: все заданные цепочки подтверждены. Дополнительные сравнения помогут объяснить, почему ложные подозреваемые сохраняют нужный режим.';
  if (tier === 1) return 'ВАТТ: число ватт показывает мощность. Ищите второй источник, который объясняет время, условия или необходимость работы. В тепловом деле сравнивайте U, площадь и разность температур вместе.';
  const missing = evaluation.missingRequiredKeys[0];
  if (!missing) {
    const unsupported = evaluation.edges.find((edge) => edge.status === 'unsupported')!;
    return tier === 2 ? 'ВАТТ: основные цепочки готовы, но есть сравнение без достаточного основания. Проверьте список связей и уберите неподтверждённую пару.' : `ВАТТ: ${unsupported.feedback}`;
  }
  const link = keyedLinks(definition).get(missing)!;
  const names = (id: string): string => definition.nodeNames[id] ?? 'Источник';
  const unavailable = [link.from, link.to].filter((id) => !inspectedIds.includes(id));
  if (unavailable.length) return `ВАТТ: для следующей цепочки ещё нужно осмотреть и записать ${unavailable.map((id) => `«${names(id)}»`).join(' и ')} в комнате. Наблюдение откроется после осмотра.`;
  return tier === 2 ? `ВАТТ: следующая проверка — «${link.title}». Соедините два записанных источника, которые объясняют её.` : `ВАТТ: сравните «${names(link.from)}» и «${names(link.to)}». ${link.explanation}`;
}
