import type { CampaignCase, CampaignCaseProgress } from '../campaign/types';
import { evaluateBoard, getBoardDefinition, getBoardHint, type BoardEvaluation } from '../systems/evidenceBoard';
import { calculateEquipmentEnergy, formatEnergy } from '../systems/energy';
import { icon } from './icons';

export type EvidenceBoardOptions = {
  edges: string[];
  selectedId: string | null;
  checked: boolean;
  hintLevel: 0 | 1 | 2 | 3;
  feedback?: string;
};

const escape = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

function renderLoadGraph(level: CampaignCase, inspectedIds: readonly string[]): string {
  if (!level.loadGraph) return '';
  const sourceId = ({ 1: 'lab-timetable', 2: 'hall-schedule', 3: 'kitchen-load-log', 5: 'final-meter' } as Record<number, string>)[level.order];
  if (!sourceId || !inspectedIds.includes(sourceId)) return '<div class="board-graph-locked">Часовой график откроется после записи источника с расписанием или анализатором. Каждая колонка показывает мощность в кВт.</div>';
  const graph = level.loadGraph;
  const maximum = Math.max(...graph.values, .001);
  return `<details class="board-load-profile"><summary>Часовой график дела · мощность в кВт</summary><p>Вымышленный исходный день: 24 интервала по одному часу. График показывает мощность, не накопленную энергию.</p><div class="board-load-bars" role="img" aria-label="Часовая мощность учебного дня. Максимум ${formatEnergy(maximum)} кВт. Точные значения указаны в списке ниже.">${graph.values.map((power, index) => `<span title="${escape(graph.labels[index]!)}: ${formatEnergy(power)} кВт"><i style="height:${Math.max(power ? 4 : 0, power / maximum * 100)}%"></i></span>`).join('')}</div><div class="board-load-axis"><span>00:00</span><span>12:00</span><span>23:00</span></div><details class="board-load-values"><summary>Значения для сопоставления</summary><div>${graph.values.map((power, index) => `<span>${escape(graph.labels[index]!)} <b>${formatEnergy(power)} кВт</b></span>`).join('')}</div></details></details>`;
}

/** The miniature graph is visual; all of its operations have ordinary buttons. */
function renderDiagram(level: CampaignCase, inspectedIds: readonly string[], evaluation: BoardEvaluation, selectedId: string | null, checked: boolean): string {
  const rows = Math.ceil(level.equipment.length / 3);
  const height = 38 + rows * 62;
  const points = new Map(level.equipment.map((device, index) => [device.id, { x: 90 + (index % 3) * 180, y: 40 + Math.floor(index / 3) * 62 }]));
  const wires = evaluation.edges.map((edge) => {
    const from = points.get(edge.from)!;
    const to = points.get(edge.to)!;
    return `<line class="board-wire ${checked ? edge.status : 'pending'}" data-edge="${edge.key}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`;
  }).join('');
  const nodes = level.equipment.map((device, index) => {
    const point = points.get(device.id)!;
    const available = inspectedIds.includes(device.id);
    return `<g class="board-map-node ${available ? 'available' : 'locked'} ${selectedId === device.id ? 'selected' : ''}" transform="translate(${point.x} ${point.y})"><title>${escape(device.shortName)} · ${available ? 'записан' : 'не осмотрен'}</title><circle r="17" /><text text-anchor="middle" y="4">${String(index + 1).padStart(2, '0')}</text></g>`;
  }).join('');
  return `<svg class="board-diagram" viewBox="0 0 540 ${height}" role="img" aria-label="Схема сохранённых связей. Номера соответствуют карточкам источников ниже."><defs><pattern id="board-dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#345466" /></pattern></defs><rect width="540" height="${height}" fill="url(#board-dots)" />${wires}${nodes}</svg>`;
}

export function renderEvidenceBoard(level: CampaignCase, progress: CampaignCaseProgress | null, options: EvidenceBoardOptions): string {
  const definition = getBoardDefinition(level.id);
  const inspectedIds = progress?.caseId === level.id ? progress.inspectedIds : [];
  const evaluation = evaluateBoard(definition, options.edges, inspectedIds);
  const selectedId = options.selectedId && inspectedIds.includes(options.selectedId) && definition.nodeIds.includes(options.selectedId) ? options.selectedId : null;
  const selectedName = selectedId ? definition.nodeNames[selectedId] : null;
  const selectedDevice = selectedId ? level.equipment.find((device) => device.id === selectedId) : null;
  const observation = selectedDevice ? `<aside class="board-observation" id="board-selection-observation" role="note"><span>НАБЛЮДЕНИЕ ВЫБРАННОГО ИСТОЧНИКА</span><strong>${escape(selectedDevice.shortName)}</strong><p>${escape(selectedDevice.evidence)}</p></aside>` : '';
  const checked = options.checked;
  const hypothesisTitles = progress?.suspectedIds.map((id) => level.reportOptions.find((option) => option.id === id)?.title).filter((title): title is string => !!title) ?? [];
  const hypothesis = `<div class="board-hypothesis"><span>Гипотеза отчёта</span><p>${progress?.reportSolved ? `✓ Подтверждена: ${escape(hypothesisTitles.join('; ') || 'данные текущего дела сопоставлены')}` : hypothesisTitles.length ? `Проверяется: ${escape(hypothesisTitles.join('; '))}` : 'Пока не защищена. Доска помогает обосновать вывод до составления отчёта.'}</p></div>`;
  const sources = level.equipment.map((device, index) => {
    const available = inspectedIds.includes(device.id);
    const passive = device.mode.powerWatts === 0;
    const thermal = ['window', 'door', 'heating'].includes(device.category);
    const stats = !available ? '' : passive ? `<span class="board-source__data">${thermal ? 'Тепловая модель · отдельный баланс' : 'Документ · без электрической нагрузки'}</span>` : `<span class="board-source__data">${formatEnergy(device.mode.powerWatts)} Вт${device.quantity > 1 ? ` × ${device.quantity}` : ''} · ${formatEnergy(device.mode.hoursPerDay)} ч/день<br>${formatEnergy(calculateEquipmentEnergy(device, level.workingDays).monthlyKwh)} кВт·ч / ${level.workingDays} д.${device.mode.label.includes('средн') ? '<br>Средняя мощность учебной модели' : ''}</span>`;
    return `<button class="board-source ${available ? 'available' : 'locked'}" data-action="board-node" data-id="${device.id}" aria-pressed="${selectedId === device.id}" ${selectedId === device.id ? 'aria-describedby="board-selection-observation" ' : ''}${available ? '' : 'disabled'}><span class="board-source__number">${String(index + 1).padStart(2, '0')}</span>${icon(device.category)}<span class="board-source__label"><strong>${escape(device.shortName)}</strong>${stats}<small>${available ? selectedId === device.id ? 'Выбран первый источник' : 'Нажмите для сравнения' : 'Сначала осмотрите в комнате'}</small></span>${icon(available ? selectedId === device.id ? 'check' : 'info' : 'lock')}</button>`;
  }).join('');
  const links = evaluation.edges.length ? `<ol class="board-link-list">${evaluation.edges.map((edge, index) => `<li class="board-link-row" data-status="${checked ? edge.status : 'pending'}"><div class="board-link-copy"><span class="board-link-number">${String(index + 1).padStart(2, '0')}</span><strong>${escape(definition.nodeNames[edge.from]!)} ↔ ${escape(definition.nodeNames[edge.to]!)}</strong><small>${checked ? edge.status === 'confirmed' ? '✓ Данные сопоставлены' : '△ Цепочка требует уточнения' : 'Связь сохранена, ожидает проверки'}</small>${checked ? `<p>${escape(edge.feedback)}</p>` : ''}</div><button class="board-remove" data-action="board-remove" data-edge="${edge.key}" aria-label="Удалить связь ${escape(definition.nodeNames[edge.from]!)} и ${escape(definition.nodeNames[edge.to]!)}">${icon('close')}<span>Удалить</span></button></li>`).join('')}</ol>` : '<p class="board-empty">Связей пока нет. Выберите две записанные карточки: на схеме появится линия, а здесь — её описание.</p>';
  const chains = `<ul class="board-chain-list">${definition.chains.map((chain) => {
    const complete = checked && evaluation.completedChainIds.includes(chain.id);
    return `<li class="board-chain ${complete ? 'confirmed' : ''}"><span>${icon(complete ? 'check' : 'search')}</span><div><strong>${escape(chain.title)}</strong><small>${complete ? escape(chain.conclusion) : `Нужно сопоставить ${chain.pairs.length} ${chain.pairs.length === 1 ? 'связь' : chain.pairs.length < 5 ? 'связи' : 'связей'} источников. Вывод откроется после проверки.`}</small></div></li>`;
  }).join('')}</ul>`;
  const status = checked ? evaluation.complete ? 'Все заданные цепочки подтверждены. Дополнительная тренировка завершена.' : `Подтверждено ${evaluation.confirmedRequiredCount}/${evaluation.requiredCount} основных связей.${evaluation.invalidKeys.length ? ` Требуют уточнения: ${evaluation.invalidKeys.length}. Удалите их или пересмотрите источники.` : ' Найдите недостающие сравнения.'}` : selectedName ? `Выбран источник «${selectedName}». Теперь нажмите вторую записанную карточку. Повторное нажатие снимет выбор.` : 'Выберите первый источник, затем второй. Проверка доступна после создания связи.';
  const feedback = `${status}${options.feedback ? ` ${options.feedback}` : ''}`;
  return `<section class="evidence-board" aria-label="Доска доказательств"><div class="board-heading"><span class="chip">ДОПОЛНИТЕЛЬНАЯ ТРЕНИРОВКА</span><h3>${escape(definition.title)}</h3><p>${escape(definition.goal)}</p><small>Доска сохраняется отдельно от сюжетного отчёта. Старые результаты расследований сохраняются; основная кампания не требует бонуса доски.</small></div>${hypothesis}${chains}${renderLoadGraph(level, inspectedIds)}<div class="board-graph-wrap">${renderDiagram(level, inspectedIds, evaluation, selectedId, checked)}<span class="board-graph-legend">Номера на схеме соответствуют карточкам. ${checked ? 'Бирюзовый — подтверждено, янтарный — уточнить.' : 'Пунктир — сохранённое сравнение до проверки.'}</span></div><div class="board-sources" role="group" aria-label="Выберите два записанных источника">${sources}</div>${observation}<div class="board-feedback ${checked && evaluation.complete ? 'complete' : checked && evaluation.invalidKeys.length ? 'needs-review' : ''}" role="status" aria-live="polite">${escape(feedback)}</div><div class="board-actions"><button class="button primary" data-action="board-check" ${evaluation.edges.length ? '' : 'disabled'}>${icon('check')} Проверить цепочки</button><button class="button secondary" data-action="board-hint">${icon('robot')} ${options.hintLevel >= 3 ? 'Повторить подсказку' : `Подсказка ${options.hintLevel + 1}/3`}</button></div>${options.hintLevel > 0 ? `<div class="board-hint">${icon('robot')}<p>${escape(getBoardHint(definition, options.edges, inspectedIds, options.hintLevel))}</p></div>` : ''}<h4 class="board-links-title">Сохранённые связи <span>${evaluation.edges.length}</span></h4>${links}</section>`;
}
