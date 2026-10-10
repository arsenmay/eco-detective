import type { CampaignCase, CampaignCaseProgress, CampaignPlan, PlanEvaluation, Upgrade } from '../campaign/types';
import { CRISIS_PROJECTS, defaultPlan, KITCHEN_UPGRADES, LIGHTING_OPTIONS, THERMAL_MEASURES } from '../systems/puzzles';

const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
const number = (value: number): string => Number.isFinite(value) ? numberFormat.format(value) : '—';
const escape = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

function renderLoadGraph(level: CampaignCase): string {
  const source = level.loadGraph;
  if (!source || !source.labels.length || source.labels.length !== source.values.length) return '';
  // Profiles are stored in kW to integrate their hourly values into kWh.
  // The chart uses watts; this is a unit conversion, never a decorative signal.
  const graph = source.unit === 'кВт' || source.unit === 'kW'
    ? { ...source, values: source.values.map((value) => value * 1000), unit: 'Вт' }
    : source;
  const width = 720;
  const left = 46;
  const right = 16;
  const bottom = 210;
  const top = 30;
  const chartHeight = bottom - top;
  const step = (width - left - right) / graph.labels.length;
  const maximum = Math.max(1, ...graph.values.filter((value) => Number.isFinite(value) && value >= 0));
  const titleId = `load-title-${level.id}`;
  const descriptionId = `load-description-${level.id}`;
  const bars = graph.values.map((value, index) => {
    const valid = Number.isFinite(value) && value >= 0;
    const height = valid ? value / maximum * chartHeight : 0;
    const x = left + index * step;
    return `<g><rect class="graph-bar" x="${x + step * .15}" y="${bottom - height}" width="${step * .7}" height="${height}"><title>${escape(graph.labels[index]!)}: ${escape(number(value))} ${escape(graph.unit)}</title></rect><text class="graph-value" x="${x + step / 2}" y="${Math.max(16, bottom - height - 6)}" text-anchor="middle">${escape(number(value))}</text><text class="graph-label" x="${x + step / 2}" y="${bottom + 19}" text-anchor="middle">${escape(graph.labels[index]!)}</text></g>`;
  }).join('');
  const values = graph.labels.map((label, index) => `<span><small>${escape(label)}</small><strong>${escape(number(graph.values[index]!))} ${escape(graph.unit)}</strong></span>`).join('');
  return `<figure class="load-graph"><figcaption>Суточный профиль мощности · ${escape(graph.unit)}</figcaption><svg width="100%" viewBox="0 0 ${width} 250" role="img" aria-labelledby="${escape(titleId)} ${escape(descriptionId)}"><title id="${escape(titleId)}">Учебный график мощности за сутки</title><desc id="${escape(descriptionId)}">Высота столбца показывает заданную мощность в ${escape(graph.unit)} для указанного часа. Точные значения приведены под графиком.</desc><line class="graph-axis" x1="${left}" y1="${bottom}" x2="${width - right}" y2="${bottom}"/><line class="graph-axis" x1="${left}" y1="${top}" x2="${left}" y2="${bottom}"/><text class="graph-label" x="${left - 8}" y="${bottom + 3}" text-anchor="end">0</text><text class="graph-label" x="${left - 8}" y="${top + 3}" text-anchor="end">${escape(number(maximum))}</text>${bars}<text class="graph-label" x="${width - right}" y="246" text-anchor="end">Час суток</text></svg><div class="graph-values">${values}</div><p class="demo-footnote">Это заданные значения учебной модели. График показывает мощность, а энергия зависит также от продолжительности работы.</p></figure>`;
}

export function renderAnalysis(level: CampaignCase, progress: CampaignCaseProgress): string {
  const questions = level.analysis.map((question, index) => {
    const options = question.options.map((option) => {
      const id = `analysis-${level.id}-${question.id}-${option.id}`;
      const selected = progress.analysisAnswers[question.id] === option.id;
      return `<label class="puzzle-choice" for="${escape(id)}"><input type="radio" id="${escape(id)}" name="analysis-${escape(question.id)}" value="${escape(option.id)}"${selected ? ' checked' : ''}/><span>${escape(option.title)}</span></label>`;
    }).join('');
    return `<fieldset class="analysis-question"><legend><span class="step-number">${index + 1}</span> ${escape(question.prompt)}</legend><div class="puzzle-options">${options}</div>${progress.analysisSolved ? `<p class="evidence-note">${escape(question.explanation)}</p>` : ''}</fieldset>`;
  }).join('');
  return `<p class="campaign-panel-intro">Сопоставьте собранные улики и режимы работы. Для каждого вопроса выберите обоснованный ответ: высокая мощность сама по себе не доказывает потери энергии.</p>${renderLoadGraph(level)}<div class="analysis-questions">${questions}</div><div class="modal-actions plan-actions"><button class="button secondary" data-action="close">Вернуться к уликам</button><button class="button primary" data-action="submit-analysis">Проверить анализ</button></div>`;
}

export function readAnalysisAnswers(root: HTMLElement): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const input of root.querySelectorAll<HTMLInputElement>('input[name^="analysis-"]:checked')) {
    answers[input.name.slice('analysis-'.length)] = input.value;
  }
  return answers;
}

function renderRange(id: string, title: string, value: number, min: number, max: number, step: number, unit: string, hint: string, disabled = false): string {
  return `<div class="plan-field"><label for="${id}"><strong>${escape(title)}</strong><output for="${id}" data-plan-value="${id}">${escape(number(value))} ${escape(unit)}</output></label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" data-campaign-plan${disabled ? ' disabled' : ''} aria-describedby="${id}-hint"/><small id="${id}-hint">${escape(hint)}</small></div>`;
}

function renderSelect(id: string, title: string, value: string, options: readonly { id: string; title: string }[], hint: string): string {
  return `<div class="plan-field"><label for="${id}"><strong>${escape(title)}</strong></label><select id="${id}" data-campaign-plan aria-describedby="${id}-hint">${options.map((option) => `<option value="${escape(option.id)}"${value === option.id ? ' selected' : ''}>${escape(option.title)}</option>`).join('')}</select><small id="${id}-hint">${escape(hint)}</small></div>`;
}

function renderUpgrades(kind: string, options: readonly Upgrade[], selectedIds: readonly string[]): string {
  return `<fieldset class="plan-upgrades"><legend>Выберите меры для плана</legend>${options.map((option) => {
    const id = `upgrade-${kind}-${option.id}`;
    return `<label class="upgrade-card" for="${escape(id)}"><input type="checkbox" name="upgrade" id="${escape(id)}" value="${escape(option.id)}" data-campaign-plan${selectedIds.includes(option.id) ? ' checked' : ''}/><span><strong>${escape(option.title)}</strong><small>${escape(option.description)}</small></span><span class="upgrade-cost">${option.cost} кр.</span></label>`;
  }).join('')}</fieldset>`;
}

/** Each investigation has different constraints; unsafe proposals remain testable. */
export function renderPlan(level: CampaignCase, suppliedPlan: CampaignPlan): string {
  const plan = suppliedPlan.kind === level.puzzle.kind ? suppliedPlan : defaultPlan(level);
  let controls = '';
  let introduction = '';
  switch (plan.kind) {
    case 'timeline':
      introduction = 'Настройте расписание пустого кабинета. Цель: не менее 84 кВт·ч безопасной экономии электричества за 20 учебных дней. Уроки, работа учителя и связь сохраняются.';
      controls = `${renderRange('computer-hours', 'Ожидание компьютеров и мониторов', plan.computerHours, 2, 10, .5, 'ч/день', 'Меньше лишнего ожидания; сохраняем 2 необходимых часа и файлы перед переходом в сон.')}<label class="puzzle-choice" for="daylight-enabled"><input type="checkbox" id="daylight-enabled" data-campaign-plan${plan.daylight ? ' checked' : ''}/><span>Подтверждено достаточное дневное освещение рабочих мест</span></label>${renderRange('lighting-hours', 'Работа освещения', plan.daylight ? plan.lightingHours : 8, 4, 8, .5, 'ч/день', 'Сокращение до 4–8 часов допускается только при достаточном дневном свете.', !plan.daylight)}`;
      break;
    case 'lighting':
      introduction = 'Назначьте режим каждой группе отдельно. Цель: не менее 20 кВт·ч безопасной экономии электричества за 20 учебных дней. Проверяйте видимость, время открытой школы и аварийные пути.';
      controls = `${renderSelect('window-mode', 'Зона у окон · 108 Вт', plan.windowMode, LIGHTING_OPTIONS.windowMode, 'Дневного света достаточно только в подтверждённые часы.')}${renderSelect('interior-mode', 'Внутренняя зона · 144 Вт', plan.interiorMode, LIGHTING_OPTIONS.interiorMode, 'Без окон нужен свет при присутствии людей.')}${renderSelect('stairs-mode', 'Лестница · 72 Вт', plan.stairsMode, LIGHTING_OPTIONS.stairsMode, 'Школа открыта 8 часов; один датчик не покрывает всю лестницу.')}${renderSelect('emergency-mode', 'Аварийное освещение · 12 Вт', plan.emergencyMode, LIGHTING_OPTIONS.emergencyMode, 'Система должна оставаться доступной круглосуточно.')}`;
      break;
    case 'kitchen':
      introduction = `Распределите ${level.puzzle.budget ?? 5} игровых кредитов. Цель: не менее 64 кВт·ч экономии электричества за 20 учебных дней. Учитывайте часы раздачи, приготовление и непрерывную холодовую цепь. Есть несколько решений.`;
      controls = renderUpgrades('kitchen', KITCHEN_UPGRADES, plan.upgradeIds);
      break;
    case 'thermal':
      introduction = `Распределите ${level.puzzle.budget ?? 6} игровых кредитов и сохраните комфорт. Цель: не менее 80 кВт·ч тепловой экономии. Тепло рассматривается отдельно от электричества.`;
      controls = `${renderRange('class-temp', 'Температура кабинета', plan.classTemp, 16, 24, 1, '°C', 'Допустимый комфорт в модели: 20–22 °C.')}${renderRange('gym-temp', 'Температура спортзала', plan.gymTemp, 16, 24, 1, '°C', 'Допустимый комфорт в модели: 18–20 °C.')}${renderUpgrades('thermal', THERMAL_MEASURES, plan.measureIds)}<div class="evidence-note"><strong>Q = U × A × ΔT × 160 / 1000</strong><p>U — Вт/(м²·К), A — площадь в м², ΔT — разница с наружной температурой 4 °C. Расчёт за 8 часов × 20 дней = 160 часов.</p><p>Упрощённая модель теплопередачи не учитывает солнце, вентиляцию и тепловую инерцию. Источник отопления и КПД не заданы, поэтому тепловые кВт·ч не приравниваются к электрическим.</p></div>`;
      break;
    case 'crisis':
      introduction = `Составьте общий план в пределах ${level.puzzle.budget ?? 10} игровых кредитов. Цели: не менее 120 кВт·ч электрической и отдельно 40 кВт·ч тепловой экономии. Возможны разные наборы мер. Связь, холодовая цепь и безопасное движение должны сохраняться.`;
      controls = `${renderUpgrades('crisis', CRISIS_PROJECTS, plan.projectIds)}${renderSelect('priority-id', 'Какой выбранный проект выполнить первым?', plan.priorityId, [{ id: '', title: 'Выберите первый шаг' }, ...CRISIS_PROJECTS.map((project) => ({ id: project.id, title: project.title }))], 'Сравните безопасную экономию электричества за один кредит. Первый шаг должен входить в выбранный набор.')}`;
      break;
  }
  return `<p class="campaign-panel-intro">${escape(introduction)}</p><div class="plan-controls">${controls}</div><div id="campaign-plan-preview" aria-live="polite" aria-atomic="true"></div><p class="demo-footnote">Вы меняете вымышленную учебную модель. Игровые кредиты не являются коммерческой сметой; реальные школьные устройства не переключаются.</p><div class="modal-actions plan-actions"><button class="button secondary" data-action="close">Вернуться к делу</button><button class="button primary" data-action="submit-plan">Применить и завершить дело</button></div>`;
}

export function readPlan(root: HTMLElement, level: CampaignCase): CampaignPlan {
  const numeric = (id: string): number => {
    const input = root.querySelector<HTMLInputElement>(`#${id}`);
    return input ? input.valueAsNumber : NaN;
  };
  const selected = (id: string): string => root.querySelector<HTMLSelectElement>(`#${id}`)?.value ?? '';
  const upgrades = (): string[] => Array.from(root.querySelectorAll<HTMLInputElement>('input[name="upgrade"]:checked'), (input) => input.value);
  switch (level.puzzle.kind) {
    case 'timeline': {
      const daylight = root.querySelector<HTMLInputElement>('#daylight-enabled')?.checked ?? false;
      return { kind: 'timeline', computerHours: numeric('computer-hours'), lightingHours: daylight ? numeric('lighting-hours') : 8, daylight };
    }
    case 'lighting': return { kind: 'lighting', windowMode: selected('window-mode'), interiorMode: selected('interior-mode'), stairsMode: selected('stairs-mode'), emergencyMode: selected('emergency-mode') };
    case 'kitchen': return { kind: 'kitchen', upgradeIds: upgrades() };
    case 'thermal': return { kind: 'thermal', classTemp: numeric('class-temp'), gymTemp: numeric('gym-temp'), measureIds: upgrades() };
    case 'crisis': return { kind: 'crisis', projectIds: upgrades(), priorityId: selected('priority-id') };
  }
}

function renderEnergyMetric(title: string, before: number, after: number): string {
  const difference = before - after;
  return `<div class="plan-metric"><span>${escape(title)}</span><strong>${escape(number(before))} → ${escape(number(after))} <small>кВт·ч</small></strong><small>${difference >= 0 ? 'Расчётная экономия' : 'Увеличение расхода'}: ${escape(number(Math.abs(difference)))} кВт·ч</small></div>`;
}

export function renderPlanPreview(result: PlanEvaluation): string {
  const electric = result.electricBeforeKwh > 0 || result.electricAfterKwh > 0
    ? renderEnergyMetric('Электрическая энергия · 20 учебных дней', result.electricBeforeKwh, result.electricAfterKwh)
    : '<p class="demo-footnote">Электрический расход в этой тепловой модели не рассчитывается.</p>';
  const heat = result.heatBeforeKwh !== undefined && result.heatAfterKwh !== undefined
    ? renderEnergyMetric('Тепловая энергия · отдельно', result.heatBeforeKwh, result.heatAfterKwh) : '';
  const withinBudget = result.budgetUsed !== undefined && result.budgetLimit !== undefined && result.budgetUsed <= result.budgetLimit;
  const budget = result.budgetUsed !== undefined && result.budgetLimit !== undefined
    ? `<div class="plan-budget${withinBudget ? '' : ' over-budget'}"><span>Бюджет: <strong>${result.budgetUsed} / ${result.budgetLimit} кредитов</strong></span><span>${withinBudget ? 'В пределах бюджета' : 'Бюджет превышен'}</span><meter min="0" max="${result.budgetLimit}" value="${result.budgetUsed}" aria-label="Использовано ${result.budgetUsed} из ${result.budgetLimit} игровых кредитов"></meter></div>` : '';
  const feedback = result.feedback.map((message) => `<li>${escape(message)}</li>`).join('');
  return `<section class="plan-preview${result.passes ? ' plan-passes' : ''}${result.safe ? '' : ' plan-unsafe'}" aria-label="Расчёт и проверка выбранного плана"><div class="plan-preview-heading"><strong>${result.passes ? 'Цель достигнута' : 'Проверка плана'}</strong><span>${result.safe ? 'Безопасность соблюдена' : 'Есть риск: план не принимается'}</span></div><div class="plan-metrics">${electric}${heat}</div>${budget}${!result.safe ? '<p class="plan-safety-warning">Расчётная экономия не делает небезопасный вариант допустимым. Измените меры, чтобы сохранить необходимые функции и комфорт.</p>' : ''}${feedback ? `<ul class="plan-feedback">${feedback}</ul>` : ''}${result.formulas.length ? `<details class="plan-formulas"><summary>Как получен расчёт</summary><ul>${result.formulas.map((formula) => `<li>${escape(formula)}</li>`).join('')}</ul></details>` : ''}${result.consequences.length ? `<div class="plan-consequences"><strong>Последствия выбранного режима</strong><ul>${result.consequences.map((consequence) => `<li>${escape(consequence)}</li>`).join('')}</ul></div>` : ''}</section>`;
}
