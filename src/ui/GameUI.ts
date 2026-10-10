import type { Equipment, GameBridge, RoomController, Settings } from '../types';
import type { CampaignCase, CampaignCaseProgress, CampaignPlan, CampaignSave, PlanEvaluation } from '../campaign/types';
import { CAMPAIGN_CASES } from '../data/campaign';
import { formatEnergy } from '../systems/energy';
import { renderDeviceDetails } from './DeviceDetails';
import { loadSettings, saveSettings } from '../systems/storage';
import { loadCampaign, saveCampaign } from '../systems/campaignStorage';
import { answerAnalysis, calculateCaseCompletion, canAnalyzeCase, createCampaign, getCampaignCase, getCampaignStats, getCaseProgress, hasRequiredEvidence, inspectCampaignEquipment, isCaseUnlocked, selectCase, submitCampaignHypothesis, submitCampaignPlan } from '../systems/campaign';
import { defaultPlan, evaluatePlan } from '../systems/puzzles';
import { readAnalysisAnswers, readPlan, renderAnalysis, renderPlan, renderPlanPreview } from './PuzzlePanels';
import { icon } from './icons';
import { FeedbackAudio } from './FeedbackAudio';
import { VirtualJoystick } from './VirtualJoystick';
import { renderNotebook, type NotebookTab } from './NotebookPanels';
import { loadExtensions, saveExtensions, type GraphicsQuality } from '../systems/v3Storage';
import { getDeviceModel } from '../inspection/catalog';

const escape = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export class GameUI {
  readonly roomParent: HTMLElement;
  readonly bridge: GameBridge;
  private controller: RoomController | null = null;
  private readonly extensionLoad = loadExtensions();
  private extensions = this.extensionLoad.save;
  private notebookTab: NotebookTab = 'evidence';
  private readonly loaded = loadCampaign();
  private campaign: CampaignSave | null = this.loaded.save;
  private activeCase: CampaignCase = getCampaignCase(this.campaign?.currentCaseId ?? CAMPAIGN_CASES[0].id);
  private progress: CampaignCaseProgress | null = this.campaign ? getCaseProgress(this.campaign) : null;
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
  private modalCleanup: (() => void) | undefined;
  private modalVersion = 0;
  private readonly audio = new FeedbackAudio();
  private draftPlan: CampaignPlan = defaultPlan(this.activeCase);
  private thermalView = false;
  private joystick?: VirtualJoystick;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = this.shell();
    this.roomParent = root.querySelector<HTMLElement>('#room-canvas')!;
    root.querySelector('.room-frame')!.append(root.querySelector('.touch-controls')!);
    this.bridge = {
      onReady: () => { this.ready = true; this.updateMenu(); this.applyControllerState(); this.updateHud(); },
      onNearby: (id) => { this.nearby = id; this.updateNearby(); },
      onInteract: (id) => { if (this.playing && !this.modalOpen) this.openEquipment(id, true); },
      onPosition: (position) => {
        if (!this.progress || !this.playing || !this.ready) return;
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
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => this.applySettings());
    this.applySettings();
    this.updateMenu();
    this.updateHud();
    if (this.loaded.warning) this.toast(this.loaded.warning);
    else if (this.loaded.migrated) { this.persist(); this.toast('Сохранение перенесено в кампанию. Позиция, улики и результаты первого дела сохранены.'); }
    else if (this.extensionLoad.warning) this.toast(this.extensionLoad.warning);
  }

  connect(controller: RoomController): void {
    this.controller = controller;
    controller.setLevel(this.activeCase);
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
          <div class="sidebar-section"><div class="section-title">ХОД РАССЛЕДОВАНИЯ <span id="evidence-count">0 / 6</span></div><div class="progress-track"><div id="evidence-progress"></div></div><p class="objective">Осмотрите компьютеры, проектор и сетевое оборудование. Сравните режимы работы.</p><ol class="case-steps"><li id="step-inspect"><span>01</span><div>Собрать свидетельства<small>Приборы, журналы и датчики</small></div></li><li id="step-report"><span>02</span><div>Проверить гипотезу<small>Мощность × время работы</small></div></li><li id="step-solved"><span>03</span><div>Проверить решение<small>Безопасность, бюджет и комфорт</small></div></li></ol></div>
          <div class="sidebar-section evidence-section"><div class="section-title">ВАШ БЛОКНОТ ${icon('folder')}</div><div id="evidence-list"></div></div>
          <div class="sidebar-footer"><button id="report-button" class="button primary full-width" data-action="report" disabled>${icon('folder')} Предварительный отчёт ${icon('arrow')}</button><p id="report-hint" class="report-hint">Сначала соберите ключевые свидетельства</p><button id="plan-button" class="button secondary full-width" data-action="energy-plan" hidden>${icon('bolt')} Лаборатория энергии ${icon('arrow')}</button><p id="detective-stats" class="detective-stats"></p><div class="save-status" id="save-status">${icon('save')} Автосохранение на этом устройстве</div></div>
        </aside>
        <main class="scene-area">
          <div class="mobile-hud"><button data-action="menu" class="icon-button" aria-label="Главное меню">${icon('back')}</button><div><span>ДЕЛО 001 / ЛОКАЦИЯ</span><strong>Школьная аномалия</strong></div><button data-action="notebook" class="mobile-notebook" aria-label="Блокнот и задания">${icon('folder')} <b id="mobile-evidence-count">0/6</b></button><button data-action="settings" class="icon-button" aria-label="Настройки">${icon('settings')}</button></div><div class="scene-heading"><div><span class="eyebrow">ЛОКАЦИЯ 01 / ИССЛЕДОВАНИЕ</span><h2>Кабинет информатики <span>2 этаж</span></h2></div><div class="room-status"><i></i> СИМУЛЯЦИЯ АКТИВНА</div></div>
          <div class="mission-strip"><span class="mission-avatar">${icon('search')}</span><div><span id="mission-phase">БЮРО / ЗАДАНИЕ</span><p id="mission-message">Найдите причины лишнего расхода энергии.</p></div><button class="icon-button" data-action="briefing" aria-label="Открыть задание">${icon('folder')}</button></div>
          <div class="room-frame"><p id="mobile-objective" class="mobile-objective"></p><div class="camera-tools"><button data-action="cases" aria-label="Карта расследований">${icon('map')}</button><button id="thermal-tool" data-action="thermal" aria-pressed="false" aria-label="Виртуальный тепловизор" hidden>${icon('heating')}</button><button data-action="notebook" aria-label="Блокнот и текущая цель">${icon('folder')}</button><button data-action="zoom-in" aria-label="Приблизить">+</button><button data-action="zoom-out" aria-label="Отдалить">−</button><button data-action="fullscreen" aria-label="Полноэкранный режим">⛶</button></div><div id="room-canvas" role="img" aria-label="Игровой кабинет информатики. Управляйте персонажем WASD или стрелками, E — осмотр." tabindex="0"></div><div class="room-label">${icon('search')} <span>РЕЖИМ ДЕТЕКТИВА</span></div><div class="room-coordinate"><span>N</span><i>↑</i></div><div class="room-scale"><span></span> 1 ИГРОВОЙ МЕТР</div><div class="scan-legend"><i></i> ОБЪЕКТ ДЛЯ ОСМОТРА</div></div>
          <div class="scene-footer"><div id="nearby-hint" class="nearby-hint">${icon('search')} Подойдите к устройству с бирюзовой меткой</div><div class="keyboard-guide"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> движение</span><span><kbd>E</kbd> осмотр</span></div></div>
          <div class="touch-controls" aria-label="Сенсорное управление"><div id="virtual-joystick" class="virtual-joystick" aria-label="Виртуальный джойстик: двигайте палец в нужном направлении"><span class="joystick-knob">${icon('search')}</span></div><button id="touch-interact" class="touch-interact" data-action="interact" disabled>${icon('search')}<span>Осмотреть</span></button></div>
          <p class="scenario-note">Вымышленная планировка и учебные ситуации. Показатели демонстрационные, а не измерения в школе.</p>
        </main>
      </div>
      <section id="main-menu" class="main-menu" aria-label="Главное меню">
        <div class="menu-content"><div class="menu-kicker"><span></span> ОБРАЗОВАТЕЛЬНАЯ ДЕТЕКТИВНАЯ ИГРА</div><h1 class="menu-title">ECO<br><span>DETECTIVE</span><span class="title-dot">.</span></h1><p class="menu-subtitle">Тайна пропавшей энергии</p><p class="menu-description">Энергия не исчезает бесследно.<br>Изучайте улики. Проверяйте гипотезы.<br>Найдите то, что осталось незамеченным.</p>
          <div class="menu-actions"><button class="button primary menu-start" data-action="new" disabled>Новая игра ${icon('arrow')}</button><button id="continue-button" class="button secondary" data-action="continue" disabled>Продолжить ${icon('time')}<small id="continue-detail">Пока нет сохранённого дела</small></button><div class="menu-links"><button data-action="cases">${icon('folder')} Выбор дела</button><button data-action="achievements">${icon('trophy')} Достижения</button><button data-action="settings">${icon('settings')} Настройки</button></div></div>
          <div class="launcher-actions"><button id="install-game" class="launcher-button">${icon('save')} Установить</button><button id="share-game" class="launcher-button">${icon('arrow')} Поделиться игрой</button></div><p id="offline-status" class="offline-status" role="status" aria-live="polite"></p>
          <p id="menu-campaign-progress" class="campaign-progress"></p><div class="menu-meta"><span>05 РАССЛЕДОВАНИЙ</span><span>РАЗНЫЕ ГОЛОВОЛОМКИ</span><span>ОДНА КАМПАНИЯ</span></div>
        </div>
        <div class="menu-case-preview"><div class="preview-cross">+</div><span class="eyebrow">ПЕРВОЕ ДЕЛО</span><h2>Школьная аномалия</h2><p>Минск · Условная модель СШ №225</p><span class="menu-version">2.5D · ЛОКАЛЬНОЕ РАССЛЕДОВАНИЕ</span><div class="preview-line"><span class="status-dot"></span> НУЖНО ВАШЕ РАССЛЕДОВАНИЕ <span>001</span></div></div>
        <div class="menu-bottom"><span>УЧИТЕСЬ ЗАМЕЧАТЬ. УЧИТЕСЬ БЕРЕЧЬ.</span><span>РАЗРАБОТКА / v3.0</span></div>
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
      case 'case-play': this.startCase(button.dataset.id ?? this.activeCase.id); break;
      case 'achievements': this.showAchievements(); break;
      case 'settings': this.showSettings(); break;
      case 'help': this.showHelp(); break;
      case 'interact': this.controller?.interact(); break;
      case 'evidence': if (button.dataset.id && this.progress?.inspectedIds.includes(button.dataset.id)) this.openEquipment(button.dataset.id, false); break;
      case 'report': this.showReport(); break;
      case 'submit-report': this.submitReport(); break;
      case 'retry-report': this.showReport(); break;
      case 'briefing': this.showBriefing(); break;
      case 'record-evidence': if (button.dataset.id) this.recordEvidence(button.dataset.id); break;
      case 'inspect-3d': if (button.dataset.id) void this.show3DInspection(button.dataset.id); break;
      case 'device-back': if (button.dataset.id) this.openEquipment(button.dataset.id, true); break;
      case 'energy-plan': if (this.progress?.reportSolved && (this.progress.analysisSolved || this.progress.completed)) this.showEnergyPlan(); break;
      case 'submit-plan': this.commitEnergyPlan(); break;
      case 'submit-analysis': this.submitAnalysis(); break;
      case 'retry-analysis': this.showAnalysis(); break;
      case 'next-case': this.startCase(CAMPAIGN_CASES[this.activeCase.order]?.id ?? this.activeCase.id); break;
      case 'tag-evidence': this.toggleSuspect(button.dataset.id); break;
      case 'thermal': this.thermalView = !this.thermalView; this.controller?.setThermalView(this.thermalView); button.setAttribute('aria-pressed', String(this.thermalView)); this.toast(this.thermalView ? 'Тепловизор: учебная модель окон и дверей. Цвет показывает потенциальные потери.' : 'Тепловизор выключен'); break;
      case 'notebook': this.showNotebook(); break;
      case 'notebook-tab': if (['evidence', 'connections', 'tasks', 'history'].includes(button.dataset.tab ?? '')) { this.notebookTab = button.dataset.tab as NotebookTab; this.showNotebook(); } break;
      case 'zoom-in': this.controller?.changeZoom(.15); break;
      case 'zoom-out': this.controller?.changeZoom(-.15); break;
      case 'fullscreen': void this.toggleFullscreen(); break;
      case 'select-link': this.root.querySelector<HTMLInputElement>('#share-link')?.select(); break;
    }
  }

  private handleChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.dataset.v3Setting === 'graphicsQuality' && ['auto', 'low', 'medium', 'high'].includes(input.value)) {
      this.extensions.preferences.graphicsQuality = input.value as GraphicsQuality;
      this.applySettings();
      if (!saveExtensions(this.extensions)) this.toast('Настройки графики действуют до закрытия страницы: хранилище недоступно.');
    }
    if (input.name === 'report-option') {
      this.selectedOption = input.value;
      this.root.querySelector<HTMLButtonElement>('#submit-report')!.disabled = !this.root.querySelector('input[name="report-option"]:checked');
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
    if (input.matches('[data-campaign-plan]')) this.handlePlanInput(event);
  }

  private handlePlanInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.matches('[data-campaign-plan]')) return;
    if (input.id === 'daylight-enabled') {
      const range = this.root.querySelector<HTMLInputElement>('#lighting-hours');
      if (range) { range.disabled = !input.checked; if (!input.checked) range.value = '8'; }
    }
    this.draftPlan = readPlan(this.root, this.activeCase);
    this.updatePlanPreview();
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.code === 'Escape' && event.repeat) { event.preventDefault(); return; }
    if (!this.modalOpen) {
      if (event.code === 'Escape' && this.playing) { event.preventDefault(); this.goToMenu(); }
      return;
    }
    if (event.code === 'Escape') { event.preventDefault(); this.closeModal(); }
    if ((event.code === 'ArrowLeft' || event.code === 'ArrowRight') && document.activeElement?.classList.contains('notebook-tab')) {
      event.preventDefault();
      const tabs = [...this.root.querySelectorAll<HTMLButtonElement>('.notebook-tab')];
      const next = (tabs.indexOf(document.activeElement as HTMLButtonElement) + (event.code === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      const id = tabs[next]?.dataset.tab;
      if (id) { this.notebookTab = id as NotebookTab; this.showNotebook(); this.root.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)?.focus(); }
    }
    if (event.code === 'Tab') {
      const items = [...this.root.querySelectorAll<HTMLElement>('#modal-layer button:not(:disabled), #modal-layer input:not(:disabled), #modal-layer select:not(:disabled), #modal-layer textarea:not(:disabled), #modal-layer [tabindex="0"]')].filter((element) => element.getClientRects().length > 0);
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
    this.controller.setReducedMotion(this.motionReduced());
    this.controller.setGraphicsQuality(this.extensions.preferences.graphicsQuality);
    this.controller.setInspected(this.progress?.inspectedIds ?? []);
    this.controller.setEnergyPlan(this.progress?.plan?.kind === 'timeline' ? this.progress.plan : this.progress?.appliedPlan ?? null);
    this.controller.setThermalView(this.thermalView);
    this.controller.setCampaignPlan(this.progress?.plan ?? null);
    this.controller.setPlayerPosition(this.progress?.playerPosition ?? this.activeCase.initialPosition);
    this.syncActive();
  }

  private syncActive(): void {
    const active = this.playing && this.ready && !this.modalOpen && !document.hidden;
    if (!active) this.joystick?.reset();
    this.controller?.setActive(active);
  }

  private startNew(): void {
    this.acceptCampaign(createCampaign());
    this.persist();
    this.startGame();
    this.showBriefing();
  }

  private acceptCampaign(save: CampaignSave): void {
    const changed = this.activeCase.id !== save.currentCaseId;
    this.campaign = save;
    this.activeCase = getCampaignCase(save.currentCaseId);
    this.progress = getCaseProgress(save);
    if (changed) {
      this.ready = false; this.nearby = null; this.thermalView = false;
      this.joystick?.reset(); this.controller?.setActive(false);
      this.controller?.setLevel(this.activeCase);
    }
    this.updateHud();
  }

  private startCase(id: string): void {
    const save = this.campaign ?? createCampaign();
    if (!isCaseUnlocked(save, id)) { this.toast('Сначала завершите предыдущее расследование.'); return; }
    this.persist();
    this.acceptCampaign(selectCase(this.campaign ?? save, id));
    this.startGame(); this.persist(); this.showBriefing();
  }

  private startGame(): void {
    if (!this.progress) return;
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
    const extensionSaved = saveExtensions(this.extensions);
    if (!this.progress || !this.campaign) return;
    if (this.controller && this.playing && this.ready) this.progress.playerPosition = this.controller.getPlayerPosition();
    this.progress.updatedAt = new Date().toISOString();
    this.campaign = { ...this.campaign, cases: { ...this.campaign.cases, [this.activeCase.id]: { ...this.progress } }, updatedAt: this.progress.updatedAt };
    this.persistFailed = !saveCampaign(this.campaign) || !extensionSaved;
    this.lastSavedAt = Date.now();
    this.updateSaveStatus();
  }

  private motionReduced(): boolean {
    return this.settings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private applySettings(): void {
    this.root.classList.toggle('reduced-motion', this.motionReduced());
    this.root.classList.toggle('hide-hints', !this.settings.showHints);
    this.controller?.setReducedMotion(this.motionReduced());
    this.controller?.setGraphicsQuality(this.extensions.preferences.graphicsQuality);
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
    const finished = this.campaign ? Object.values(this.campaign.cases).filter((item) => item.completed).length : 0;
    this.root.querySelector('#continue-detail')!.textContent = this.progress ? `${this.activeCase.order} / 5 · ${this.activeCase.title.split(': ').at(-1)} · ${finished} дел завершено` : 'Пока нет сохранённой кампании';
    const stats = this.campaign ? getCampaignStats(this.campaign) : null;
    this.root.querySelector('#menu-campaign-progress')!.textContent = stats ? `${stats.rank} · уровень ${stats.level} · ${stats.xp} XP · ${finished}/5 дел` : 'Пять расследований. Одна школа. Ваша история.';
  }

  private updateHud(): void {
    const level = this.activeCase;
    const inspected = this.progress?.inspectedIds ?? [];
    const eligible = !!this.progress && hasRequiredEvidence(level, this.progress);
    const complete = this.progress?.completed ?? false;
    const solved = this.progress?.reportSolved ?? false;
    const analysis = this.progress?.analysisSolved ?? false;
    const shortTitle = level.title.split(': ').at(-1)!;
    this.root.querySelector('.case-heading h1')!.textContent = shortTitle;
    this.root.querySelector('.case-heading p')!.textContent = level.location;
    this.root.querySelector('.case-number > span:first-child')!.textContent = String(level.order).padStart(3, '0');
    this.root.querySelector('.scene-heading h2')!.textContent = level.location;
    this.root.querySelector('.scene-heading .eyebrow')!.textContent = `ЛОКАЦИЯ ${String(level.order).padStart(2, '0')} / ИССЛЕДОВАНИЕ`;
    this.roomParent.setAttribute('aria-label', `${level.location}. Управляйте персонажем WASD или стрелками, E — осмотр.`);
    this.root.querySelector('.mobile-hud strong')!.textContent = shortTitle;
    this.root.querySelector('.mobile-hud div > span')!.textContent = `ДЕЛО ${String(level.order).padStart(3, '0')} / ${level.location}`;
    this.root.querySelector('#evidence-count')!.textContent = `${inspected.length} / ${level.equipment.length}`;
    this.root.querySelector('#mobile-evidence-count')!.textContent = `${inspected.length}/${level.equipment.length}`;
    this.root.querySelector<HTMLElement>('#evidence-progress')!.style.width = `${this.progress ? calculateCaseCompletion(level, this.progress) : 0}%`;
    this.root.querySelector('#step-inspect')!.classList.toggle('complete', eligible);
    this.root.querySelector('#step-report')!.classList.toggle('complete', analysis && solved);
    this.root.querySelector('#step-solved')!.classList.toggle('complete', complete);
    this.root.querySelector('.case-tag')!.textContent = complete ? 'ЗАВЕРШЕНО' : 'В РАБОТЕ';
    this.root.querySelector('.objective')!.textContent = level.topic;
    this.root.querySelector('#evidence-list')!.innerHTML = level.equipment.map((device) => {
      const found = inspected.includes(device.id);
      return `<button class="evidence-item ${found ? 'found' : ''}" data-action="evidence" data-id="${device.id}" ${found ? '' : 'disabled'}><span class="evidence-icon">${icon(device.category)}</span><span>${escape(device.shortName)}<small>${found ? 'Свидетельство записано' : 'Подойдите и осмотрите'}</small></span><span class="evidence-state">${found ? icon('check') : '·'}</span></button>`;
    }).join('');
    const report = this.root.querySelector<HTMLButtonElement>('#report-button')!;
    report.disabled = !eligible && !complete;
    report.innerHTML = `${icon('folder')} ${complete ? 'Итоговый отчёт' : !analysis ? 'Анализ улик' : !solved ? 'Проверить гипотезу' : 'План решения'} ${icon('arrow')}`;
    const missing = level.requiredDeviceIds.filter((id) => !inspected.includes(id)).map((id) => level.equipment.find((device) => device.id === id)!.shortName);
    const objective = complete ? 'Расследование завершено. Откройте карту школы для следующего дела.' : !eligible ? `Найдите: ${missing[0] ?? 'ключевые улики'}. Осмотрите объект и запишите наблюдение.` : !analysis ? 'Улики собраны. Сопоставьте источники и ответьте на вопросы анализа.' : !solved ? 'Анализ выполнен. Проверьте причины в гипотезе.' : 'Гипотеза подтверждена. Составьте безопасный план и проверьте последствия.';
    this.root.querySelector('#report-hint')!.textContent = objective;
    this.root.querySelector('#mission-message')!.textContent = objective;
    this.root.querySelector('#mission-phase')!.textContent = complete ? 'ДЕЛО ЗАВЕРШЕНО' : !eligible ? '01 / СБОР УЛИК' : !analysis ? '02 / АНАЛИЗ И ПРОТИВОРЕЧИЯ' : !solved ? '03 / ГИПОТЕЗА' : '04 / ПЛАН И ПОСЛЕДСТВИЯ';
    this.root.querySelector<HTMLElement>('#plan-button')!.hidden = !solved || !analysis;
    this.root.querySelector('#plan-button')!.innerHTML = `${icon('bolt')} ${level.puzzle.kind === 'thermal' ? 'Анализатор теплопотерь' : 'Лаборатория решений'} ${icon('arrow')}`;
    const thermal = this.root.querySelector<HTMLElement>('#thermal-tool')!;
    thermal.hidden = level.theme !== 'thermal' && level.theme !== 'school';
    thermal.setAttribute('aria-pressed', String(this.thermalView));
    const stats = this.campaign ? getCampaignStats(this.campaign) : null;
    this.root.querySelector('#detective-stats')!.textContent = stats ? `${stats.rank} · ур. ${stats.level} · ${stats.xp} XP` : 'Детектив-стажёр';
    this.root.querySelector('#mobile-objective')!.textContent = objective;
    this.controller?.setInspected(inspected);
    this.controller?.setCampaignPlan(this.progress?.plan ?? null);
    this.controller?.setEnergyPlan(this.progress?.plan?.kind === 'timeline' ? this.progress.plan : this.progress?.appliedPlan ?? null);
    this.updateSaveStatus(); this.updateNearby(); this.updateMenu();
  }

  private updateNearby(): void {
    const device = this.activeCase.equipment.find((entry) => entry.id === this.nearby);
    this.root.querySelector('#nearby-hint')!.innerHTML = device ? `${icon('search')} <span>${escape(device.shortName)}</span><button class="inline-interact" data-action="interact"><kbd>E</kbd> Осмотреть</button>` : `${icon('search')} Подойдите к устройству с бирюзовой меткой`;
    this.root.querySelector<HTMLButtonElement>('#touch-interact')!.disabled = !device || this.modalOpen || !this.playing;
  }

  private confirmNew(): void {
    this.showModal('Новое расследование', `<p>Все пять расследований, XP и достижения текущей кампании будут заменены новым прохождением. Это действие выполняется только после вашего подтверждения.</p><div class="modal-actions"><button class="button secondary" data-action="close">Сохранить текущее</button><button class="button primary" data-action="confirm-new">Начать заново ${icon('arrow')}</button></div>`, 'НОВОЕ ДЕЛО');
  }

  private openEquipment(id: string, inspect: boolean): void {
    const device = this.activeCase.equipment.find((entry) => entry.id === id);
    if (!device || !this.progress) return;
    const recorded = this.progress.inspectedIds.includes(id);
    if (!inspect && !recorded) return;
    this.showModal(device.name, this.deviceContent(device, recorded), recorded ? `СВИДЕТЕЛЬСТВО / ${this.progress.inspectedIds.indexOf(id) + 1}` : 'СКАНЕР / НОВЫЙ ОБЪЕКТ');
  }

  private recordEvidence(id: string): void {
    const device = this.activeCase.equipment.find((entry) => entry.id === id);
    if (!device || !this.progress || !this.campaign || this.progress.inspectedIds.includes(id) || !this.playing || !this.modalOpen) return;
    const before = hasRequiredEvidence(this.activeCase, this.progress);
    this.acceptCampaign(inspectCampaignEquipment(this.campaign, id));
    this.persist(); this.audio.play('clue');
    this.showModal(device.name, this.deviceContent(device, true), `СВИДЕТЕЛЬСТВО / ${this.progress.inspectedIds.indexOf(id) + 1}`);
    this.toast(!before && hasRequiredEvidence(this.activeCase, this.progress) ? 'Источники собраны. Откройте анализ улик в блокноте.' : `Записано: ${device.shortName} · XP за первую находку`);
  }

  private deviceContent(device: Equipment, recorded = true): string {
    return renderDeviceDetails(device, this.activeCase.workingDays, recorded, { modelAvailable: getDeviceModel(device) !== null });
  }

  private async show3DInspection(id: string): Promise<void> {
    const device = this.activeCase.equipment.find((entry) => entry.id === id);
    const definition = device && getDeviceModel(device);
    if (!device || !definition || !this.progress || !this.modalOpen) return;
    this.showModal(device.name, `<div id="device-viewer"><p role="status">Подготавливаем 3D-модель…</p></div><div class="modal-actions"><button class="button secondary" data-action="device-back" data-id="${escape(id)}">${icon('back')} К паспорту устройства</button><button class="button primary" data-action="close">В локацию</button></div>`, '3D / ИНТЕРАКТИВНЫЙ ОСМОТР', 'wide-modal inspection-modal');
    const version = this.modalVersion;
    try {
      // The school remains Canvas-based. Three.js is loaded only for this panel.
      const { createDeviceViewer } = await import('../inspection/DeviceViewer');
      const host = this.root.querySelector<HTMLElement>('#device-viewer');
      if (!host?.isConnected || !this.modalOpen || version !== this.modalVersion) return;
      let viewer: ReturnType<typeof createDeviceViewer> | undefined;
      viewer = createDeviceViewer(host, device, this.activeCase.workingDays, {
        quality: this.extensions.preferences.graphicsQuality,
        reducedMotion: this.motionReduced(),
        onPart: () => {
          if (!viewer?.supported) return;
          const rewardId = `v3:model:${definition.id}`;
          if (!this.extensions.profile.rewardIds.includes(rewardId)) {
            this.extensions.profile.rewardIds.push(rewardId);
            this.persist();
          }
        },
      });
      this.modalCleanup = () => viewer?.dispose();
    } catch {
      if (version !== this.modalVersion || !this.modalOpen) return;
      const host = this.root.querySelector<HTMLElement>('#device-viewer');
      if (host) host.innerHTML = `<p class="demo-footnote" role="status">3D-модуль сейчас недоступен. Открыт 2D-паспорт с теми же данными; можно продолжать расследование.</p>${renderDeviceDetails(device, this.activeCase.workingDays, this.progress.inspectedIds.includes(id))}`;
    }
  }

  private showReport(): void {
    if (!this.progress) return;
    if (this.progress.completed) { this.showFinalReport(); return; }
    if (!hasRequiredEvidence(this.activeCase, this.progress)) { this.toast('Сначала соберите ключевые источники данных.'); return; }
    if (!this.progress.analysisSolved) { this.showAnalysis(); return; }
    if (this.progress.reportSolved) { this.showEnergyPlan(); return; }
    this.selectedOption = null;
    const multiple = !!this.activeCase.correctHypothesisIds;
    this.showModal('Какие причины подтверждены?', `<p class="modal-intro">${multiple ? 'Выберите все независимые причины, подтверждённые источниками. Ложные подозрения в отчёт не включайте.' : 'Выберите гипотезу по собранным источникам. Сравните назначение, длительность работы и безопасность.'}</p><fieldset class="report-options"><legend>${multiple ? 'Несколько причин могут действовать одновременно' : 'Ваша гипотеза'}</legend>${this.activeCase.reportOptions.map((option) => `<label class="report-option"><input type="${multiple ? 'checkbox' : 'radio'}" name="report-option" value="${option.id}" /><span class="radio-indicator"></span><span><strong>${escape(option.title)}</strong><small>${escape(option.description)}</small></span></label>`).join('')}</fieldset><div class="modal-actions"><button class="button secondary" data-action="notebook">К источникам</button><button id="submit-report" class="button primary" data-action="submit-report" disabled>Защитить гипотезу ${icon('arrow')}</button></div>`, `ГИПОТЕЗА / ДЕЛО ${this.activeCase.order}`, 'wide-modal');
  }

  private submitReport(): void {
    if (!this.campaign || !this.progress?.analysisSolved) return;
    const ids = [...this.root.querySelectorAll<HTMLInputElement>('input[name="report-option"]:checked')].map((input) => input.value);
    if (!ids.length) return;
    const result = submitCampaignHypothesis(this.campaign, ids);
    this.acceptCampaign(result.save); this.persist(); this.audio.play(result.correct ? 'success' : 'retry');
    if (result.correct) {
      this.showModal('Гипотеза подтверждена', `<div class="result-symbol">${icon('check')}</div>${result.feedback.map((message) => `<p>${escape(message)}</p>`).join('')}<p>Теперь проверьте решение в модели. План должен сохранять безопасность и необходимые функции.</p><div class="modal-actions"><button class="button primary" data-action="energy-plan">К плану решения ${icon('arrow')}</button></div>`, 'ПРИЧИНЫ УСТАНОВЛЕНЫ');
    } else this.showModal('Пересмотрите гипотезу', `<div class="result-symbol wrong">${icon('search')}</div>${result.feedback.map((message) => `<p>${escape(message)}</p>`).join('')}<div class="modal-actions"><button class="button secondary" data-action="notebook">Сравнить улики</button><button class="button primary" data-action="retry-report">Другая гипотеза</button></div>`, 'ОШИБКА — ЧАСТЬ РАССЛЕДОВАНИЯ');
  }

  private showAnalysis(): void {
    if (!this.progress || !canAnalyzeCase(this.activeCase, this.progress)) return;
    this.showModal('Сопоставьте источники', renderAnalysis(this.activeCase, this.progress), `АНАЛИЗ / ДЕЛО ${this.activeCase.order}`, 'wide-modal');
  }

  private submitAnalysis(): void {
    if (!this.campaign || !this.progress || !canAnalyzeCase(this.activeCase, this.progress)) return;
    const result = answerAnalysis(this.campaign, readAnalysisAnswers(this.root));
    this.acceptCampaign(result.save); this.persist(); this.audio.play(result.correct ? 'success' : 'retry');
    this.showModal(result.correct ? 'Источники согласованы' : 'В данных есть противоречие', `${result.feedback.map((message) => `<p>${escape(message)}</p>`).join('')}<div class="modal-actions"><button class="button secondary" data-action="notebook">Блокнот</button><button class="button primary" data-action="${result.correct ? 'report' : 'retry-analysis'}">${result.correct ? 'Сформулировать гипотезу' : 'Проверить анализ снова'} ${icon('arrow')}</button></div>`, 'СВЯЗЬ УЛИК И ВЫВОДОВ', 'wide-modal');
  }

  private showFinalReport(result?: PlanEvaluation): void {
    if (!this.progress || !this.campaign) return;
    const evaluation = result ?? (this.progress.plan ? evaluatePlan(this.activeCase, this.progress.plan) : null);
    const stats = getCampaignStats(this.campaign);
    const next = CAMPAIGN_CASES[this.activeCase.order];
    this.showModal(this.activeCase.order === 5 ? 'Школа под защитой детектива' : 'Расследование завершено', `<div class="result-symbol">${icon('trophy')}</div><div class="detective-rank"><span>${this.activeCase.order === 5 ? 'КАМПАНИЯ ЗАВЕРШЕНА' : `ДЕЛО ${this.activeCase.order} / 5`}</span><strong>${stats.rank}</strong><p>Уровень ${stats.level} · ${stats.xp} XP — игровые награды, отдельно от кВт·ч</p></div>${evaluation ? renderPlanPreview(evaluation) : ''}<div class="report-conclusion"><h3>Что установлено</h3>${this.activeCase.conclusion.map((text) => `<p>${escape(text)}</p>`).join('')}<p>Источников: ${this.progress.inspectedIds.length}/${this.activeCase.equipment.length}. Проверок анализа: ${this.progress.analysisAttempts}; гипотез: ${this.progress.reportAttempts}; планов: ${this.progress.puzzleAttempts}.</p><p>Практика: обсуждайте режимы с ответственными взрослыми, сохраняйте работу, поддерживайте освещённость, комфорт и холодовую цепь.</p></div><p class="demo-footnote">Все результаты расчётные. План не управляет настоящим оборудованием и не подтверждает экономию в СШ №225.</p><div class="modal-actions"><button class="button secondary" data-action="cases">Карта школы</button>${next ? '<button class="button primary" data-action="next-case">Следующее расследование →</button>' : '<button class="button primary" data-action="achievements">Моё досье</button>'}<button class="button secondary" data-action="energy-plan">Сравнить другой план</button><button class="button secondary" data-action="close">Исследовать дальше</button></div>`, 'ИТОГИ, ПОСЛЕДСТВИЯ И НАГРАДЫ', 'wide-modal');
  }

  private showCases(): void {
    const save = this.campaign ?? createCampaign();
    this.showModal('Карта условной школы №225', `<p>Пять разных расследований. Следующее дело открывается после безопасного решения предыдущего.</p><div class="school-map-art" aria-hidden="true"><div class="school-roof"></div><div class="school-windows">${'<i></i>'.repeat(15)}</div><span>225</span><div class="school-entry"></div></div><div class="campaign-map">${CAMPAIGN_CASES.map((level) => {
      const unlocked = isCaseUnlocked(save, level.id);
      const progress = getCaseProgress(save, level.id);
      return `<button class="campaign-case ${progress.completed ? 'case-complete' : ''} ${unlocked ? '' : 'case-locked'}" data-action="case-play" data-id="${level.id}" ${unlocked ? '' : 'disabled'}><span class="map-order">${progress.completed ? icon('check') : unlocked ? String(level.order).padStart(2, '0') : icon('lock')}</span><span><small>${escape(level.location)} · сложность ${level.order}/5</small><strong>${escape(level.title.split(': ').at(-1)!)}</strong><span>${escape(level.topic)}</span><b>${calculateCaseCompletion(level, progress)}% · ${progress.completed ? 'Награда получена' : `${level.completionXp} XP за завершение`}</b><em>${unlocked ? `Ориентир первого прохождения: ${level.targetMinutes.join('–')} мин` : `Завершите дело ${level.order - 1}`}</em></span>${icon(unlocked ? 'arrow' : 'lock')}</button>`;
    }).join('')}</div><p class="demo-footnote">Длительности — цели проектирования; фактическое время школьников ещё нужно измерить. Планировка и события вымышлены, фотографии реальной школы не использованы.</p>`, 'ВЫБОР РАССЛЕДОВАНИЯ', 'wide-modal');
  }

  private showNotebook(): void {
    this.showModal('Цифровой блокнот', renderNotebook(this.activeCase, this.progress, this.root.querySelector('#mission-message')!.textContent ?? '', this.notebookTab), 'УЛИКИ / СВЯЗИ / ЗАДАНИЯ / ИСТОРИЯ', 'wide-modal');
  }

  private toggleSuspect(id?: string): void {
    if (!id || !this.progress?.inspectedIds.includes(id)) return;
    this.progress.taggedEquipmentIds = this.progress.taggedEquipmentIds.includes(id) ? this.progress.taggedEquipmentIds.filter((entry) => entry !== id) : [...this.progress.taggedEquipmentIds, id];
    this.persist(); this.showNotebook();
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else this.toast('Браузер не поддерживает полноэкранный режим. Для запуска без панели браузера установите игру на главный экран.');
    } catch { this.toast('Браузер не разрешил полноэкранный режим. Можно играть в текущем окне или установить игру.'); }
  }

  private showBriefing(): void {
    const level = this.activeCase;
    this.showModal(level.title.split(': ').at(-1)!, `<div class="dispatch-card"><div class="dispatch-avatar">${icon('leaf')}</div><div><span>БЮРО / ДЕЛО ${String(level.order).padStart(3, '0')}</span><strong>${escape(level.location)}</strong></div></div><p class="briefing-story">${escape(level.briefing)}</p><div class="briefing-goals"><div><b>01</b><strong>Исследуйте источники</strong><small>Оборудование, журналы, расписания и датчики. Осмотр дополните записью в блокнот.</small></div><div><b>02</b><strong>Проверьте причины</strong><small>Сопоставьте данные, найдите противоречия и защитите гипотезу.</small></div><div><b>03</b><strong>Разработайте решение</strong><small>${escape(level.topic)}. Сравните планы и последствия.</small></div></div><p class="demo-footnote">Учебная модель СШ №225 Минска. Данные, планировка и ситуации вымышлены. Ориентир: ${level.targetMinutes.join('–')} минут; это ещё не измеренное время игроков.</p><div class="briefing-controls"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> или стрелки</span><span><kbd>E</kbd> осмотр</span><small>На телефоне — джойстик, крупная кнопка и камера с +/−. ${level.theme === 'thermal' || level.theme === 'school' ? 'Тепловизор включается кнопкой в игровом поле.' : ''}</small></div><div class="modal-actions"><button class="button primary" data-action="close">К расследованию ${icon('arrow')}</button></div>`, 'ЗАДАНИЕ И ОБРАЗОВАТЕЛЬНАЯ ТЕМА', 'wide-modal');
  }

  private showEnergyPlan(): void {
    if (!this.progress?.reportSolved || (!this.progress.analysisSolved && !this.progress.completed)) return;
    this.draftPlan = this.progress.plan ? structuredClone(this.progress.plan) : defaultPlan(this.activeCase);
    this.showModal(this.activeCase.puzzle.kind === 'thermal' ? 'Лаборатория теплопотерь' : this.activeCase.puzzle.kind === 'crisis' ? 'Комплексный план школы' : 'Лаборатория решений', renderPlan(this.activeCase, this.draftPlan), `ПЛАН / ДЕЛО ${this.activeCase.order}`, 'wide-modal');
    this.updatePlanPreview();
  }

  private updatePlanPreview(): void {
    const target = this.root.querySelector('#campaign-plan-preview');
    if (!target) return;
    const result = evaluatePlan(this.activeCase, this.draftPlan);
    target.innerHTML = renderPlanPreview(result);
    for (const output of this.root.querySelectorAll<HTMLElement>('[data-plan-value]')) {
      const input = this.root.querySelector<HTMLInputElement>(`#${output.dataset.planValue}`);
      if (input) output.textContent = input.value;
    }
  }

  private commitEnergyPlan(): void {
    if (!this.campaign || !this.progress?.reportSolved) return;
    this.draftPlan = readPlan(this.root, this.activeCase);
    const result = submitCampaignPlan(this.campaign, this.draftPlan);
    this.acceptCampaign(result.save); this.persist(); this.audio.play(result.result.passes ? 'success' : 'retry');
    if (result.result.passes) this.showFinalReport(result.result);
    else this.showModal('План требует доработки', `${renderPlanPreview(result.result)}<p>Решение пока не завершает дело. Изучите последствия, сохраните нужные функции и сравните другой вариант.</p><div class="modal-actions"><button class="button secondary" data-action="notebook">К данным</button><button class="button primary" data-action="energy-plan">Изменить план</button></div>`, 'ПРОВЕРКА БЕЗОПАСНОСТИ И ЭФФЕКТИВНОСТИ', 'wide-modal');
  }

  private showAchievements(): void {
    const stats = getCampaignStats(this.campaign ?? createCampaign());
    this.showModal('Досье детектива', `<div class="detective-rank"><span>ИГРОВАЯ ПРОГРЕССИЯ</span><strong>${stats.rank}</strong><p>Уровень ${stats.level} · ${stats.xp} XP</p></div><p>XP начисляется один раз за новые улики, этапы и результаты. Повторные осмотры и переоткрытие отчётов не приносят бесконечные награды.</p><div class="achievements">${stats.achievements.map((item) => `<div class="achievement ${item.unlocked ? 'earned' : ''}"><span>${icon(item.unlocked ? 'trophy' : 'lock')}</span><div><strong>${escape(item.title)}</strong><small>${escape(item.description)}</small></div>${icon(item.unlocked ? 'check' : 'lock')}</div>`).join('')}</div><p class="demo-footnote">Игровые XP и звания не являются кВт·ч или измеренной экономией. Дополнительные цели: исследуйте все источники, решайте анализ точно и найдите особенно эффективный безопасный план.</p>`, 'ОПЫТ, ЗВАНИЯ И ДОСТИЖЕНИЯ');
  }

  private showSettings(): void {
    this.showModal('Настройки', `<label class="graphics-setting"><span>Качество графики</span><select data-v3-setting="graphicsQuality">${([['auto', 'Авто'], ['low', 'Низкое'], ['medium', 'Среднее'], ['high', 'Высокое']] as const).map(([value, title]) => `<option value="${value}" ${this.extensions.preferences.graphicsQuality === value ? 'selected' : ''}>${title}</option>`).join('')}</select><small>Авто: среднее на мобильном экране, высокое на ПК. Низкое выключает частицы и часть световых эффектов.</small></label><label class="setting-row"><span><strong>Меньше анимации</strong><small>Уменьшить движение и свечение интерфейса</small></span><input type="checkbox" data-setting="reducedMotion" ${this.settings.reducedMotion ? 'checked' : ''} /><span class="switch" aria-hidden="true"></span></label><label class="setting-row"><span><strong>Подсказки управления</strong><small>Показывать клавиши на игровом экране</small></span><input type="checkbox" data-setting="showHints" ${this.settings.showHints ? 'checked' : ''} /><span class="switch" aria-hidden="true"></span></label><label class="setting-row"><span><strong>Звуки расследования</strong><small>Тихие сигналы новых улик, гипотез и результатов</small></span><input type="checkbox" data-setting="soundEnabled" ${this.settings.soundEnabled ? 'checked' : ''} /><span class="switch" aria-hidden="true"></span></label><label class="sensitivity-setting">Чувствительность джойстика<input type="range" min="0.5" max="1.5" step="0.1" value="${this.settings.joystickSensitivity}" data-setting="joystickSensitivity" /><small>Слева — точное медленное движение, справа — быстрый отклик.</small></label><div class="future-note">${icon('save')}<div><strong>Всё остаётся на вашем устройстве</strong><p>Игра сохраняет позицию, записи и отчёт в localStorage. При очистке данных браузера сохранение удаляется.</p></div></div><p class="demo-footnote">Звук включается вами и создаётся локально. Переназначение клавиш пока не реализовано. Текущий прототип не требует регистрации и API-ключей.</p>`, 'ПАРАМЕТРЫ СИСТЕМЫ');
  }

  private showHelp(): void {
    const baseline = evaluatePlan(this.activeCase, defaultPlan(this.activeCase));
    const modelNote = `${baseline.electricBeforeKwh > 0 ? `Электричество: ${formatEnergy(baseline.electricBeforeKwh)} кВт·ч за ${this.activeCase.workingDays} учебных дней. ` : ''}${baseline.heatBeforeKwh !== undefined ? `Тепловые потери: ${formatEnergy(baseline.heatBeforeKwh)} кВт·ч по отдельной модели; это не расход электричества. ` : ''}`;
    this.showModal('Как вести расследование', `<div class="help-steps"><p><span>01</span><strong>Исследуйте локацию</strong><small>WASD или стрелки. На сенсорном экране используйте джойстик слева внизу. Камера следует за персонажем; кнопки +/− меняют масштаб.</small></p><p><span>02</span><strong>Изучайте источники данных</strong><small>Подойдите к бирюзовой метке и нажмите E, саму метку или кнопку «Осмотреть». Стены и мебель ограничивают движение.</small></p><p><span>03</span><strong>Сравнивайте свидетельства</strong><small>Осмотрите: ${this.activeCase.requiredDeviceIds.map((id) => this.activeCase.equipment.find((device) => device.id === id)!.shortName).join(', ')}. Нажмите «Записать улику» в панели источника. Повторно открыть данные и отметить подозрения можно в блокноте.</small></p><p><span>04</span><strong>Проанализируйте улики и защитите гипотезу</strong><small>Сопоставьте журналы и режимы работы. Для электричества энергия = мощность × время ÷ 1000. Учтите длительность работы и безопасность изменения режима.</small></p><p><span>05</span><strong>Проверьте безопасный план</strong><small>После верной гипотезы откройте план решения. Меняйте расписание, режимы или набор мер, учитывая бюджет и обязательные условия. Принятый план изменит модель комнаты и откроет следующее дело.</small></p></div><p class="demo-footnote">Esc закрывает панель, повторный Esc возвращает в меню. Прогресс сохраняется автоматически. ${modelNote}Все величины учебные, не школьные измерения.</p><div class="modal-actions"><button class="button primary" data-action="close">Всё понятно ${icon('check')}</button></div>`, 'РУКОВОДСТВО ДЕТЕКТИВА');
  }

  private showModal(title: string, body: string, eyebrow: string, className = ''): void {
    this.modalVersion += 1;
    this.modalCleanup?.();
    this.modalCleanup = undefined;
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
    this.modalVersion += 1;
    this.modalCleanup?.();
    this.modalCleanup = undefined;
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
