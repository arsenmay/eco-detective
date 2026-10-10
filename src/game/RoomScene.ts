import Phaser from 'phaser';
import type { EnergyPlan, Equipment, GameBridge, Point } from '../types';
import type { CampaignCase, CampaignPlan } from '../campaign/types';
import { CAMPAIGN_CASES } from '../data/campaign';
import { InteractionSystem } from './InteractionSystem';
import { Player } from './Player';
import { capMovementVector } from './cameraLayout';
import { calculateIsoCameraLayout } from '../rendering/isoCamera';
import { screenDirectionToWorld } from '../rendering/projection';
import { renderRoom, type RoomRenderer } from '../rendering/RoomRenderer';
import { safePlayerPositionForLevel } from './roomGeometry';
import { WORLD_HEIGHT, WORLD_WIDTH } from './roomArtwork';

type Direction = 'up' | 'down' | 'left' | 'right';

/** The current fictional location. UI and persistence stay outside Phaser. */
export class RoomScene extends Phaser.Scene {
  private equipment: readonly Equipment[];
  private level: CampaignCase = CAMPAIGN_CASES[0];
  private readonly bridge: GameBridge;
  private player?: Player;
  private interactions?: InteractionSystem;
  private keys?: Record<string, Phaser.Input.Keyboard.Key>;
  private artwork?: RoomRenderer;
  private graphicsQuality: 'auto' | 'low' | 'medium' | 'high' = 'auto';
  private virtualHour = 12;
  private thermalView = false;
  private restartPending = false;
  private energyPlan: EnergyPlan | null = null;
  private campaignPlan: CampaignPlan | null = null;
  private requestedActive = false;
  private hasBeenActive = false;
  private readonly pendingFeedback = new Set<string>();
  private browserFocused = true;
  private reducedMotion = false;
  private inspectedIds: readonly string[] = [];
  private pendingPosition: Point = { ...this.level.initialPosition };
  private nearbyId: string | null = null;
  private lastReportedPosition: Point = { ...this.level.initialPosition };
  private lastPositionTime = 0;
  private wasMoving = false;
  private touchVector: Point = { x: 0, y: 0 };
  private viewport = { width: WORLD_WIDTH, height: WORLD_HEIGHT, mobile: false };
  private zoomOffset = 0;
  private readonly touch: Record<Direction, boolean> = { up: false, down: false, left: false, right: false };
  private readonly capturedKeys = ['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'E'];

  constructor(equipment: readonly Equipment[], bridge: GameBridge) {
    super({ key: 'InvestigationRoom' });
    // The legacy constructor remains compatible with the first prototype;
    // campaign data supplies the current room's complete set of objects.
    this.equipment = this.level.equipment.length ? this.level.equipment : equipment;
    this.bridge = bridge;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#070f1c');
    const { bounds } = this.level.room;
    this.physics.world.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    this.artwork = renderRoom(this, this.level);
    this.applyVisualPlan();
    this.applyThermalVisibility();
    this.pendingPosition = safePlayerPositionForLevel(this.pendingPosition, this.level);
    this.player = new Player(this, this.pendingPosition);

    const furniture = this.physics.add.staticGroup();
    for (const rect of this.level.room.furniture) {
      const zone = this.add.zone(rect.x, rect.y, rect.width, rect.height);
      this.physics.add.existing(zone, true);
      furniture.add(zone);
    }
    this.physics.add.collider(this.player.sprite, furniture);
    this.interactions = new InteractionSystem(this, this.equipment, (id) => this.tryInteract(id));
    this.interactions.setInspected(this.inspectedIds);
    this.interactions.setReducedMotion(this.reducedMotion);

    if (this.input.keyboard) {
      this.keys = this.input.keyboard.addKeys(this.capturedKeys.join(','), false, false) as Record<string, Phaser.Input.Keyboard.Key>;
      // Listen to the event instead of polling JustDown: a quick press and
      // release can both arrive between two rendered frames.
      this.keys.E.on(Phaser.Input.Keyboard.Events.DOWN, this.onInteractKey);
    }
    window.addEventListener('blur', this.onWindowBlur);
    window.addEventListener('focus', this.onWindowFocus);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.cleanup, this);
    this.restartPending = false;
    this.game.canvas?.setAttribute('aria-label', `${this.level.location}. Двигайтесь WASD или стрелками; E — осмотреть ближайший объект.`);
    this.syncInputState();
    this.configureCamera();
    this.bridge.onReady();
  }

  update(time: number): void {
    if (!this.player || !this.interactions) return;
    let moving = false;
    if (this.isActive()) {
      const keyboardHorizontal = Number(this.keyDown('D') || this.keyDown('RIGHT') || this.touch.right)
        - Number(this.keyDown('A') || this.keyDown('LEFT') || this.touch.left);
      const keyboardVertical = Number(this.keyDown('S') || this.keyDown('DOWN') || this.touch.down)
        - Number(this.keyDown('W') || this.keyDown('UP') || this.touch.up);
      const hasDigitalInput = keyboardHorizontal !== 0 || keyboardVertical !== 0;
      const screenVector = capMovementVector(
        hasDigitalInput ? keyboardHorizontal : this.touchVector.x,
        hasDigitalInput ? keyboardVertical : this.touchVector.y,
      );
      const worldVector = screenDirectionToWorld(screenVector);
      moving = this.player.move(worldVector.x, worldVector.y);
      this.updateNearby();
    } else {
      this.player.stop();
    }
    this.player.animate(time, this.reducedMotion);
    this.interactions.animate(time, this.reducedMotion || !this.isActive());
    const quality = this.graphicsQuality === 'auto' ? (this.viewport.mobile ? 'medium' : 'high') : this.graphicsQuality;
    this.artwork?.update(time, this.isActive(), this.reducedMotion, quality);

    if ((moving && time - this.lastPositionTime >= 650) || (this.wasMoving && !moving)) {
      this.reportPosition();
      this.lastPositionTime = time;
    }
    this.wasMoving = moving;
  }

  setActive(active: boolean): void {
    this.requestedActive = active;
    if (active) {
      this.hasBeenActive = true;
      // The scanner records evidence while its panel is open. Show the room
      // feedback when the player closes that panel and can actually see it.
      for (const id of this.pendingFeedback) this.interactions?.showInspectionFeedback(id);
      this.pendingFeedback.clear();
    }
    this.clearControls();
    this.syncInputState();
    this.updateNearby();
    this.configureCamera();
  }

  setPlayerPosition(position: Point): void {
    this.pendingPosition = safePlayerPositionForLevel(position, this.level);
    if (!this.restartPending) this.player?.setPosition(this.pendingPosition);
    this.clearControls(!this.restartPending);
    this.reportPosition();
    this.updateNearby();
    this.configureCamera();
  }

  getPlayerPosition(): Point {
    return this.restartPending ? { ...this.pendingPosition } : this.player?.position() ?? { ...this.pendingPosition };
  }

  setLevel(level: CampaignCase): void {
    if (level.id === this.level.id) return;
    const needsRestart = Boolean(this.player) && !this.restartPending;
    this.clearControls(false);
    this.level = level;
    this.equipment = level.equipment;
    this.pendingPosition = safePlayerPositionForLevel(level.initialPosition, level);
    this.lastReportedPosition = { ...this.pendingPosition };
    this.inspectedIds = [];
    this.pendingFeedback.clear();
    this.hasBeenActive = false;
    this.nearbyId = null;
    this.energyPlan = null;
    this.campaignPlan = null;
    this.thermalView = false;
    this.lastPositionTime = 0;
    this.bridge.onNearby(null);
    if (needsRestart) {
      this.restartPending = true;
      this.scene.restart();
    }
  }

  getCurrentCaseId(): string {
    return this.level.id;
  }

  setThermalView(enabled: boolean): void {
    this.thermalView = enabled;
    this.applyThermalVisibility();
  }

  setInspected(ids: readonly string[]): void {
    // A continuation loads quietly; only evidence collected during play pulses.
    const newlyInspected = this.hasBeenActive ? ids.filter((id) => !this.inspectedIds.includes(id)) : [];
    this.inspectedIds = [...ids];
    this.interactions?.setInspected(ids);
    for (const id of this.pendingFeedback) if (!ids.includes(id)) this.pendingFeedback.delete(id);
    for (const id of newlyInspected) {
      if (this.isActive()) this.interactions?.showInspectionFeedback(id);
      else this.pendingFeedback.add(id);
    }
  }

  setTouchDirection(direction: Direction, pressed: boolean): void {
    this.touch[direction] = pressed && this.isActive();
  }

  setTouchVector(vector: Point): void {
    this.touchVector = this.isActive() ? capMovementVector(vector.x, vector.y) : { x: 0, y: 0 };
  }

  setViewport(width: number, height: number, mobile: boolean): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    this.viewport = { width, height, mobile };
    this.configureCamera();
  }

  changeZoom(delta: number): void {
    if (!Number.isFinite(delta)) return;
    const layout = calculateIsoCameraLayout({ ...this.viewport, zoomOffset: this.zoomOffset });
    const zoom = Math.max(layout.minZoom, Math.min(layout.maxZoom, layout.zoom + delta));
    this.zoomOffset = zoom - layout.baseZoom;
    this.configureCamera();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.interactions?.setReducedMotion(reduced);
    this.cameras?.main?.setLerp(reduced ? 1 : 0.12);
  }

  setGraphicsQuality(quality: 'auto' | 'low' | 'medium' | 'high'): void {
    this.graphicsQuality = quality;
  }

  setVirtualTime(hour: number): void {
    if (!Number.isFinite(hour)) return;
    this.virtualHour = ((hour % 24) + 24) % 24;
    this.artwork?.setTime(this.virtualHour);
  }

  setEnergyPlan(plan: EnergyPlan | null): void {
    this.energyPlan = plan ? { ...plan } : null;
    this.applyVisualPlan();
  }

  setCampaignPlan(plan: CampaignPlan | null): void {
    this.campaignPlan = plan ? structuredClone(plan) : null;
    this.applyVisualPlan();
  }

  interact(): void {
    if (!this.isActive() || !this.player || !this.interactions) return;
    const id = this.interactions.nearest(this.player.position());
    if (id) this.tryInteract(id);
  }

  private tryInteract(id: string): void {
    if (!this.isActive() || !this.player || !this.interactions?.inRange(id, this.player.position())) return;
    this.clearControls();
    const device = this.equipment.find((entry) => entry.id === id);
    if (device) this.player.faceTowards(device.position);
    this.player.setState('scan', 1400);
    this.bridge.onInteract(id);
  }

  private keyDown(key: string): boolean {
    return this.keys?.[key]?.isDown ?? false;
  }

  private isActive(): boolean {
    return this.requestedActive && this.browserFocused && !this.restartPending;
  }

  private updateNearby(): void {
    const next = this.isActive() && this.player && this.interactions
      ? this.interactions.nearest(this.player.position()) : null;
    this.interactions?.setNearby(next);
    if (next === this.nearbyId) return;
    this.nearbyId = next;
    this.bridge.onNearby(next);
  }

  private clearControls(report = true): void {
    for (const direction of Object.keys(this.touch) as Direction[]) this.touch[direction] = false;
    this.touchVector = { x: 0, y: 0 };
    this.input?.keyboard?.resetKeys();
    this.player?.stop();
    if (report) this.reportPosition();
    this.wasMoving = false;
  }

  private syncInputState(): void {
    if (!this.input?.keyboard) return;
    this.input.keyboard.enabled = this.isActive();
    if (this.isActive()) this.input.keyboard.addCapture(this.capturedKeys);
    else this.input.keyboard.removeCapture(this.capturedKeys);
  }

  private configureCamera(): void {
    if (!this.player || !this.cameras?.main) return;
    const layout = calculateIsoCameraLayout({ ...this.viewport, active: this.requestedActive, zoomOffset: this.zoomOffset });
    const camera = this.cameras.main;
    camera.setViewport(0, 0, layout.width, layout.height);
    camera.setBounds(layout.bounds.x, layout.bounds.y, layout.bounds.width, layout.bounds.height);
    camera.setZoom(layout.zoom);
    if (layout.followsPlayer) {
      camera.startFollow(this.player.visual, false, this.reducedMotion ? 1 : 0.12);
      camera.setFollowOffset(0, 35);
    } else {
      camera.stopFollow();
      camera.centerOn(layout.bounds.x + layout.bounds.width / 2, layout.bounds.y + layout.bounds.height / 2);
    }
  }

  private reportPosition(): void {
    if (!this.player || this.restartPending) return;
    const position = this.player.position();
    if (Math.hypot(position.x - this.lastReportedPosition.x, position.y - this.lastReportedPosition.y) < 0.5) return;
    this.lastReportedPosition = position;
    this.bridge.onPosition(position);
  }

  private readonly onWindowBlur = (): void => {
    this.browserFocused = false;
    this.clearControls();
    this.syncInputState();
    this.updateNearby();
  };

  private readonly onWindowFocus = (): void => {
    this.browserFocused = true;
    this.clearControls();
    this.syncInputState();
    this.updateNearby();
  };

  private readonly onInteractKey = (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent): void => {
    if (!event.repeat) this.interact();
  };

  private cleanup(): void {
    window.removeEventListener('blur', this.onWindowBlur);
    window.removeEventListener('focus', this.onWindowFocus);
    this.input?.keyboard?.removeCapture(this.capturedKeys);
    this.keys?.E.off(Phaser.Input.Keyboard.Events.DOWN, this.onInteractKey);
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.cleanup, this);
    this.artwork?.destroy();
    this.player = undefined;
    this.interactions = undefined;
    this.artwork = undefined;
    this.keys = undefined;
    this.wasMoving = false;
    this.touchVector = { x: 0, y: 0 };
  }

  private applyThermalVisibility(): void {
    this.artwork?.setThermalView(this.thermalView);
  }

  private applyVisualPlan(): void {
    if (!this.artwork) return;
    const plan = this.campaignPlan ?? (this.energyPlan && this.level.theme === 'lab' ? { kind: 'timeline' as const, ...this.energyPlan, daylight: false } : null);
    this.artwork.setPlan(plan);
    this.artwork.setTime(this.virtualHour);
  }
}
