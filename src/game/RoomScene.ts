import Phaser from 'phaser';
import type { EnergyPlan, Equipment, GameBridge, Point } from '../types';
import { InteractionSystem } from './InteractionSystem';
import { Player } from './Player';
import { calculateCameraLayout, capMovementVector } from './cameraLayout';
import { applyRoomEnergyPlan, drawRoom, FURNITURE, ROOM_BOUNDS, safePlayerPosition, SPAWN, WORLD_HEIGHT, WORLD_WIDTH, type RoomArtwork } from './roomArtwork';

type Direction = 'up' | 'down' | 'left' | 'right';

/** A single fictional room. UI and persistence stay outside the Phaser scene. */
export class RoomScene extends Phaser.Scene {
  private readonly equipment: readonly Equipment[];
  private readonly bridge: GameBridge;
  private player?: Player;
  private interactions?: InteractionSystem;
  private keys?: Record<string, Phaser.Input.Keyboard.Key>;
  private artwork?: RoomArtwork;
  private energyPlan: EnergyPlan | null = null;
  private requestedActive = false;
  private hasBeenActive = false;
  private readonly pendingFeedback = new Set<string>();
  private browserFocused = true;
  private reducedMotion = false;
  private inspectedIds: readonly string[] = [];
  private pendingPosition: Point = { ...SPAWN };
  private nearbyId: string | null = null;
  private lastReportedPosition: Point = { ...SPAWN };
  private lastPositionTime = 0;
  private wasMoving = false;
  private touchVector: Point = { x: 0, y: 0 };
  private viewport = { width: WORLD_WIDTH, height: WORLD_HEIGHT, mobile: false };
  private zoomOffset = 0;
  private readonly touch: Record<Direction, boolean> = { up: false, down: false, left: false, right: false };
  private readonly capturedKeys = ['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'E'];

  constructor(equipment: readonly Equipment[], bridge: GameBridge) {
    super({ key: 'ComputerLab' });
    this.equipment = equipment;
    this.bridge = bridge;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#070f1c');
    this.physics.world.setBounds(ROOM_BOUNDS.x, ROOM_BOUNDS.y, ROOM_BOUNDS.width, ROOM_BOUNDS.height);
    this.artwork = drawRoom(this);
    applyRoomEnergyPlan(this.artwork, this.energyPlan);
    this.pendingPosition = safePlayerPosition(this.pendingPosition);
    this.player = new Player(this, this.pendingPosition);

    const furniture = this.physics.add.staticGroup();
    for (const rect of FURNITURE) {
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
      moving = this.player.move(
        hasDigitalInput ? keyboardHorizontal : this.touchVector.x,
        hasDigitalInput ? keyboardVertical : this.touchVector.y,
      );
      this.updateNearby();
    } else {
      this.player.stop();
    }
    this.player.animate(time, this.reducedMotion);
    this.interactions.animate(time, this.reducedMotion || !this.isActive());
    if (this.artwork) {
      const lightLevel = this.energyPlan ? 0.48 + this.energyPlan.lightingHours / 8 * 0.52 : 1;
      this.artwork.lighting.setAlpha(lightLevel * (this.reducedMotion || !this.isActive() ? 1 : 0.97 + Math.sin(time / 1500) * 0.03));
      this.artwork.scanningLine.setVisible(!this.reducedMotion && this.isActive());
      this.artwork.scanningLine.setY(126 + (time % 12000) / 12000 * 548);
    }

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
    this.pendingPosition = safePlayerPosition(position);
    this.player?.setPosition(this.pendingPosition);
    this.clearControls();
    this.reportPosition();
    this.updateNearby();
    this.configureCamera();
  }

  getPlayerPosition(): Point {
    return this.player?.position() ?? { ...this.pendingPosition };
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
    const layout = calculateCameraLayout({ ...this.viewport, zoomOffset: this.zoomOffset });
    const zoom = Math.max(layout.minZoom, Math.min(layout.maxZoom, layout.zoom + delta));
    this.zoomOffset = zoom - (this.viewport.mobile ? 1 : layout.fitZoom);
    this.configureCamera();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.interactions?.setReducedMotion(reduced);
    this.cameras?.main?.setLerp(reduced ? 1 : 0.12);
  }

  setEnergyPlan(plan: EnergyPlan | null): void {
    this.energyPlan = plan ? { ...plan } : null;
    if (this.artwork) applyRoomEnergyPlan(this.artwork, this.energyPlan);
  }

  interact(): void {
    if (!this.isActive() || !this.player || !this.interactions) return;
    const id = this.interactions.nearest(this.player.position());
    if (id) this.tryInteract(id);
  }

  private tryInteract(id: string): void {
    if (!this.isActive() || !this.player || !this.interactions?.inRange(id, this.player.position())) return;
    this.clearControls();
    this.bridge.onInteract(id);
  }

  private keyDown(key: string): boolean {
    return this.keys?.[key]?.isDown ?? false;
  }

  private isActive(): boolean {
    return this.requestedActive && this.browserFocused;
  }

  private updateNearby(): void {
    const next = this.isActive() && this.player && this.interactions
      ? this.interactions.nearest(this.player.position()) : null;
    this.interactions?.setNearby(next);
    if (next === this.nearbyId) return;
    this.nearbyId = next;
    this.bridge.onNearby(next);
  }

  private clearControls(): void {
    for (const direction of Object.keys(this.touch) as Direction[]) this.touch[direction] = false;
    this.touchVector = { x: 0, y: 0 };
    this.input?.keyboard?.resetKeys();
    this.player?.stop();
    this.reportPosition();
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
    const layout = calculateCameraLayout({ ...this.viewport, active: this.requestedActive, zoomOffset: this.zoomOffset });
    const camera = this.cameras.main;
    camera.setViewport(0, 0, layout.width, layout.height);
    camera.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    camera.setZoom(layout.zoom);
    if (layout.followsPlayer) {
      camera.startFollow(this.player.sprite, false, this.reducedMotion ? 1 : 0.12);
    } else {
      camera.stopFollow();
      camera.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    }
  }

  private reportPosition(): void {
    if (!this.player) return;
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
  }
}
