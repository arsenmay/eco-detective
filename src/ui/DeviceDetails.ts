import type { Equipment } from '../types';
import { calculateEquipmentEnergy, formatEnergy } from '../systems/energy';
import { icon } from './icons';

export type DeviceDetailsOptions = { modelAvailable?: boolean };

/** Device passports use the same energy function as every campaign report. */
export function renderDeviceDetails(
  device: Equipment,
  workingDays: number,
  recorded: boolean,
  options: DeviceDetailsOptions = {},
): string {
  const header = renderHeader(device, recorded);
  const actions = renderActions(device, recorded, options);
  const observation = renderObservation(device, recorded, workingDays);
  if (device.mode.powerWatts === 0) {
    const thermal = ['window', 'door', 'heating'].includes(device.category);
    return `<div class="device-details device-details-passive">${header}
      <div class="mode-line"><span>Тип источника</span><strong>${escapeHtml(device.mode.label)}</strong></div>
      <div class="passive-data-card"><span>${icon(thermal ? 'heating' : 'document')}</span><div><strong>${thermal ? 'Тепловой след' : 'Контекст расследования'}</strong><p>${thermal
        ? 'Это пассивный элемент тепловой модели. Потери тепла рассматриваются отдельно от потребления электричества: их нельзя прибавлять к электрическому балансу.'
        : 'Источник помогает проверить назначение оборудования, расписание или показания. Для него не вычисляется электрическое потребление.'}</p></div></div>
      ${observation}
      <p class="demo-footnote">Вымышленный учебный сценарий на основе условной модели школы. Документы и параметры заданы для обучения; это не измерения в СШ №225.</p>
      ${actions}</div>`;
  }
  const energy = calculateEquipmentEnergy(device, workingDays);
  const power = device.mode.powerWatts;
  const hours = device.mode.hoursPerDay;
  const quantity = device.quantity;
  const groupPower = power * quantity;
  return `<div class="device-details">${header}
    <div class="device-stats"><div><span>${quantity > 1 ? 'Мощность одного' : 'Мощность в модели'}</span><strong>${formatEnergy(power)}<small> Вт</small></strong></div><div><span>Время за сутки</span><strong>${formatEnergy(hours)}<small> ч</small></strong></div><div><span>Количество</span><strong>${quantity}<small> шт.</small></strong></div></div>
    <div class="mode-line"><span>Режим работы</span><strong>${escapeHtml(device.mode.label)}</strong></div>
    <div class="mode-line device-group-power"><span>${quantity > 1 ? 'Мощность всей группы' : 'Мощность устройства'}</span><strong>${formatEnergy(groupPower)} Вт${quantity > 1 ? ` <small>(${formatEnergy(power)} × ${quantity})</small>` : ''}</strong></div>
    <section class="energy-calculation" aria-label="Расчёт электрической энергии">
      <div><span>ЗА ${workingDays} УЧЕБНЫХ ДНЕЙ</span><strong>${formatEnergy(energy.monthlyKwh)} <small>кВт·ч</small></strong></div>${icon('bolt')}
      <div class="device-daily-total"><span>За один день</span><b>${formatEnergy(energy.dailyKwh)} кВт·ч</b></div>
      <p><b>E = P × t × n ÷ 1000</b><br>${formatEnergy(power)} Вт × ${formatEnergy(hours)} ч × ${quantity} шт. ÷ 1000 = ${formatEnergy(energy.dailyKwh)} кВт·ч / день</p>
      <p>${formatEnergy(energy.dailyKwh)} кВт·ч / день × ${workingDays} дней = ${formatEnergy(energy.monthlyKwh)} кВт·ч</p>
    </section>
    <div class="device-timeline"><span>ДЛИТЕЛЬНОСТЬ РАБОТЫ ЗА СУТКИ</span><div class="hours-track" role="img" aria-label="${formatEnergy(hours)} часов из 24"><i style="width:${hours / 24 * 100}%"></i></div><div class="device-duration-labels"><small>0 ч</small><strong>${formatEnergy(hours)} из 24 часов</strong><small>24 ч</small></div><p class="device-duration-note">Длительность показывает сумму часов, а не время включения.</p></div>
    ${observation}
    <p class="demo-footnote">Расчёт охватывает выбранные ${workingDays} учебных дней, а не весь календарный месяц. Все характеристики демонстрационные; это не реальные измерения СШ №225.</p>
    ${actions}</div>`;
}

function renderHeader(device: Equipment, recorded: boolean): string {
  return `<div class="device-inspection-card"><div class="device-schematic" aria-hidden="true"><span class="device-schematic-reticle"></span>${icon(device.category)}<small>ОБЪЕКТ / ЭКО</small></div><div class="device-summary"><div><span class="chip">${recorded ? 'ПАСПОРТ / ЗАПИСАНО' : 'ОСМОТР / ДЕМО ДАННЫЕ'}</span><p>${escapeHtml(device.description)}</p><span class="device-record-state">${icon(recorded ? 'check' : 'folder')}${recorded ? 'Наблюдение сохранено в блокноте' : 'Запишите наблюдение для отчёта'}</span></div></div></div>`;
}
function renderObservation(device: Equipment, recorded: boolean, workingDays: number): string {
  if (!recorded) return `<div class="scan-card"><span class="scan-emblem">${icon('search')}</span><div><strong>Источник доступен для изучения</strong><p>Запишите улику: наблюдение появится в блокноте и станет доступно для анализа.</p></div></div>`;
  const energy = device.mode.powerWatts > 0 ? calculateEquipmentEnergy(device, workingDays) : null;
  const savings = energy && device.proposedMode
    ? `<small>При ${formatEnergy(device.proposedMode.hoursPerDay)} ч/день и ${formatEnergy(device.proposedMode.powerWatts)} Вт: расчётный потенциал до ${formatEnergy(energy.potentialSavingsKwh)} кВт·ч за ${workingDays} учебных дней. Безопасность проверяется в плане.</small>`
    : '';
  return `<div class="evidence-note"><span>${icon('search')} НАБЛЮДЕНИЕ ДЕТЕКТИВА</span><p>${escapeHtml(device.evidence)}</p></div><div class="recommendation"><span>${icon('leaf')} ВЫВОД ДЛЯ ПРОВЕРКИ</span><p>${escapeHtml(device.recommendation)}</p>${savings}</div>`;
}
function renderActions(device: Equipment, recorded: boolean, options: DeviceDetailsOptions): string {
  const model = options.modelAvailable
    ? `<button class="button secondary device-model-button" data-action="inspect-3d" data-id="${escapeHtml(device.id)}">${icon('search')} Осмотреть модель в 3D</button>`
    : '';
  return `${model ? `<div class="device-model-actions">${model}</div>` : ''}<div class="modal-actions">${recorded
    ? `<button class="button secondary" data-action="notebook">К блокноту ${icon('folder')}</button><button class="button primary" data-action="close">В локацию ${icon('arrow')}</button>`
    : `<button class="button secondary" data-action="close">Позже</button><button class="button primary" data-action="record-evidence" data-id="${escapeHtml(device.id)}">Записать улику ${icon('check')}</button>`}</div>`;
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
