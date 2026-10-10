import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Equipment } from '../types';
import { calculateEquipmentEnergy, formatEnergy } from '../systems/energy';
import { getDeviceModel } from './catalog';
import { buildDeviceModel } from './models';
import './Viewer.css';

export type DeviceViewerOptions = {
  quality: 'auto' | 'low' | 'medium' | 'high';
  reducedMotion: boolean;
  onPart?: (partId: string) => void;
};

export type DeviceViewer = {
  readonly supported: boolean;
  dispose(): void;
  reset(): void;
  zoom(delta: number): void;
  setScanner(enabled: boolean): void;
  selectPart(id: string): void;
  getDiagnostics(): {
    supported: boolean;
    disposed: boolean;
    framesRendered: number;
    pendingFrame: boolean;
    selectedPartId: string | null;
    scanner: boolean;
    activePointers: number;
    contextLost: boolean;
    fallbackReason: string | null;
    distance: number | null;
    minDistance: number | null;
    maxDistance: number | null;
    azimuth: number | null;
    polar: number | null;
    geometries: number;
    textures: number;
  };
};

type Model = ReturnType<typeof buildDeviceModel>;
type Definition = NonNullable<ReturnType<typeof getDeviceModel>>;
type SavedMaterial = { emissive: THREE.Color; emissiveIntensity: number };

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pixelRatio(quality: DeviceViewerOptions['quality']): number {
  const compact = matchMedia('(pointer: coarse)').matches || innerWidth < 700;
  const cap = quality === 'low' ? 1 : quality === 'medium' ? 1.5 : quality === 'high' ? 2 : compact ? 1.25 : 1.5;
  return Math.max(1, Math.min(devicePixelRatio || 1, cap));
}

class InspectionViewer implements DeviceViewer {
  private readonly root = element('section', 'device-viewer');
  private readonly stage = element('div', 'device-viewer__stage');
  private readonly status = element('p', 'device-viewer__status');
  private readonly readout = element('div', 'device-viewer__readout');
  private readonly scannerButton = element('button', 'device-viewer__tool', 'Сканер');
  private readonly partButtons = new Map<string, HTMLButtonElement>();
  private readonly abort = new AbortController();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly activePointers = new Set<number>();
  private readonly materialStates = new Map<THREE.MeshStandardMaterial, SavedMaterial>();
  private readonly selectedEdges: THREE.LineSegments[] = [];
  private readonly definition: Definition;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private model: Model | null = null;
  private floor: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private frame: number | null = null;
  private framesRendered = 0;
  private disposed = false;
  private scanner = false;
  private visible = true;
  private contextLost = false;
  private fallbackReason: string | null = null;
  private selectedPartId: string | null = null;
  private pointerStart: { id: number; x: number; y: number; multi: boolean } | null = null;

  get supported(): boolean { return this.renderer !== null && !this.contextLost && !this.disposed; }

  constructor(
    host: HTMLElement,
    private readonly device: Equipment,
    private readonly workingDays: number,
    private readonly options: DeviceViewerOptions,
  ) {
    const definition = getDeviceModel(device);
    if (!definition) throw new RangeError('This device has no inspection model.');
    this.definition = definition;
    this.root.setAttribute('aria-label', `Осмотр: ${this.definition.name}`);
    this.stage.setAttribute('aria-label', 'Область модели устройства');
    this.status.setAttribute('aria-live', 'polite');
    const toolbar = element('div', 'device-viewer__toolbar');
    const tools: [string, string, () => void][] = [
      ['−', 'Отдалить модель', () => this.zoom(-0.2)],
      ['Сброс', 'Вернуть исходный ракурс', () => this.reset()],
      ['+', 'Приблизить модель', () => this.zoom(0.2)],
    ];
    for (const [label, ariaLabel, action] of tools) {
      const button = element('button', 'device-viewer__tool', label);
      button.type = 'button';
      button.setAttribute('aria-label', ariaLabel);
      button.addEventListener('click', action, { signal: this.abort.signal });
      toolbar.append(button);
    }
    this.scannerButton.type = 'button';
    this.scannerButton.setAttribute('aria-pressed', 'false');
    this.scannerButton.addEventListener('click', () => this.setScanner(!this.scanner), { signal: this.abort.signal });
    toolbar.append(this.scannerButton);
    const parts = element('div', 'device-viewer__parts');
    parts.setAttribute('aria-label', 'Компоненты устройства');
    for (const part of this.definition.parts) {
      const button = element('button', 'device-viewer__part', part.name);
      button.type = 'button';
      button.dataset.partId = part.id;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => this.selectPart(part.id), { signal: this.abort.signal });
      this.partButtons.set(part.id, button);
      parts.append(button);
    }
    this.root.append(this.stage, toolbar, this.status, parts, this.readout);
    host.replaceChildren(this.root);
    if (this.definition.parts[0]) this.updateSelection(this.definition.parts[0].id, false);
    try { this.initializeWebGL(); }
    catch (error) {
      this.releaseWebGL();
      this.showFallback(error instanceof Error ? error.message : 'model-initialization-error');
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.cancelGesture(); this.cancelFrame(); }
      else this.requestRender();
    }, { signal: this.abort.signal });
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver(([entry]) => {
        this.visible = entry?.isIntersecting ?? true;
        if (this.visible) this.requestRender();
        else this.cancelFrame();
      });
      this.intersectionObserver.observe(this.stage);
    }
  }

  private initializeWebGL(): void {
    const canvas = element('canvas', 'device-viewer__canvas');
    canvas.setAttribute('aria-label', `${this.definition.name}: вращайте мышью или пальцем, масштабируйте колёсиком или двумя пальцами`);
    const context = canvas.getContext('webgl2', { antialias: this.options.quality !== 'low', alpha: true });
    if (!context) throw new Error('webgl-unavailable');
    this.renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: this.options.quality !== 'low' });
    this.renderer.setPixelRatio(pixelRatio(this.options.quality));
    this.renderer.setClearColor(0x08111f, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.scene = new THREE.Scene();
    this.model = buildDeviceModel(this.definition);
    const box = new THREE.Box3().setFromObject(this.model.group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.5, size.length() / 2);
    this.model.group.position.sub(center);
    this.scene.add(this.model.group);
    this.scene.add(new THREE.HemisphereLight(0xc9f6ff, 0x142039, 2.4));
    const key = new THREE.DirectionalLight(0xe7f5ff, 3.2);
    key.position.set(radius * 3, radius * 4, radius * 2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x46dac6, 2);
    rim.position.set(-radius * 3, radius, -radius * 2);
    this.scene.add(rim);
    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 1.5, this.options.quality === 'low' ? 24 : 48),
      new THREE.MeshStandardMaterial({ color: 0x12233a, roughness: 0.92, metalness: 0.08, transparent: true, opacity: 0.7 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -size.y / 2 - 0.025;
    this.scene.add(this.floor);
    this.camera = new THREE.PerspectiveCamera(35, 1, radius * 0.02, radius * 100);
    this.camera.position.set(radius * 2.7, radius * 1.4, radius * 2.7);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = !this.options.reducedMotion;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = radius * 1.55;
    this.controls.maxDistance = radius * 7;
    this.controls.minPolarAngle = Math.PI * 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.82;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.85;
    this.controls.update();
    this.controls.saveState();
    this.controls.addEventListener('change', this.requestRender);
    canvas.addEventListener('webglcontextlost', this.onContextLost, { signal: this.abort.signal });
    canvas.addEventListener('pointerdown', (event) => {
      this.activePointers.add(event.pointerId);
      if (this.activePointers.size > 1 && this.pointerStart) this.pointerStart.multi = true;
      else this.pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY, multi: false };
    }, { signal: this.abort.signal });
    canvas.addEventListener('pointerup', (event) => {
      const start = this.pointerStart;
      if (start?.id === event.pointerId && !start.multi && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8) {
        this.pickPart(event, canvas);
      }
      this.activePointers.delete(event.pointerId);
      if (!this.activePointers.size) this.pointerStart = null;
    }, { signal: this.abort.signal });
    canvas.addEventListener('pointercancel', (event) => {
      if (this.activePointers.has(event.pointerId)) this.cancelGesture();
    }, { signal: this.abort.signal });
    canvas.addEventListener('lostpointercapture', (event) => {
      if (this.activePointers.has(event.pointerId)) this.cancelGesture();
    }, { signal: this.abort.signal });
    window.addEventListener('blur', () => this.cancelGesture(), { signal: this.abort.signal });
    this.stage.replaceChildren(canvas);
    this.root.dataset.mode = '3d';
    this.status.textContent = '3D-модель · вращайте мышью или пальцем · масштабируйте колёсиком или двумя пальцами';
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.stage);
    this.resize();
    this.updateMaterials();
  }

  private resize(): void {
    if (!this.renderer || !this.camera || this.disposed) return;
    const rect = this.stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.renderer.setSize(Math.round(rect.width), Math.round(rect.height), false);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private requestRender = (): void => {
    if (this.disposed || !this.renderer || document.hidden || !this.visible || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (this.disposed || !this.renderer || !this.scene || !this.camera || document.hidden || !this.visible) return;
      const changed = this.controls?.update() ?? false;
      this.renderer.render(this.scene, this.camera);
      this.framesRendered += 1;
      if (changed && this.controls?.enableDamping) this.requestRender();
    });
  };

  private cancelFrame(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  /** Reset OrbitControls' pointer state and damping without moving the current view. */
  private cancelGesture(): void {
    const pointers = [...this.activePointers];
    this.activePointers.clear();
    this.pointerStart = null;
    const controls = this.controls;
    const canvas = this.renderer?.domElement;
    if (controls && canvas && this.camera) {
      const position = this.camera.position.clone();
      const target = controls.target.clone();
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      this.camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
      controls.disconnect();
      controls.connect(canvas);
      controls.enableDamping = damping;
      for (const id of pointers) {
        try { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); } catch { /* Already cancelled by the browser. */ }
      }
    }
    this.cancelFrame();
  }

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.disposed) return;
    this.contextLost = true;
    this.releaseWebGL();
    this.showFallback('webgl-context-lost');
  };

  private pickPart(event: PointerEvent, canvas: HTMLCanvasElement): void {
    if (!this.camera || !this.model) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.model.parts.values()].flat(), false);
    for (const hit of hits) {
      const id = hit.object.userData.partId as unknown;
      if (typeof id === 'string' && this.partButtons.has(id)) { this.selectPart(id); return; }
    }
  }

  private updateSelection(id: string, notify: boolean): void {
    if (this.disposed || !this.partButtons.has(id)) return;
    this.selectedPartId = id;
    this.root.dataset.selectedPart = id;
    for (const [partId, button] of this.partButtons) button.setAttribute('aria-pressed', String(partId === id));
    const part = this.definition.parts.find((candidate) => candidate.id === id)!;
    const heading = element('h4', undefined, part.name);
    const description = element('p', undefined, part.description);
    const energy = calculateEquipmentEnergy(this.device, this.workingDays);
    const representative = calculateEquipmentEnergy({
      ...this.device,
      quantity: 1,
      mode: { ...this.device.mode, powerWatts: this.device.mode.powerWatts * part.powerShare },
      proposedMode: undefined,
    }, this.workingDays);
    const metrics = element('dl', 'device-viewer__metrics');
    const entries: [string, string][] = this.device.mode.powerWatts > 0
      ? [
        ['Учебная доля мощности', `${formatEnergy(this.device.mode.powerWatts * part.powerShare)} Вт · ${Math.round(part.powerShare * 100)}%`],
        ['Компонент одного устройства', `${formatEnergy(representative.monthlyKwh)} кВт·ч за ${this.workingDays} дней`],
        [`Вся группа · ${this.device.quantity} шт.`, `${formatEnergy(energy.monthlyKwh)} кВт·ч за ${this.workingDays} дней`],
      ]
      : [['Тип источника', 'Элемент учебной модели; электрическое потребление не задано']];
    entries.push(['Режим устройства', this.device.mode.label]);
    if (this.device.mode.powerWatts > 0) entries.push(['Продолжительность', `${formatEnergy(this.device.mode.hoursPerDay)} ч в учебный день`]);
    for (const [label, value] of entries) metrics.append(element('dt', undefined, label), element('dd', undefined, value));
    const recommendation = element('p', 'device-viewer__recommendation', `Безопасная оптимизация: ${this.device.recommendation}`);
    const note = element('p', 'device-viewer__note', 'Показана одна условная модель. Доли компонентов — учебные оценки; это не измерения и не паспортные характеристики реального устройства.');
    this.readout.replaceChildren(heading, description, metrics, recommendation, note);
    this.updateMaterials();
    if (notify) this.options.onPart?.(id);
  }

  selectPart(id: string): void { this.updateSelection(id, true); }

  private clearEdges(): void {
    for (const edge of this.selectedEdges) {
      edge.removeFromParent();
      edge.geometry.dispose();
      (edge.material as THREE.Material).dispose();
    }
    this.selectedEdges.length = 0;
  }

  private updateMaterials(): void {
    if (!this.model || this.disposed) return;
    this.clearEdges();
    for (const part of this.definition.parts) {
      const selected = part.id === this.selectedPartId;
      for (const mesh of this.model.parts.get(part.id) ?? []) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          if (!(material instanceof THREE.MeshStandardMaterial)) continue;
          if (!this.materialStates.has(material)) this.materialStates.set(material, { emissive: material.emissive.clone(), emissiveIntensity: material.emissiveIntensity });
          const saved = this.materialStates.get(material)!;
          if (this.scanner) {
            material.emissive.setHSL(0.5 - Math.min(1, part.powerShare) * 0.48, 0.9, 0.48);
            material.emissiveIntensity = selected ? 0.85 : 0.25 + part.powerShare * 0.5;
          } else if (selected) {
            material.emissive.set(0x37cdb5);
            material.emissiveIntensity = 0.25;
          } else {
            material.emissive.copy(saved.emissive);
            material.emissiveIntensity = saved.emissiveIntensity;
          }
        }
        if (selected) {
          const edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), new THREE.LineBasicMaterial({ color: this.scanner ? 0xffd977 : 0x77ffe0, transparent: true, opacity: 0.9 }));
          edge.raycast = () => {};
          mesh.add(edge);
          this.selectedEdges.push(edge);
        }
      }
    }
    this.requestRender();
  }

  setScanner(enabled: boolean): void {
    if (this.disposed) return;
    this.scanner = enabled;
    this.scannerButton.setAttribute('aria-pressed', String(enabled));
    this.root.classList.toggle('device-viewer--scanner', enabled);
    this.updateMaterials();
  }

  zoom(delta: number): void {
    if (!this.controls || !this.camera || !Number.isFinite(delta) || this.disposed) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = THREE.MathUtils.clamp(offset.length() * Math.exp(-delta), this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(offset.setLength(distance));
    this.controls.update();
    this.requestRender();
  }

  reset(): void {
    if (this.disposed) return;
    this.cancelGesture();
    if (this.controls) {
      const damping = this.controls.enableDamping;
      this.controls.enableDamping = false;
      this.controls.update();
      this.controls.reset();
      this.controls.enableDamping = damping;
    }
    this.requestRender();
  }

  private showFallback(reason: string): void {
    this.fallbackReason = reason;
    this.root.dataset.mode = 'fallback';
    this.status.textContent = reason === 'webgl-context-lost'
      ? '3D остановлено устройством. Доступна 2D-схема и информация о компонентах.'
      : '3D недоступно. Доступна 2D-схема и информация о компонентах.';
    const diagram = element('div', 'device-viewer__schematic');
    diagram.append(element('span', 'device-viewer__schematic-label', '2D-схема · условное устройство'));
    for (const part of this.definition.parts) {
      const button = element('button', 'device-viewer__schematic-part', part.name);
      button.type = 'button';
      button.dataset.partId = part.id;
      button.addEventListener('click', () => this.selectPart(part.id), { signal: this.abort.signal });
      diagram.append(button);
    }
    this.stage.replaceChildren(diagram);
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.device-viewer__tool')) {
      if (button !== this.scannerButton) button.disabled = true;
    }
  }

  private releaseWebGL(): void {
    this.cancelFrame();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.controls?.removeEventListener('change', this.requestRender);
    this.controls?.dispose();
    this.controls = null;
    this.activePointers.clear();
    this.pointerStart = null;
    this.clearEdges();
    this.materialStates.clear();
    this.model?.dispose();
    this.model = null;
    this.floor?.geometry.dispose();
    this.floor?.material.dispose();
    this.floor = null;
    this.scene?.clear();
    this.scene = null;
    this.camera = null;
    if (this.renderer) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
      this.renderer.dispose();
      if (!this.contextLost) this.renderer.forceContextLoss();
      this.renderer = null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    this.releaseWebGL();
    this.root.remove();
  }

  getDiagnostics(): ReturnType<DeviceViewer['getDiagnostics']> {
    return {
      supported: this.supported,
      disposed: this.disposed,
      framesRendered: this.framesRendered,
      pendingFrame: this.frame !== null,
      selectedPartId: this.selectedPartId,
      scanner: this.scanner,
      activePointers: this.activePointers.size,
      contextLost: this.contextLost,
      fallbackReason: this.fallbackReason,
      distance: this.camera && this.controls ? this.camera.position.distanceTo(this.controls.target) : null,
      minDistance: this.controls?.minDistance ?? null,
      maxDistance: this.controls?.maxDistance ?? null,
      azimuth: this.controls?.getAzimuthalAngle() ?? null,
      polar: this.controls?.getPolarAngle() ?? null,
      geometries: this.renderer?.info.memory.geometries ?? 0,
      textures: this.renderer?.info.memory.textures ?? 0,
    };
  }
}

export function createDeviceViewer(host: HTMLElement, device: Equipment, workingDays: number, options: DeviceViewerOptions): DeviceViewer {
  return new InspectionViewer(host, device, workingDays, options);
}
