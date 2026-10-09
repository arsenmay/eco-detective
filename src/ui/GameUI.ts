import type { EnergyPlan, Equipment, GameBridge, Progress, RoomController, Settings } from '../types';
import { INITIAL_POSITION, SCHOOL_CASE } from '../data/schoolCase';
import { calculateEquipmentEnergy, formatEnergy } from '../systems/energy';
import { canSubmitReport, evaluateReport, getInvestigationSavings, getMonthlyBaseline, inspectEquipment } from '../systems/investigation';
import { createProgress, loadProgress, loadSettings, saveProgress, saveSettings } from '../systems/storage';
import { icon } from './icons';
import { applyEnergyPlan, calculateEnergyPlan, DEFAULT_ENERGY_PLAN } from '../systems/energyPlan';
import { FeedbackAudio } from './FeedbackAudio';
import { VirtualJoystick } from './VirtualJoystick';

const escape = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const requiredNames = (): string[] => SCHOOL_CASE.requiredDeviceIds.map((id) => SCHOOL_CASE.equipment.find((device) => device.id === id)!.shortName);

export class GameUI {
  readonly roomParent: HTMLElement;
  readonly bridge: GameBridge;
  private controller: RoomController | null = null;
  private progress: Progress | null = loadProgress();
  private settings: Settings = loadSettings();
  private playing = false;
  private ready = false;
  private nearby: string | null = null;
  private modalOpen = false;
  private selectedOption: string | null = null;
  private persistFailed = false;
  private lastSavedAt = 0;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private previousFocus: HTMLElement | null = null;
  private readonly audio = new FeedbackAudio();
  private draftPlan: EnergyPlan = { ...DEFAULT_ENERGY_PLAN };
  private joystick?: VirtualJoystick;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = this.shell();
    this.roomParent = root.querySelector<HTMLElement>('#room-canvas')!;
    root.querySelector('.room-frame')!.append(root.querySelector('.touch-controls')!);
    this.bridge = {
      onReady: () => { this.ready = true; this.updateMenu(); this.applyControllerState(); },
      onNearby: (id) => { this.nearby = id; this.updateNearby(); },
      onInteract: (id) => { if (this.playing && !this.modalOpen) this.openEquipment(id, true); },
      onPosition: (position) => {
        if (!this.progress || !this.playing) return;
        this.progress.playerPosition = position;
        if (Date.now() - this.lastSavedAt > 1200) this.persist();
      },
    };
    root.addEventListener('click', (event) => this.handleClick(event));
    root.addEventListener('change', (event) => this.handleChange(event));
    root.addEventListener('input', (event) => this.handlePlanInput(event));
    document.addEventListener('keydown', (event) => this.handleKey(event));
    window.addEventListener('pagehide', () => this.persist());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.persist(); this.controller?.setActive(false); }
      else this.syncActive();
    });
    this.bindTouchControls();
    this.applySettings();
    this.updateMenu();
    this.updateHud();
  }

  connect(controller: RoomController): void {
    this.controller = controller;
    this.applyControllerState();
  }

  showLauncherNotice(message: string): void { this.toast(message); }

  saveBeforeReload(): void { this.persist(); }

  showInstallationGuide(): void {
    this.showModal('Игра на вашем устройстве', `<div class="help-steps"><p><span>01</span><strong>Android и компьютер</strong><small>Откройте меню браузера Chrome или Edge и выберите «Установить приложение». Когда браузер предложит установку, кнопка «Установить» откроет этот запрос.</small></p><p><span>02</span><strong>iPhone и iPad</strong><small>Откройте игру в Safari, нажмите «Поделиться», затем «На экран Домой». Игра появится отдельным значком.</small></p><p><span>03</span><strong>Первое открытие — с интернетом</strong><small>Дождитесь надписи «Готова к игре без интернета». После этого можно открывать игру значком и продолжать расследование без сети.</small></p></div><p class="demo-footnote">Установка зависит от браузера и доступна в опубликованной HTTPS-версии. Сохранение остаётся на этом устройстве; очистка данных браузера удаляет офлайн-копию и прогресс.</p><div class="modal-actions"><button class="button primary" data-action="close">Понятно ${icon('check')}</button></div>`, 'БЫСТРЫЙ ЗАПУСК');
  }

  showSharingGuide(url: string | null): void {
    const content = url ? `<p>Отправьте эту ссылку: получатель сможет открыть игру на телефоне или компьютере.</p><label class="share-link-label">Ссылка на игру<input id="share-link" class="share-link" readonly value="${escape(url)}" /></label><div class="modal-actions"><button class="button secondary" data-action="select-link">Выделить ссылку</button><button class="button primary" data-action="close">Готово ${icon('check')}</button></div>` : `<p>Общий доступ появится после публикации игры. Тогда эта кнопка позволит отправить постоянную ссылку друзьям на телефоны и компьютеры.</p><div class="modal-actions"><button class="button primary" data-action="close">Понятно ${icon('check')}</button></div>`;
    this.showModal('Поделиться игрой', content, 'ИГРАЙТЕ ВМЕСТЕ');
  }

  private shell(): string {
    return `<div class="app-shell menu-mode">
      <header class="topbar">
        <a class="brand" href="#" data-action="menu" aria-label="ECO DETECTIVE — главное меню">
          <span class="brand-mark">${icon('leaf')}</span><span>ECO<span class="brand-light">DETECTIVE</span><small>БЮРО ЭНЕРГЕТИЧЕСКИХ РАССЛЕДОВАНИЙ</small></span>
        </a>
        <div class="topbar-right"><span class="system-status"><i></i> ЛОКАЛЬНЫЙ РЕЖИМ</span><button class="icon-button" data-action="help" aria-label="Как играть">${icon('info')}</button><button class="icon-button" data-action="settings" aria-label="Настройки">${icon('settings')}</button><button class="top-menu-button" data-action="menu">Меню</button></div>
      </header>
      <div class="workspace">
        <aside class="case-sidebar" aria-label="Материалы расследования">
          <div class="case-heading"><span class="eyebrow">АКТИВНОЕ РАССЛЕДОВАНИЕ</span><div class="case-number">ДЕЛО <span>001</span><span class="case-tag">В РАБОТЕ</span></div><h1>Школьная<br>аномалия</h1><p>Условная модель СШ №225<br>Минск, кабинет информатики</p></div>
          <div class="sidebar-section"><div class="section-title">ХОД РАССЛЕДОВАНИЯ <span id="evidence-count">0 / 6</span></div><div class="progress-track"><div id="evidence-progress"></div></div><p class="objective">Осмотрите компьютеры, проектор и сетевое оборудование. Сравните режимы работы.</p><ol class="case-steps"><li id="step-inspect"><span>01</span><div>Собрать свидетельства<small>Три ключевые группы устройств</small></div></li><li id="step-report"><span>02</span><div>Проверить гипотезу<small>Мощность × время работы</small></div></li><li id="step-solved"><span>03</span><div>Проверить решение<small>Лаборатория энергии</small></div></li></ol></div>
          <div class="sidebar-section evidence-section"><div class="section-title">ВАШ БЛОКНОТ ${icon('folder')}</div><div id="evidence-list"></div></div>
          <div class="sidebar-footer"><button id="report-button" class="button primary full-width" data-action="report" disabled>${icon('folder')} Предварительный отчёт ${icon('arrow')}</button><p id="report-hint" class="report-hint">Сначала соберите ключевые свидетельства</p><button id="plan-button" class="button secondary full-width" data-action="energy-plan" hidden>${icon('bolt')} Лаборатория энергии ${icon('arrow')}</button><div class="save-status" id="save-status">${icon('save')} Автосохранение на этом устройстве</div></div>
        </aside>
        <main class="scene-area">
          <div class="mobile-hud"><button data-action="menu" class="icon-button" aria-label="Главное меню">${icon('back')}</button><div><span>ДЕЛО 001 / ЛОКАЦИЯ</span><strong>Школьная аномалия</strong></div><button data-action="notebook" class="mobile-notebook" aria-label="Блокнот и задания">${icon('folder')} <b id="mobile-evidence-count">0/6</b></button><button data-action="settings" class="icon-button" aria-label="Настройки">${icon('settings')}</button></div><div class="scene-heading"><div><span class="eyebrow">ЛОКАЦИЯ 01 / ИССЛЕДОВАНИЕ</span><h2>Кабинет информатики <span>2 этаж</span></h2></div><div class="room-status"><i></i> СИМУЛЯЦИЯ АКТИВНА</div></div>
          <div class="mission-strip"><span class="mission-avatar">${icon('search')}</span><div><span id="mission-phase">БЮРО / ЗАДАНИЕ</span><p id="mission-message">Найдите причины лишнего расхода энергии.</p></div><button class="icon-button" data-action="briefing" aria-label="Открыть задание">${icon('folder')}</button></div>
          <div class="room-frame"><div class="camera-tools"><button data-action="notebook" aria-label="Блокнот и текущая цель">${icon('folder')}</button><button data-action="zoom-in" aria-label="Приблизить">+</button><button data-action="zoom-out" aria-label="Отдалить">−</button><button data-action="fullscreen" aria-label="Полноэкранный режим">⛶</button></div><div id="room-canvas" role="img" aria-label="Игровой кабинет информатики. Управляйте персонажем WASD или стрелками, E — осмотр." tabindex="0"></div><div class="room-label">${icon('search')} <span>РЕЖИМ ДЕТЕКТИВА</span></div><div class="room-coordinate"><span>N</span><i>↑</i></div><div class="room-scale"><span></span> 1 ИГРОВОЙ МЕТР</div><div class="scan-legend"><i></i> ОБЪЕКТ ДЛЯ ОСМОТРА</div></div>
          <div class="scene-footer"><div id="nearby-hint" class="nearby-hint">${icon('search')} Подойдите к устройству с бирюзовой меткой</div><div class="keyboard-guide"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> движение</span><span><kbd>E</kbd> осмотр</span></div></div>
          <div class="touch-controls" aria-label="Сенсорное управление"><div id="virtual-joystick" class="virtual-joystick" aria-label="Виртуальный джойстик: двигайте палец в нужном направлении"><span class="joystick-knob">${icon('search')}</span></div><button id="touch-interact" class="touch-interact" data-action="interact" disabled>${icon('search')}<span>Осмотреть</span></button></div>
          <p class="scenario-note">Вымышленная планировка и учебные ситуации. Показатели демонстрационные, а не измерения в школе.</p>
        </main>
      </div>
      <section id="main-menu" class="main-menu" aria-label="Главное меню">
        <div class="menu-content"><div class="menu-kicker"><span></span> ОБРАЗОВАТЕЛЬНАЯ ДЕТЕКТИВНАЯ ИГРА</div><h1 class="menu-title">ECO<br><span>DETECTIVE</span><span class="title-dot">.</span></h1><p class="menu-subtitle">Тайна пропавшей энергии</p><p class="menu-description">Энергия не исчезает бесследно.<br>Изучайте улики. Проверяйте гипотезы.<br>Найдите то, что осталось незамеченным.</p>
          <div class="menu-actions"><button class="button primary menu-start" data-action="new" disabled>Начать расследование ${icon('arrow')}</button><button id="continue-button" class="button secondary" data-action="continue" disabled>Продолжить ${icon('time')}<small id="continue-detail">Пока нет сохранённого дела</small></button><div class="menu-links"><button data-action="cases">${icon('folder')} Выбор дела</button><button data-action="achievements">${icon('trophy')} Достижения</button><button data-action="settings">${icon('settings')} Настройки</button></div></div>
          <div class="launcher-actions"><button id="install-game" class="launcher-button">${icon('save')} Установить</button><button id="share-game" class="launcher-button">${icon('arrow')} Поделиться игрой</button></div><p id="offline-status" class="offline-status" role="status" aria-live="polite"></p>
          <div class="menu-meta"><span>01 КОМНАТА</span><span>06 ОБЪЕКТОВ</span><span>ОДНА ТАЙНА</span></div>
        </div>
        <div class="menu-case-preview"><div class="preview-cross">+</div><span class="eyebrow">ПЕРВОЕ ДЕЛО</span><h2>Школьная аномалия</h2><p>Минск · Условная модель СШ №225</p><div class="preview-line"><span class="status-dot"></span> НУЖНО ВАШЕ РАССЛЕДОВАНИЕ <span>001</span></div></div>
        <div class="menu-bottom"><span>УЧИТЕСЬ ЗАМЕЧАТЬ. УЧИТЕСЬ БЕРЕЧЬ.</span><span>ПРОТОТИП / v0.2</span></div>
      </section>
      <div id="modal-layer" class="modal-layer" hidden></div>
      <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
    </div>`;
  }

  private handleClick(event: MouseEvent): void {
    const button = (event.target as Element).closest<HTMLElement>('[data-action]');
    if (!button || button.matches(':disabled')) return;
    event.preventDefault();
    const action = button.dataset.action;
    switch (action) {
      case 'new': this.progress ? this.confirmNew() : this.startNew(); break;
      case 'confirm-new': this.startNew(); break;
      case 'continue': if (this.progress) this.startGame(); break;
      case 'menu': this.goToMenu(); break;
      case 'close': this.closeModal(); break;
      case 'cases': this.showCases(); break;
      case 'case-play': if (this.progress) this.startGame(); else this.startNew(); break;
      case 'achievements': this.showAchievements(); break;
      case 'settings': this.showSettings(); break;
      case 'help': this.showHelp(); break;
      case 'interact': this.controller?.interact(); break;
      case 'evidence': if (button.dataset.id && this.progress?.inspectedIds.includes(button.dataset.id)) this.openEquipment(button.dataset.id, false); break;
      case 'report': if (this.progress && canSubmitReport(this.progress)) this.showReport(); break;
      case 'submit-report': this.submitReport(); break;
      case 'retry-report': this.showReport(); break;
      case 'briefing': this.showBriefing(); break;
      case 'record-evidence': if (button.dataset.id) this.recordEvidence(button.dataset.id); break;
      case 'energy-plan': if (this.progress?.reportSolved) this.showEnergyPlan(); break;
      case 'apply-plan': this.commitEnergyPlan(); break;
      case 'reset-plan': this.draftPlan = { computerHours: 10, lightingHours: 8 }; this.showEnergyPlan(false); break;
      case 'notebook': this.showNotebook(); break;
      case 'zoom-in': this.controller?.changeZoom(.15); break;
      case 'zoom-out': this.controller?.changeZoom(-.15); break;
      case 'fullscreen': void this.toggleFullscreen(); break;
      case 'select-link': this.root.querySelector<HTMLInputElement>('#share-link')?.select(); break;
    }
  }

  private handleChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.name === 'report-option') {
      this.selectedOption = input.value;
      this.root.querySelector<HTMLButtonElement>('#submit-report')!.disabled = false;
    }
    if (input.dataset.setting) {
      const key = input.dataset.setting as keyof Settings;
      if (key === 'joystickSensitivity') this.settings.joystickSensitivity = Math.min(1.5, Math.max(.5, input.valueAsNumber || 1));
      else this.settings[key] = input.checked;
      const saved = saveSettings(this.settings);
      this.applySettings();
      if (key === 'soundEnabled' && input.checked) this.audio.play('clue');
      if (!saved) this.toast('Настройки действуют до закрытия страницы: хранилище браузера недоступно.');
    }
    if (input.id === 'daylight-confirmed') {
      const range = this.root.querySelector<HTMLInputElement>('#lighting-hours')!;
      range.disabled = !input.checked;
      if (!input.checked) { this.draftPlan.lightingHours = 8; range.value = '8'; }
      this.updatePlanPreview();
    }
  }

  private handlePlanInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.id !== 'computer-hours' && input.id !== 'lighting-hours') return;
    if (!Number.isFinite(input.valueAsNumber)) return;
    if (input.id === 'computer-hours') this.draftPlan.computerHours = input.valueAsNumber;
    else this.draftPlan.lightingHours = input.valueAsNumber;
    this.updatePlanPreview();
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.code === 'Escape' && event.repeat) { event.preventDefault(); return; }
    if (!this.modalOpen) {
      if (event.code === 'Escape' && this.playing) { event.preventDefault(); this.goToMenu(); }
      return;
    }
    if (event.code === 'Escape') { event.preventDefault(); this.closeModal(); }
    if (event.code === 'Tab') {
      const items = [...this.root.querySelectorAll<HTMLElement>('#modal-layer button:not(:disabled), #modal-layer input, #modal-layer [tabindex="0"]')];
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }

  private bindTouchControls(): void {
    this.joystick = new VirtualJoystick(this.root.querySelector<HTMLElement>('#virtual-joystick')!, (vector) => this.controller?.setTouchVector(vector), this.settings.joystickSensitivity);
    this.root.querySelector<HTMLButtonElement>('#touch-interact')!.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch' || !this.playing || this.modalOpen || (event.currentTarget as HTMLButtonElement).disabled) return;
      // A second finger does not generate the same synthetic click as the
      // primary touch. Interact directly so movement + inspection works.
      event.preventDefault();
      this.controller?.interact();
    });
  }

  private applyControllerState(): void {
    if (!this.controller) return;
    this.controller.setReducedMotion(this.settings.reducedMotion);
    this.controller.setInspected(this.progress?.inspectedIds ?? []);
    this.controller.setEnergyPlan(this.progress?.appliedPlan ?? null);
    this.controller.setPlayerPosition(this.progress?.playerPosition ?? INITIAL_POSITION);
    this.syncActive();
  }

  private syncActive(): void {
    const active = this.playing && !this.modalOpen && !document.hidden;
    if (!active) this.joystick?.reset();
    this.controller?.setActive(active);
  }

  private startNew(): void {
    this.progress = createProgress();
    this.persist();
    this.startGame();
    this.showBriefing();
  }

  private startGame(): void {
    if (!this.ready || !this.progress) return;
    this.closeModal(false);
    this.playing = true;
    this.root.querySelector('.app-shell')!.classList.remove('menu-mode');
    this.root.querySelector<HTMLElement>('#main-menu')!.hidden = true;
    this.applyControllerState();
    this.updateHud();
    this.roomParent.focus({ preventScroll: true });
  }

  private goToMenu(): void {
    this.persist(); this.playing = false;
    this.closeModal(false); this.syncActive();
    this.root.querySelector('.app-shell')!.classList.add('menu-mode');
    this.root.querySelector<HTMLElement>('#main-menu')!.hidden = false;
    this.updateMenu();
    this.root.querySelector<HTMLElement>('.menu-start')!.focus({ preventScroll: true });
  }

  private persist(): void {
    if (!this.progress) return;
    if (this.controller && this.playing) this.progress.playerPosition = this.controller.getPlayerPosition();
    this.progress.updatedAt = new Date().toISOString();
    this.persistFailed = !saveProgress(this.progress);
    this.lastSavedAt = Date.now();
    this.updateSaveStatus();
  }

  private applySettings(): void {
    this.root.classList.toggle('reduced-motion', this.settings.reducedMotion);
    this.root.classList.toggle('hide-hints', !this.settings.showHints);
    this.controller?.setReducedMotion(this.settings.reducedMotion);
    this.audio.setEnabled(this.settings.soundEnabled);
    this.joystick?.setSensitivity(this.settings.joystickSensitivity);
  }

  private updateSaveStatus(): void {
    const element = this.root.querySelector('#save-status')!;
    element.classList.toggle('save-warning', this.persistFailed);
    element.innerHTML = `${icon(this.persistFailed ? 'info' : 'save')} ${this.persistFailed ? 'Хранилище недоступно. Прогресс только в этой сессии.' : 'Автосохранение на этом устройстве'}`;
  }

  private updateMenu(): void {
    this.root.querySelector<HTMLButtonElement>('.menu-start')!.disabled = !this.ready;
    this.root.querySelector<HTMLButtonElement>('#continue-button')!.disabled = !this.ready || !this.progress;
    this.root.querySelector('#continue-detail')!.textContent = this.progress ? (this.progress.reportSolved ? 'Дело раскрыто · вернуться в кабинет' : `${this.progress.inspectedIds.length} из 6 объектов осмотрено`) : 'Пока нет сохранённого дела';
  }

  private updateHud(): void {
    const inspected = this.progress?.inspectedIds ?? [];
    const eligible = this.progress ? canSubmitReport(this.progress) : false;
    const solved = this.progress?.reportSolved ?? false;
    this.root.querySelector('#evidence-count')!.textContent = `${inspected.length} / ${SCHOOL_CASE.equipment.length}`;
    this.root.querySelector('#mobile-evidence-count')!.textContent = `${inspected.length}/${SCHOOL_CASE.equipment.length}`;
    this.root.querySelector<HTMLElement>('#evidence-progress')!.style.width = `${inspected.length / SCHOOL_CASE.equipment.length * 100}%`;
    this.root.querySelector('#step-inspect')!.classList.toggle('complete', eligible);
    this.root.querySelector('#step-report')!.classList.toggle('complete', solved);
    this.root.querySelector('#step-solved')!.classList.toggle('complete', !!this.progress?.appliedPlan && calculateEnergyPlan(this.progress.appliedPlan).savingsKwh > 0);
    this.root.querySelector('.case-tag')!.textContent = solved ? 'РАСКРЫТО' : 'В РАБОТЕ';
    const list = this.root.querySelector('#evidence-list')!;
    list.innerHTML = SCHOOL_CASE.equipment.map((device) => {
      const found = inspected.includes(device.id);
      return `<button class="evidence-item ${found ? 'found' : ''}" data-action="evidence" data-id="${device.id}" ${found ? '' : 'disabled'} aria-label="${escape(device.shortName)}: ${found ? 'открыть запись' : 'ещё не осмотрено'}"><span class="evidence-icon">${icon(device.category)}</span><span>${escape(device.shortName)}<small>${found ? 'Свидетельство записано' : 'Подойдите и осмотрите'}</small></span><span class="evidence-state">${found ? icon('check') : '·'}</span></button>`;
    }).join('');
    const report = this.root.querySelector<HTMLButtonElement>('#report-button')!;
    report.disabled = !eligible;
    report.innerHTML = `${icon('folder')} ${solved ? 'Открыть отчёт' : 'Предварительный отчёт'} ${icon('arrow')}`;
    const missing = SCHOOL_CASE.requiredDeviceIds.filter((id) => !inspected.includes(id)).map((id) => SCHOOL_CASE.equipment.find((device) => device.id === id)!.shortName);
    this.root.querySelector('#report-hint')!.textContent = solved ? `Сценарий изучен · потенциал экономии ${formatEnergy(getInvestigationSavings(this.progress!))} кВт·ч` : eligible ? 'Свидетельства собраны. Проверьте свою гипотезу.' : `Нужно осмотреть: ${missing.join(', ')}`;
    this.controller?.setInspected(inspected);
    this.controller?.setEnergyPlan(this.progress?.appliedPlan ?? null);
    this.root.querySelector<HTMLElement>('#plan-button')!.hidden = !solved;
    const phase = this.root.querySelector('#mission-phase')!;
    const message = this.root.querySelector('#mission-message')!;
    if (solved && this.progress?.appliedPlan) {
      const result = calculateEnergyPlan(this.progress.appliedPlan);
      phase.textContent = '03 / ПЛАН ПРОВЕРЕН В МОДЕЛИ';
      message.textContent = `Расчётная экономия: ${formatEnergy(result.savingsKwh)} кВт·ч (${formatEnergy(result.savingsPercent)}%). Остальные устройства продолжают нужную работу.`;
    } else if (solved) {
      phase.textContent = '03 / ПРОВЕРЬТЕ РЕШЕНИЕ';
      message.textContent = 'Причина найдена. Откройте лабораторию энергии и сравните безопасные режимы работы.';
    } else if (eligible) {
      phase.textContent = '02 / ПРОВЕРЬТЕ ГИПОТЕЗУ';
      message.textContent = 'Ключевые свидетельства в блокноте. Какое устройство тратит энергию без пользы? Откройте отчёт.';
    } else {
      phase.textContent = '01 / СОБЕРИТЕ УЛИКИ';
      message.textContent = `Следующая цель: ${missing[0] ?? 'оборудование'}. Подойдите к метке, осмотрите прибор и запишите свидетельство.`;
    }
    this.updateSaveStatus(); this.updateNearby();
  }

  private updateNearby(): void {
    const device = SCHOOL_CASE.equipment.find((entry) => entry.id === this.nearby);
    this.root.querySelector('#nearby-hint')!.innerHTML = device ? `${icon('search')} <span>${escape(device.shortName)}</span><button class="inline-interact" data-action="interact"><kbd>E</kbd> Осмотреть</button>` : `${icon('search')} Подойдите к устройству с бирюзовой меткой`;
    this.root.querySelector<HTMLButtonElement>('#touch-interact')!.disabled = !device || this.modalOpen || !this.playing;
  }

  private confirmNew(): void {
    this.showModal('Новое расследование', `<p>Текущие записи и позиция персонажа будут заменены новым делом. Достижения этого прохождения тоже начнутся заново.</p><div class="modal-actions"><button class="button secondary" data-action="close">Сохранить текущее</button><button class="button primary" data-action="confirm-new">Начать заново ${icon('arrow')}</button></div>`, 'НОВОЕ ДЕЛО');
  }

  private openEquipment(id: string, inspect: boolean): void {
    const device = SCHOOL_CASE.equipment.find((entry) => entry.id === id);
    if (!device || !this.progress) return;
    const recorded = this.progress.inspectedIds.includes(id);
    if (!inspect && !recorded) return;
    this.showModal(device.name, this.deviceContent(device, recorded), recorded ? `СВИДЕТЕЛЬСТВО / ${this.progress.inspectedIds.indexOf(id) + 1}` : 'СКАНЕР / НОВЫЙ ОБЪЕКТ');
  }

  private recordEvidence(id: string): void {
    const device = SCHOOL_CASE.equipment.find((entry) => entry.id === id);
    if (!device || !this.progress || this.progress.inspectedIds.includes(id) || !this.playing || !this.modalOpen) return;
    const reportWasAvailable = canSubmitReport(this.progress);
    this.progress = inspectEquipment(this.progress, id);
    this.persist(); this.updateHud(); this.audio.play('clue');
    this.showModal(device.name, this.deviceContent(device, true), `СВИДЕТЕЛЬСТВО / ${this.progress.inspectedIds.indexOf(id) + 1}`);
    this.toast(!reportWasAvailable && canSubmitReport(this.progress) ? 'Ключевые улики собраны. Теперь можно проверить гипотезу!' : `Улика записана: ${device.shortName}`);
  }

  private deviceContent(device: Equipment, recorded = true): string {
    const energy = calculateEquipmentEnergy(device, SCHOOL_CASE.workingDays);
    const power = device.mode.powerWatts;
    const totalPower = power * device.quantity;
    return `<div class="device-summary"><div class="device-large-icon">${icon(device.category)}</div><div><span class="chip">ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ</span><p>${escape(device.description)}</p></div></div>
      <div class="device-stats"><div><span>Мощность одного</span><strong>${power}<small> Вт</small></strong></div><div><span>Работа в день</span><strong>${device.mode.hoursPerDay}<small> ч</small></strong></div><div><span>Количество</span><strong>${device.quantity}<small> шт.</small></strong></div></div>
      <div class="mode-line"><span>Режим работы</span><strong>${escape(device.mode.label)}</strong></div>
      <div class="energy-calculation"><div><span>ЭНЕРГИЯ ЗА ${SCHOOL_CASE.workingDays} УЧЕБНЫХ ДНЕЙ</span><strong>${formatEnergy(energy.monthlyKwh)} <small>кВт·ч</small></strong></div>${icon('bolt')}<p>${power} Вт × ${device.mode.hoursPerDay} ч × ${device.quantity} шт. ÷ 1000 = <b>${formatEnergy(energy.dailyKwh)} кВт·ч / день</b></p><p>${formatEnergy(energy.dailyKwh)} × ${SCHOOL_CASE.workingDays} дней = ${formatEnergy(energy.monthlyKwh)} кВт·ч</p></div>
      <div class="device-timeline"><span>РЕЖИМ НА ШКАЛЕ СУТОК</span><div class="hours-track"><i style="width:${device.mode.hoursPerDay / 24 * 100}%"></i></div><div><small>00:00</small><strong>${device.mode.hoursPerDay} ч работы в день</strong><small>24:00</small></div></div>
      ${recorded ? `<div class="evidence-note"><span>${icon('search')} НАБЛЮДЕНИЕ ДЕТЕКТИВА</span><p>${escape(device.evidence)}</p></div><div class="recommendation"><span>${icon('leaf')} БЕЗОПАСНОЕ ИЗМЕНЕНИЕ</span><p>${escape(device.recommendation)}</p>${device.proposedMode ? `<small>Учебная оценка при ${device.proposedMode.hoursPerDay} ч/день и ${device.proposedMode.powerWatts} Вт: до ${formatEnergy(energy.potentialSavingsKwh)} кВт·ч за ${SCHOOL_CASE.workingDays} учебных дней.</small>` : '<small>В сценарии дополнительная экономия для этого режима не заявлена.</small>'}</div>` : `<div class="scan-card"><span class="scan-emblem">${icon('search')}</span><div><strong>Характеристики получены</strong><p>Запишите режим работы и наблюдение в блокнот, чтобы использовать их в отчёте.</p></div></div>`}
      <div class="demo-footnote">${icon('info')} Формула E = P × t / 1000. Для группы устройств учитывается количество. Все характеристики заданы для обучения; это не реальные измерения СШ №225.</div><div class="modal-actions">${recorded ? `<button class="button primary" data-action="close">Вернуться к расследованию ${icon('arrow')}</button>` : `<button class="button secondary" data-action="close">Позже</button><button class="button primary" data-action="record-evidence" data-id="${device.id}">Записать улику ${icon('check')}</button>`}</div><span class="sr-only">Суммарная мощность группы: ${totalPower} Вт</span>`;
  }

  private showReport(): void {
    if (!this.progress) return;
    if (this.progress.reportSolved) { this.showSolvedReport(); return; }
    this.selectedOption = null;
    const comparisons = SCHOOL_CASE.requiredDeviceIds.map((id) => SCHOOL_CASE.equipment.find((device) => device.id === id)!);
    this.showModal('Куда уходит энергия?', `<p class="modal-intro">Сравните собранные свидетельства. Найдите длительную ненужную работу, режим которой можно изменить безопасно.</p><div class="comparison-table"><div class="comparison-head"><span>ОБЪЕКТ</span><span>РЕЖИМ</span><span>кВт·ч / ${SCHOOL_CASE.workingDays} дн.</span></div>${comparisons.map((device) => `<div><span>${escape(device.shortName)}<small>${device.quantity} × ${device.mode.powerWatts} Вт</small></span><span>${device.mode.hoursPerDay} ч/день</span><strong>${formatEnergy(calculateEquipmentEnergy(device, SCHOOL_CASE.workingDays).monthlyKwh)}</strong></div>`).join('')}</div>
      <fieldset class="report-options"><legend>Ваша главная гипотеза</legend>${SCHOOL_CASE.reportOptions.map((option) => `<label class="report-option"><input type="radio" name="report-option" value="${option.id}" /><span class="radio-indicator"></span><span><strong>${escape(option.title)}</strong><small>${escape(option.description)}</small></span></label>`).join('')}</fieldset><div class="modal-actions"><button class="button secondary" data-action="close">Ещё поищу</button><button id="submit-report" class="button primary" data-action="submit-report" disabled>Проверить гипотезу ${icon('arrow')}</button></div>`, 'ПРЕДВАРИТЕЛЬНЫЙ ОТЧЁТ / ДЕЛО 001', 'wide-modal');
  }

  private submitReport(): void {
    if (!this.progress || !this.selectedOption || !canSubmitReport(this.progress)) return;
    const result = evaluateReport(this.progress, this.selectedOption);
    this.progress = result.progress; this.persist(); this.updateHud();
    this.audio.play(result.correct ? 'success' : 'retry');
    if (result.correct) this.showSolvedReport(result.explanation);
    else this.showModal('Гипотеза требует пересмотра', `<div class="result-symbol wrong">${icon('search')}</div><p class="result-explanation">${escape(result.explanation)}</p><div class="evidence-note"><span>ПОДСКАЗКА</span><p>Сравните не только ватты, но и часы работы. Отключение должно сохранять безопасность и необходимые функции оборудования.</p></div><div class="modal-actions"><button class="button secondary" data-action="close">В кабинет</button><button class="button primary" data-action="retry-report">Проверить другую гипотезу ${icon('arrow')}</button></div>`, 'ПРОВЕРКА СВИДЕТЕЛЬСТВ');
  }

  private showSolvedReport(explanation?: string): void {
    if (!this.progress) return;
    const savings = getInvestigationSavings(this.progress);
    this.showModal('Дело раскрыто', `<div class="result-symbol">${icon('check')}</div><p class="result-explanation">${escape(explanation ?? 'Основная причина — длительный простой компьютеров после занятий. Плановое завершение работы и согласованный режим сна сокращают ненужное потребление без помех для уроков. Мониторы также следует переводить в безопасный режим ожидания.')}</p><div class="solved-stat"><span>ПОТЕНЦИАЛ ЭКОНОМИИ В УЧЕБНОМ СЦЕНАРИИ</span><strong>${formatEnergy(savings)} <small>кВт·ч</small></strong><p>за ${SCHOOL_CASE.workingDays} учебных дней · компьютеры и мониторы</p></div><div class="report-conclusion"><p><b>Компьютеры:</b> 6 × 80 Вт × (10 − 2) ч × 20 дней ÷ 1000 = 76,8 кВт·ч.</p><p><b>Мониторы:</b> 6 × 20 Вт × (10 − 2) ч × 20 дней ÷ 1000 = 19,2 кВт·ч.</p><p>Это расчёт возможного изменения режима, а не фактически достигнутая экономия. Сетевое оборудование сохраняет связь, проектор используется на уроках.</p></div><p class="demo-footnote">Можно продолжить исследование и осмотреть остальные объекты. Реальные изменения оборудования выполняют только ответственные сотрудники.</p><div class="modal-actions"><button class="button secondary" data-action="menu">В главное меню</button><button class="button primary" data-action="energy-plan">Проверить решение ${icon('arrow')}</button></div>`, 'ОТЧЁТ / ДЕЛО 001');
  }

  private showCases(): void {
    this.showModal('Архив расследований', `<button class="case-card" data-action="case-play"><span class="case-card-icon">${icon('monitor')}</span><span><small>ДЕЛО 001 · ДОСТУПНО</small><strong>Школьная аномалия</strong><span>Кабинет информатики · 6 объектов</span></span>${icon('arrow')}</button><div class="future-note">${icon('lock')}<div><strong>Новые дела — в будущих версиях</strong><p>В этом прототипе доступна одна комната. Другие локации пока не разработаны.</p></div></div><p class="demo-footnote">Первая локация вдохновлена СШ №225 города Минска. Интерьер, планировка и энергетические ситуации вымышлены.</p>`, 'ВЫБОР ДЕЛА');
  }

  private showNotebook(): void {
    const inspected = this.progress?.inspectedIds ?? [];
    this.showModal('Блокнот детектива', `<p>${escape(this.root.querySelector('#mission-message')!.textContent ?? '')}</p><div class="notebook-grid">${SCHOOL_CASE.equipment.map((device) => `<button class="evidence-item ${inspected.includes(device.id) ? 'found' : ''}" data-action="evidence" data-id="${device.id}" ${inspected.includes(device.id) ? '' : 'disabled'}><span class="evidence-icon">${icon(device.category)}</span><span>${escape(device.shortName)}<small>${inspected.includes(device.id) ? 'Открыть записанное наблюдение' : 'Ещё не исследовано'}</small></span>${icon(inspected.includes(device.id) ? 'check' : 'lock')}</button>`).join('')}</div><div class="modal-actions">${this.progress && canSubmitReport(this.progress) ? `<button class="button primary" data-action="report">${this.progress.reportSolved ? 'Открыть отчёт' : 'Проверить гипотезу'} ${icon('arrow')}</button>` : '<button class="button primary" data-action="close">Продолжить поиск</button>'}${this.progress?.reportSolved ? '<button class="button secondary" data-action="energy-plan">Лаборатория энергии</button>' : ''}</div>`, 'УЛИКИ И ТЕКУЩАЯ ЦЕЛЬ');
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else this.toast('Браузер не поддерживает полноэкранный режим. Для запуска без панели браузера установите игру на главный экран.');
    } catch { this.toast('Браузер не разрешил полноэкранный режим. Можно играть в текущем окне или установить игру.'); }
  }

  private showBriefing(): void {
    this.showModal('Школьная аномалия', `<div class="dispatch-card"><div class="dispatch-avatar">${icon('leaf')}</div><div><span>СООБЩЕНИЕ ИЗ БЮРО</span><strong>Детектив, энергия оставляет следы.</strong></div></div><p class="briefing-story">В учебной модели кабинет уже опустел, а часть техники продолжает расходовать энергию. У каждого прибора своя история: один нужен для связи, другой — для уроков, третий слишком долго ждёт следующего занятия.</p><div class="briefing-goals"><div><b>01</b><strong>Соберите улики</strong><small>Подойдите к компьютерам, проектору и сетевому узлу. Осмотрите их и запишите наблюдения.</small></div><div><b>02</b><strong>Найдите причину</strong><small>Сравните мощность, количество устройств и время работы. Проверьте гипотезу в отчёте.</small></div><div><b>03</b><strong>Проверьте решение</strong><small>Настройте режимы в лаборатории энергии и узнайте расчётную экономию.</small></div></div><p class="demo-footnote">${icon('info')} Вдохновлено СШ №225 Минска. Планировка, характеристики и события вымышлены. Модель не управляет настоящим школьным оборудованием.</p><div class="briefing-controls"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> или стрелки</span><span><kbd>E</kbd> осмотреть</span><small>На телефоне — джойстик и крупная кнопка осмотра. Доступны диагональное движение и масштаб +/−.</small></div><div class="modal-actions"><button class="button primary" data-action="close">${this.playing ? 'К расследованию' : 'Понятно'} ${icon('arrow')}</button></div>`, 'ДЕЛО №001 / ВАШЕ ЗАДАНИЕ', 'wide-modal');
  }

  private showEnergyPlan(loadSaved = true): void {
    if (!this.progress?.reportSolved) return;
    if (loadSaved) this.draftPlan = { ...(this.progress.appliedPlan ?? DEFAULT_ENERGY_PLAN) };
    const daylight = this.draftPlan.lightingHours < 8;
    this.showModal('Лаборатория энергии', `<p class="modal-intro">Причина найдена. Теперь проверьте решение: двигайте ползунки и сравнивайте режимы в учебной модели.</p><div class="lab-controls"><label class="lab-range" for="computer-hours"><span>${icon('computer')} <strong>Компьютеры и мониторы</strong><output id="computer-hours-output">${this.draftPlan.computerHours} ч/день</output></span><input id="computer-hours" type="range" min="2" max="10" step="1" value="${this.draftPlan.computerHours}" /><small>2 часа сохраняем для занятий. Лишнее ожидание после уроков можно сократить после сохранения файлов и согласования с учителем.</small><span class="range-endpoints"><i>2 ч · только нужная работа</i><i>10 ч · исходный режим</i></span></label><label class="daylight-option"><input id="daylight-confirmed" type="checkbox" ${daylight ? 'checked' : ''} /><span>${icon('lighting')} В этой модели достаточно дневного света<small>Сокращать освещение можно только при достаточной освещённости. В тёмное время сохраняем исходный режим.</small></span></label><label class="lab-range" for="lighting-hours"><span><strong>Освещение кабинета</strong><output id="lighting-hours-output">${this.draftPlan.lightingHours} ч/день</output></span><input id="lighting-hours" type="range" min="4" max="8" step="1" value="${this.draftPlan.lightingHours}" ${daylight ? '' : 'disabled'} /><span class="range-endpoints"><i>4 ч · при дневном свете</i><i>8 ч · исходный режим</i></span></label></div><div class="lab-protected">${icon('lock')} <span><strong>Нужные функции сохраняются</strong><small>Проектор: 2 ч уроков. Компьютер учителя: 2 ч. Сетевой узел: непрерывная связь. Их режимы здесь не меняем.</small></span></div><div id="plan-preview" class="plan-preview" aria-live="polite" aria-atomic="true"></div><p class="demo-footnote">E = P × t × количество × ${SCHOOL_CASE.workingDays} дней / 1000. Считаем выбранные учебные дни, а не весь календарный месяц. Это модель возможных режимов; результат не является фактической экономией школы.</p><div class="modal-actions"><button class="button secondary" data-action="reset-plan">Исходные режимы</button><button id="apply-plan" class="button primary" data-action="apply-plan">Проверить в комнате ${icon('arrow')}</button></div>`, 'ЭТАП 03 / БЕЗОПАСНЫЙ ПЛАН', 'wide-modal');
    this.updatePlanPreview();
  }

  private updatePlanPreview(): void {
    const target = this.root.querySelector('#plan-preview');
    if (!target) return;
    const result = calculateEnergyPlan(this.draftPlan);
    this.root.querySelector('#computer-hours-output')!.textContent = `${this.draftPlan.computerHours} ч/день`;
    this.root.querySelector('#lighting-hours-output')!.textContent = `${this.draftPlan.lightingHours} ч/день`;
    target.innerHTML = `<div class="plan-comparison"><div><span>ИСХОДНЫЙ РАСХОД</span><strong>${formatEnergy(result.baselineKwh)} <small>кВт·ч</small></strong><i class="energy-bar"><b style="width:100%"></b></i></div><div><span>С ВАШИМ ПЛАНОМ</span><strong>${formatEnergy(result.monthlyKwh)} <small>кВт·ч</small></strong><i class="energy-bar"><b style="width:${result.monthlyKwh / result.baselineKwh * 100}%"></b></i></div></div><div class="plan-saving"><span>${icon('leaf')} РАСЧЁТНАЯ ЭКОНОМИЯ</span><strong>${formatEnergy(result.savingsKwh)} <small>кВт·ч</small></strong><b>−${formatEnergy(result.savingsPercent)}%</b></div><div class="plan-breakdown"><span>Компьютеры + мониторы <b>${formatEnergy(result.computerSavingsKwh)} кВт·ч</b></span><span>Освещение <b>${formatEnergy(result.lightingSavingsKwh)} кВт·ч</b></span></div>`;
  }

  private commitEnergyPlan(): void {
    if (!this.progress?.reportSolved) return;
    if (this.draftPlan.lightingHours < 8 && !this.root.querySelector<HTMLInputElement>('#daylight-confirmed')?.checked) {
      this.toast('Сначала подтвердите достаточное дневное освещение в модели.'); return;
    }
    this.progress = applyEnergyPlan(this.progress, this.draftPlan);
    this.persist(); this.updateHud(); this.audio.play('apply');
    const result = calculateEnergyPlan(this.draftPlan);
    const complete = this.progress.inspectedIds.length === SCHOOL_CASE.equipment.length;
    this.showModal(result.savingsKwh > 0 ? 'Энергия под контролем' : 'Исходные режимы восстановлены', `<div class="result-symbol">${icon(result.savingsKwh > 0 ? 'leaf' : 'bolt')}</div><div class="detective-rank"><span>ВАШЕ ДОСЬЕ</span><strong>${complete ? 'Внимательный аналитик' : 'Энергетический детектив'}</strong><p>${this.progress.inspectedIds.length} / 6 объектов исследовано · гипотез проверено: ${this.progress.reportAttempts}</p></div><div class="solved-stat"><span>ПОТЕНЦИАЛ ВЫБРАННОГО ПЛАНА</span><strong>${formatEnergy(result.savingsKwh)} <small>кВт·ч</small></strong><p>−${formatEnergy(result.savingsPercent)}% за ${SCHOOL_CASE.workingDays} учебных дней</p></div><p class="result-explanation">Режимы изменены в игровой модели. Экраны показывают сокращение ожидания, а связь и необходимые занятия продолжаются. Расчётный расход: ${formatEnergy(result.baselineKwh)} → ${formatEnergy(result.monthlyKwh)} кВт·ч.</p><p class="demo-footnote">Сохранение включает выбранный план. ${complete ? 'Все свидетельства собраны — сравните другие безопасные режимы в лаборатории.' : 'Дополнительная цель: исследуйте все шесть объектов, чтобы открыть достижение «Внимательный детектив».'} Изменения в реальной школе выполняют ответственные сотрудники.</p><div class="modal-actions"><button class="button secondary" data-action="energy-plan">Изменить план</button><button class="button primary" data-action="close">Вернуться в комнату ${icon('arrow')}</button></div>`, 'РЕЗУЛЬТАТ / УЧЕБНАЯ СИМУЛЯЦИЯ');
  }

  private showAchievements(): void {
    const achievements = [
      { title: 'Первый след', description: 'Осмотреть одно устройство', earned: !!this.progress?.inspectedIds.length, symbol: 'search' },
      { title: 'Внимательный детектив', description: 'Исследовать все шесть объектов', earned: this.progress?.inspectedIds.length === 6, symbol: 'folder' },
      { title: 'Дело раскрыто', description: 'Правильно составить отчёт по делу', earned: !!this.progress?.reportSolved, symbol: 'check' },
      { title: 'Энергия под контролем', description: 'Проверить план с положительной экономией', earned: !!this.progress?.appliedPlan && calculateEnergyPlan(this.progress.appliedPlan).savingsKwh > 0, symbol: 'leaf' },
    ];
    this.showModal('Ваши достижения', `<div class="achievements">${achievements.map((item) => `<div class="achievement ${item.earned ? 'earned' : ''}"><span>${icon(item.symbol)}</span><div><strong>${item.title}</strong><small>${item.description}</small></div>${icon(item.earned ? 'check' : 'lock')}</div>`).join('')}</div><p class="demo-footnote">Эти четыре достижения работают в текущем прохождении и сохраняются локально. Расширенная коллекция появится в будущих версиях.</p>`, 'ЛИЧНОЕ ДОСЬЕ');
  }

  private showSettings(): void {
    this.showModal('Настройки', `<label class="setting-row"><span><strong>Меньше анимации</strong><small>Уменьшить движение и свечение интерфейса</small></span><input type="checkbox" data-setting="reducedMotion" ${this.settings.reducedMotion ? 'checked' : ''} /><span class="switch" aria-hidden="true"></span></label><label class="setting-row"><span><strong>Подсказки управления</strong><small>Показывать клавиши на игровом экране</small></span><input type="checkbox" data-setting="showHints" ${this.settings.showHints ? 'checked' : ''} /><span class="switch" aria-hidden="true"></span></label><label class="setting-row"><span><strong>Звуки расследования</strong><small>Тихие сигналы новых улик, гипотез и результатов</small></span><input type="checkbox" data-setting="soundEnabled" ${this.settings.soundEnabled ? 'checked' : ''} /><span class="switch" aria-hidden="true"></span></label><label class="sensitivity-setting">Чувствительность джойстика<input type="range" min="0.5" max="1.5" step="0.1" value="${this.settings.joystickSensitivity}" data-setting="joystickSensitivity" /><small>Слева — точное медленное движение, справа — быстрый отклик.</small></label><div class="future-note">${icon('save')}<div><strong>Всё остаётся на вашем устройстве</strong><p>Игра сохраняет позицию, записи и отчёт в localStorage. При очистке данных браузера сохранение удаляется.</p></div></div><p class="demo-footnote">Звук включается вами и создаётся локально. Переназначение клавиш пока не реализовано. Текущий прототип не требует регистрации и API-ключей.</p>`, 'ПАРАМЕТРЫ СИСТЕМЫ');
  }

  private showHelp(): void {
    this.showModal('Как вести расследование', `<div class="help-steps"><p><span>01</span><strong>Перемещайтесь по кабинету</strong><small>WASD или стрелки. На сенсорном экране используйте джойстик слева внизу. Камера следует за персонажем; кнопки +/− меняют масштаб.</small></p><p><span>02</span><strong>Изучайте устройства</strong><small>Подойдите к бирюзовой метке и нажмите E, саму метку или кнопку «Осмотреть». Стены и мебель ограничивают движение.</small></p><p><span>03</span><strong>Сравнивайте свидетельства</strong><small>Осмотрите: ${requiredNames().join(', ')}. Нажмите «Записать улику» в панели прибора. Повторно открыть данные можно в блокноте.</small></p><p><span>04</span><strong>Проверьте гипотезу в отчёте</strong><small>Энергия = мощность × время ÷ 1000. Учтите длительность работы и безопасность изменения режима.</small></p><p><span>05</span><strong>Проверьте безопасный план</strong><small>После верного отчёта откройте лабораторию энергии, сравните режимы ползунками и проверьте результат в комнате.</small></p></div><p class="demo-footnote">Esc закрывает панель, повторный Esc возвращает в меню. Прогресс сохраняется автоматически. ${formatEnergy(getMonthlyBaseline())} кВт·ч — суммарный пример для всех объектов за ${SCHOOL_CASE.workingDays} учебных дней, не школьные измерения.</p><div class="modal-actions"><button class="button primary" data-action="close">Всё понятно ${icon('check')}</button></div>`, 'РУКОВОДСТВО ДЕТЕКТИВА');
  }

  private showModal(title: string, body: string, eyebrow: string, className = ''): void {
    if (!this.modalOpen) this.previousFocus = document.activeElement as HTMLElement | null;
    this.modalOpen = true;
    const layer = this.root.querySelector<HTMLElement>('#modal-layer')!;
    layer.hidden = false;
    layer.innerHTML = `<section class="modal ${className}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><span class="eyebrow">${escape(eyebrow)}</span><h2 id="modal-title">${escape(title)}</h2></div><button class="icon-button" data-action="close" aria-label="Закрыть панель">${icon('close')}</button></div><div class="modal-body">${body}</div></section>`;
    this.root.querySelector('.workspace')!.setAttribute('inert', '');
    this.root.querySelector('.topbar')!.setAttribute('inert', '');
    this.root.querySelector('#main-menu')!.setAttribute('inert', '');
    this.syncActive(); this.updateNearby();
    layer.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }

  private closeModal(restoreFocus = true): void {
    this.modalOpen = false;
    const layer = this.root.querySelector<HTMLElement>('#modal-layer')!;
    layer.hidden = true; layer.innerHTML = '';
    for (const selector of ['.workspace', '.topbar', '#main-menu']) this.root.querySelector(selector)!.removeAttribute('inert');
    this.syncActive(); this.updateNearby();
    const validPreviousFocus = this.previousFocus?.isConnected && this.previousFocus !== document.body && this.previousFocus !== document.documentElement;
    if (restoreFocus) (validPreviousFocus ? this.previousFocus : this.playing ? this.roomParent : this.root.querySelector<HTMLElement>('.menu-start'))?.focus({ preventScroll: true });
    this.previousFocus = null;
  }

  private toast(message: string): void {
    clearTimeout(this.toastTimer);
    const element = this.root.querySelector<HTMLElement>('#toast')!;
    element.textContent = message; element.hidden = false;
    this.toastTimer = setTimeout(() => { element.hidden = true; }, 3800);
  }
}
