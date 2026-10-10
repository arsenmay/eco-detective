import type { CampaignCase, CampaignPlan, PlanEvaluation, Upgrade } from '../campaign/types';
import { calculateEnergyPlan } from './energyPlan';

export const KITCHEN_UPGRADES: readonly Upgrade[] = [
  { id: 'warmer-schedule', title: 'Расписание мармита', cost: 3, description: 'Нужные 3 часа раздачи сохраняются; 2 часа после закрытия убираем. Экономия 48 кВт·ч.' },
  { id: 'ventilation-timer', title: 'Таймер вытяжки', cost: 2, description: 'Сохраняем все 6 часов приготовления и обслуживания. Экономия 24 кВт·ч.' },
  { id: 'led', title: 'Светодиодное освещение', cost: 2, description: 'Та же видимость, мощность группы 100 вместо 180 Вт. Экономия 16 кВт·ч.' },
  { id: 'fridge-seals', title: 'Обслуживание уплотнителей', cost: 3, description: 'Средняя мощность холодильника 105 вместо 120 Вт; температура хранения сохраняется. Экономия 7,2 кВт·ч.' },
  { id: 'fridge-off', title: 'Полностью отключить холодильник', cost: 0, description: 'Убрать все 24 часа работы. Проверьте последствия для безопасности хранения продуктов.' },
  { id: 'freezer-off', title: 'Полностью отключить морозильник', cost: 0, description: 'Убрать все 24 часа работы. Проверьте, допустим ли перерыв в охлаждении.' },
];
export const THERMAL_MEASURES: readonly Upgrade[] = [
  { id: 'class-window', title: 'Уплотнение окна кабинета А', cost: 3, description: 'Коэффициент U снижается с 3 до 1,4 Вт/(м²·К), площадь 8 м².' },
  { id: 'gym-window', title: 'Утепление окон спортзала', cost: 4, description: 'Коэффициент U снижается с 3 до 1,5 Вт/(м²·К), площадь 16 м².' },
  { id: 'door', title: 'Уплотнение двери спортзала', cost: 2, description: 'Коэффициент U снижается с 4 до 2 Вт/(м²·К), площадь 4 м².' },
];
export const CRISIS_PROJECTS: readonly Upgrade[] = [
  { id: 'pc-sleep', title: 'Сон учебных компьютеров', cost: 2, description: '96 кВт·ч электричества: сохраняем работу и нужные часы, убираем ожидание.' },
  { id: 'hall-lighting', title: 'Группы света в холле', cost: 3, description: '30,24 кВт·ч электричества: дневной свет, присутствие, безопасные лестницы.' },
  { id: 'warmer-schedule', title: 'Расписание мармита', cost: 3, description: '48 кВт·ч электричества, питание во время раздачи сохраняется.' },
  { id: 'ventilation-timer', title: 'Таймер вытяжки', cost: 2, description: '24 кВт·ч электричества, необходимые 6 часов вытяжки сохраняются.' },
  { id: 'kitchen-led', title: 'Светодиоды в столовой', cost: 2, description: '16 кВт·ч электричества при той же освещённости.' },
  { id: 'gym-window', title: 'Окна спортзала', cost: 4, description: '61,44 кВт·ч тепла; не складывается с электричеством.' },
  { id: 'server-off', title: 'Отключить необходимую связь', cost: 0, description: 'Проверьте зависимые службы и безопасность.' },
  { id: 'dark-corridors', title: 'Оставить коридоры без света', cost: 0, description: 'Проверьте безопасность движения.' },
  { id: 'fridge-off', title: 'Прерывать охлаждение продуктов', cost: 0, description: 'Проверьте безопасность продуктов.' },
];
export const LIGHTING_OPTIONS = {
  windowMode: [ { id: 'always', title: 'Всегда · 10 ч' }, { id: 'daylight', title: 'Дневной свет · 4 ч' }, { id: 'presence', title: 'Присутствие · 6 ч' }, { id: 'off', title: 'Полностью выключить' } ],
  interiorMode: [ { id: 'always', title: 'Всегда · 10 ч' }, { id: 'presence', title: 'Присутствие · 6 ч' }, { id: 'off', title: 'Полностью выключить' } ],
  stairsMode: [ { id: 'always', title: 'Всегда · 12 ч' }, { id: 'schedule', title: 'Школа открыта · 8 ч' }, { id: 'sensor', title: 'Один датчик · 4 ч' }, { id: 'off', title: 'Полностью выключить' } ],
  emergencyMode: [ { id: 'always', title: 'Безопасное питание · 24 ч' }, { id: 'off', title: 'Полностью выключить' } ],
} as const;

const BASELINES = { timeline: 151.88, lighting: 73.44, kitchen: 470.4, thermal: 0, crisis: 705.32 } as const;
const HEAT_BASELINE = 262.912;
const EPSILON = 1e-8;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const format = (value: number): string => new Intl.NumberFormat('ru', { maximumFractionDigits: 3 }).format(value);

export function defaultPlan(investigation: CampaignCase): CampaignPlan {
  switch (investigation.puzzle.kind) {
    case 'timeline': return { kind: 'timeline', computerHours: 10, lightingHours: 8, daylight: false };
    case 'lighting': return { kind: 'lighting', windowMode: 'always', interiorMode: 'always', stairsMode: 'always', emergencyMode: 'always' };
    case 'kitchen': return { kind: 'kitchen', upgradeIds: [] };
    case 'thermal': return { kind: 'thermal', classTemp: 22, gymTemp: 20, measureIds: [] };
    case 'crisis': return { kind: 'crisis', projectIds: [], priorityId: '' };
  }
}

function initialResult(investigation: CampaignCase): PlanEvaluation {
  const kind = investigation.puzzle.kind;
  return {
    safe: true, passes: false, feedback: [],
    electricBeforeKwh: BASELINES[kind], electricAfterKwh: BASELINES[kind],
    ...((kind === 'thermal' || kind === 'crisis') ? { heatBeforeKwh: HEAT_BASELINE, heatAfterKwh: HEAT_BASELINE } : {}),
    formulas: [], consequences: [],
  };
}
function invalidate(result: PlanEvaluation, message: string): PlanEvaluation {
  result.safe = false;
  result.passes = false;
  result.feedback.push(message);
  return result;
}
function projectSelection(value: unknown, options: readonly Upgrade[]): string[] | null {
  if (!Array.isArray(value) || value.length > options.length || value.some((id) => typeof id !== 'string')) return null;
  const selected: string[] = value;
  return new Set(selected).size === selected.length && selected.every((id) => options.some((option) => option.id === id)) ? selected : null;
}
function budget(result: PlanEvaluation, ids: string[], options: readonly Upgrade[], limit: number): boolean {
  result.budgetLimit = limit;
  result.budgetUsed = ids.reduce((sum, id) => sum + options.find((option) => option.id === id)!.cost, 0);
  if (result.budgetUsed > limit) {
    result.feedback.push(`План стоит ${result.budgetUsed} кредитов при бюджете ${limit}. Выберите совместимые меры в пределах бюджета.`);
    return false;
  }
  return true;
}

/** Demonstration models only. Invalid/unsafe proposals yield feedback, never completion. */
export function evaluatePlan(investigation: CampaignCase, plan: CampaignPlan): PlanEvaluation {
  const result = initialResult(investigation);
  if (!plan || plan.kind !== investigation.puzzle.kind) return invalidate(result, 'Тип плана не соответствует этому расследованию.');
  switch (plan.kind) {
    case 'timeline': {
      if (!finite(plan.computerHours) || !finite(plan.lightingHours) || typeof plan.daylight !== 'boolean'
        || plan.computerHours < 2 || plan.computerHours > 10 || plan.lightingHours < 4 || plan.lightingHours > 8) {
        return invalidate(result, 'Сохраните 2–10 часов ожидания компьютеров и 4–8 часов освещения. Нужные уроки и связь не изменяются.');
      }
      const energy = calculateEnergyPlan(plan);
      result.electricAfterKwh = energy.monthlyKwh;
      if (plan.lightingHours < 8 && !plan.daylight) invalidate(result, 'Уменьшать работу света можно только после подтверждения достаточного дневного освещения.');
      result.formulas = [ 'E = P × t × количество × 20 / 1000.', `Компьютеры и мониторы: (80 + 20) × 6 × ${format(plan.computerHours)} × 20 / 1000.`, `Расчётная экономия: ${format(energy.savingsKwh)} кВт·ч электричества.` ];
      result.consequences = [
        'Настройки относятся только к учебной модели; реальные устройства не переключаются.',
        'Связь, уроки проектора и работа учителя сохранены. Перед сном компьютеров файлы сохраняют.',
        plan.lightingHours < 8 && !plan.daylight
          ? 'Видимость рабочих мест не подтверждена: свет сокращён без проверки дневного освещения. Такой вариант нельзя принять.'
          : 'Освещение сохраняет заданные часы; сокращённый режим допустим только при подтверждённом дневном свете.',
      ];
      if (energy.savingsKwh + EPSILON < 84) result.feedback.push('Вернитесь к временной шкале: 8 часов ожидания приходятся на пустой кабинет. Достигните не менее 84 кВт·ч безопасной расчётной экономии.');
      result.passes = result.safe && energy.savingsKwh + EPSILON >= 84;
      break;
    }
    case 'lighting': {
      const tables = {
        windowMode: { always: 10, daylight: 4, presence: 6, off: 0 },
        interiorMode: { always: 10, presence: 6, off: 0 },
        stairsMode: { always: 12, schedule: 8, sensor: 4, off: 0 },
        emergencyMode: { always: 24, off: 0 },
      };
      const values: number[] = [];
      for (const field of ['windowMode', 'interiorMode', 'stairsMode', 'emergencyMode'] as const) {
        const options = tables[field] as Record<string, number>;
        if (typeof plan[field] !== 'string' || !Object.hasOwn(options, plan[field])) return invalidate(result, 'Выберите известный режим каждой группы света.');
        values.push(options[plan[field]]!);
      }
      result.electricAfterKwh = (108 * values[0]! + 144 * values[1]! + 72 * values[2]! + 12 * values[3]!) * 20 / 1000;
      if (plan.windowMode === 'off' || plan.interiorMode === 'off') invalidate(result, 'Рабочие зоны нельзя оставлять без достаточного света. Используйте дневной свет или проверенное присутствие.');
      if (plan.stairsMode === 'off' || plan.stairsMode === 'sensor') invalidate(result, 'Один датчик не видит всю лестницу. Свет на лестнице нужен все 8 часов открытой школы.');
      if (plan.emergencyMode !== 'always') invalidate(result, 'Необходимое аварийное освещение остаётся доступным круглосуточно.');
      const savings = result.electricBeforeKwh - result.electricAfterKwh;
      result.formulas = [ 'E = Σ(P группы × часы × 20 / 1000).', `108 × ${values[0]} + 144 × ${values[1]} + 72 × ${values[2]} + 12 × ${values[3]} ватт-часов за день.`, `После настройки: ${format(result.electricAfterKwh)} кВт·ч; экономия ${format(savings)} кВт·ч.` ];
      result.consequences = [
        plan.windowMode === 'off'
          ? 'Группа у окон выключена полностью: утром и вечером достаточная видимость не обеспечена.'
          : plan.windowMode === 'daylight'
            ? 'Группа у окон использует подтверждённый дневной свет; утром и вечером искусственное освещение остаётся.'
            : 'Группа у окон сохраняет необходимое искусственное освещение в выбранные часы.',
        plan.interiorMode === 'off'
          ? 'В глубине коридора света недостаточно: дневной свет сюда не заменяет выключенную группу.'
          : 'Внутренний коридор освещён в необходимые часы присутствия.',
        plan.stairsMode === 'off'
          ? 'Лестница остаётся без искусственного света во время доступа: видимость ступеней не обеспечена.'
          : plan.stairsMode === 'sensor'
            ? 'Датчик не видит часть лестницы и может погасить свет при движении людей: возникают тёмные ступени.'
            : 'Лестница сохраняет непрерывное безопасное освещение во время доступа.',
        plan.emergencyMode === 'off'
          ? 'Аварийное освещение отключено: необходимая круглосуточная готовность потеряна.'
          : 'Аварийное освещение сохраняет необходимую круглосуточную готовность.',
      ];
      if (savings + EPSILON < 20) result.feedback.push('Настройте группы по разным условиям: нужно сэкономить не менее 20 кВт·ч, сохранив безопасность.');
      result.passes = result.safe && savings + EPSILON >= 20;
      break;
    }
    case 'kitchen': {
      const ids = projectSelection(plan.upgradeIds, KITCHEN_UPGRADES);
      if (!ids) return invalidate(result, 'Выберите известные меры без повторений.');
      const withinBudget = budget(result, ids, KITCHEN_UPGRADES, investigation.puzzle.budget ?? 5);
      const savings: Record<string, number> = { 'warmer-schedule': 48, 'ventilation-timer': 24, led: 16, 'fridge-seals': 7.2, 'fridge-off': 57.6, 'freezer-off': 76.8 };
      result.electricAfterKwh -= ids.reduce((sum, id) => sum + (id === 'fridge-seals' && ids.includes('fridge-off') ? 0 : savings[id]!), 0);
      if (ids.includes('fridge-off') || ids.includes('freezer-off')) invalidate(result, 'Холодильник и морозильник сохраняют безопасную температуру 24 часа. Их отключение нарушает хранение продуктов.');
      if (ids.includes('fridge-off') && ids.includes('fridge-seals')) result.feedback.push('Обслуживание уплотнителей не даёт дополнительной экономии у полностью отключённого холодильника. Эти меры нельзя складывать; риск для продуктов остаётся.');
      const saved = result.electricBeforeKwh - result.electricAfterKwh;
      result.formulas = [ 'Для холодильников используется средняя мощность с учётом циклов, не номинал компрессора.', 'Мармит: 1200 × (5 − 3) × 20 / 1000 = 48 кВт·ч.', 'Вытяжка: 300 × (10 − 6) × 20 / 1000 = 24 кВт·ч.', `Расход после мер: ${format(result.electricAfterKwh)} кВт·ч; экономия ${format(saved)} кВт·ч.` ];
      result.consequences = [
        'Нужные часы приготовления, раздачи и вытяжки сохранены; выбранные расписания убирают работу вне этих часов.',
        ids.includes('fridge-off')
          ? 'Холодильник отключён: безопасное охлаждение продуктов прерывается, появляется риск порчи.'
          : 'Холодильник сохраняет непрерывное безопасное охлаждение продуктов.',
        ids.includes('freezer-off')
          ? 'Морозильник отключён: замороженные продукты могут оттаять, безопасное хранение не обеспечено.'
          : 'Морозильник сохраняет непрерывный безопасный режим хранения.',
        'Бюджет выражен игровыми кредитами; это не коммерческая смета.',
        ...(!withinBudget ? ['Вариант превышает бюджет и не может быть принят, даже если его режимы безопасны.'] : []),
      ];
      if (saved + EPSILON < 64) result.feedback.push('Изучите пик после закрытия. Нужно не менее 64 кВт·ч экономии; сравните полезность мер за один кредит.');
      result.passes = result.safe && withinBudget && saved + EPSILON >= 64;
      break;
    }
    case 'thermal': {
      const ids = projectSelection(plan.measureIds, THERMAL_MEASURES);
      if (!ids || !finite(plan.classTemp) || !finite(plan.gymTemp) || plan.classTemp < 4 || plan.classTemp > 40 || plan.gymTemp < 4 || plan.gymTemp > 40) {
        return invalidate(result, 'Проверьте температуры и выберите известные меры без повторений.');
      }
      const withinBudget = budget(result, ids, THERMAL_MEASURES, investigation.puzzle.budget ?? 6);
      if (plan.classTemp < 20 || plan.classTemp > 22 || plan.gymTemp < 18 || plan.gymTemp > 20) invalidate(result, 'Комфорт модели: в кабинете 20–22 °C, в спортзале 18–20 °C. Понижение ниже границы не принимается как экономия.');
      const classU = ids.includes('class-window') ? 1.4 : 3;
      const gymU = ids.includes('gym-window') ? 1.5 : 3;
      const doorU = ids.includes('door') ? 2 : 4;
      result.heatAfterKwh = ((classU * 8 + 1.3 * 8) * (plan.classTemp - 4) + (gymU * 16 + doorU * 4) * (plan.gymTemp - 4)) * 8 * 20 / 1000;
      const saved = HEAT_BASELINE - result.heatAfterKwh;
      result.formulas = [ 'Q = U × A × (T внутри − T снаружи) × 8 × 20 / 1000.', 'U: Вт/(м²·К), A: м², наружная температура 4 °C.', `Тепловая энергия: ${format(HEAT_BASELINE)} → ${format(result.heatAfterKwh)} кВт·ч; экономия ${format(saved)} кВт·ч тепла.` ];
      result.consequences = [
        'Упрощённая модель только теплопередачи: не учитывает вентиляцию, солнце и тепловую инерцию.',
        'Тепло не приравнивается к электричеству: источник отопления и его КПД не заданы.',
        `Температура модели: кабинет ${format(plan.classTemp)} °C, спортзал ${format(plan.gymTemp)} °C.`,
        plan.classTemp < 20 || plan.classTemp > 22 || plan.gymTemp < 18 || plan.gymTemp > 20
          ? 'Температура выходит за пределы заданного комфорта. Меньший расчётный расход не оправдывает дискомфорт; вариант нельзя принять.'
          : 'Температура обоих помещений остаётся в заданных пределах комфорта.',
        ...(!withinBudget ? ['Вариант превышает бюджет: выбранные меры нельзя принять в этой комбинации.'] : []),
      ];
      if (saved + EPSILON < 80) result.feedback.push('Сравните U, площадь и разницу температур вместе. Нужно не менее 80 кВт·ч тепловой экономии при комфортной температуре.');
      result.passes = result.safe && withinBudget && saved + EPSILON >= 80;
      break;
    }
    case 'crisis': {
      const ids = projectSelection(plan.projectIds, CRISIS_PROJECTS);
      if (!ids || typeof plan.priorityId !== 'string') return invalidate(result, 'Выберите известные проекты и обоснованный первый шаг.');
      const withinBudget = budget(result, ids, CRISIS_PROJECTS, investigation.puzzle.budget ?? 10);
      const electricSavings: Record<string, number> = { 'pc-sleep': 96, 'hall-lighting': 30.24, 'warmer-schedule': 48, 'ventilation-timer': 24, 'kitchen-led': 16, 'gym-window': 0, 'server-off': 9.6, 'dark-corridors': 73.44, 'fridge-off': 57.6 };
      result.electricAfterKwh -= ids.reduce((sum, id) => sum + (id === 'hall-lighting' && ids.includes('dark-corridors') ? 0 : electricSavings[id]!), 0);
      result.heatAfterKwh = HEAT_BASELINE - (ids.includes('gym-window') ? 61.44 : 0);
      if (ids.includes('server-off')) invalidate(result, 'Необходимая связь обслуживает другие системы. Отключение сервера прерывает их работу.');
      if (ids.includes('dark-corridors')) invalidate(result, 'Тёмные коридоры ухудшают безопасность и условия обучения.');
      if (ids.includes('dark-corridors') && ids.includes('hall-lighting')) result.feedback.push('Настройка групп света не даёт дополнительной экономии, если все эти группы уже отключены. Эти меры нельзя складывать; безопасное освещение всё равно не обеспечено.');
      if (ids.includes('fridge-off')) invalidate(result, 'Хранение продуктов требует непрерывного безопасного охлаждения.');
      const electricSaved = result.electricBeforeKwh - result.electricAfterKwh;
      const heatSaved = HEAT_BASELINE - result.heatAfterKwh;
      const priorityCorrect = ids.includes(plan.priorityId) && plan.priorityId === 'pc-sleep';
      if (!priorityCorrect) result.feedback.push('Первый шаг по критерию безопасной экономии электричества за кредит — сон компьютеров: 96 / 2 = 48 кВт·ч за кредит. Выберите его в плане и первым приоритетом.');
      if (electricSaved + EPSILON < 120 || heatSaved + EPSILON < 40) result.feedback.push('Комплексный план должен дать минимум 120 кВт·ч электрической и отдельно 40 кВт·ч тепловой экономии. Не складывайте эти показатели.');
      result.formulas = [ 'Электрическая база: 151,88 + 73,44 + 470,4 + 9,6 = 705,32 кВт·ч.', `Электричество: ${format(result.electricAfterKwh)} кВт·ч; экономия ${format(electricSaved)} кВт·ч.`, `Тепло: ${format(result.heatAfterKwh)} кВт·ч; экономия ${format(heatSaved)} кВт·ч (отдельно).` ];
      result.consequences = [
        'Режим компьютеров требует предварительного сохранения файлов; необходимое время занятий остаётся.',
        ids.includes('server-off')
          ? 'Необходимая связь отключена: работа зависимых служб прерывается.'
          : 'Необходимая связь и работа зависимых служб сохраняются.',
        ids.includes('dark-corridors')
          ? 'Коридоры оставлены без света: безопасная видимость и готовность аварийных путей не обеспечены.'
          : 'Безопасное освещение коридоров и аварийная готовность сохраняются.',
        ids.includes('fridge-off')
          ? 'Охлаждение продуктов прерывается: возникает риск порчи и небезопасного хранения.'
          : 'Непрерывное безопасное охлаждение продуктов сохраняется.',
        'Температурные режимы сохраняют комфорт; электричество и тепло показаны раздельно.',
        'Моделируются только выбранные меры; реальные системы школы не управляются.',
        ...(!withinBudget ? ['Вариант превышает бюджет: комплекс мер не может быть принят целиком.'] : []),
      ];
      result.passes = result.safe && withinBudget && priorityCorrect && electricSaved + EPSILON >= 120 && heatSaved + EPSILON >= 40;
      break;
    }
  }
  if (result.passes) result.feedback.push('План обоснован: цель достигнута, ограничения безопасности и комфорта соблюдены.');
  return result;
}
