import Phaser from 'phaser';
import type { Equipment, GameBridge, Point } from '../types';
import { InteractionSystem } from './InteractionSystem';
import { Player } from './Player';
import { drawRoom, FURNITURE, ROOM_BOUNDS, safePlayerPosition, SPAWN } from './roomArtwork';

type Direction = 'up' | 'down' | 'left' | 'right';

/** A single fictional room. UI and persistence stay outside the Phaser scene. */
export class RoomScene extends Phaser.Scene {
  private readonly equipment: readonly Equipment[];
  private readonly bridge: GameBridge;
  private player?: Player;
  private interactions?: InteractionSystem;
  private keys?: Record<string, Phaser.Input.Keyboard.Key>;
  private lighting?: Phaser.GameObjects.Image;
  private requestedActive = false;
  private browserFocused = true;
  private reducedMotion = false;
  private inspectedIds: readonly string[] = [];
  private pendingPosition: Point = { ...SPAWN };
  private nearbyId: string | null = null;
  private lastReportedPosition: Point = { ...SPAWN };
  private lastPositionTime = 0;
  private wasMoving = false;
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
    this.lighting = drawRoom(this);
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
    this.bridge.onReady();
  }

  update(time: number): void {
    if (!this.player || !this.interactions) return;
    let moving = false;
    if (this.isActive()) {
      const horizontal = Number(this.keyDown('D') || this.keyDown('RIGHT') || this.touch.right)
        - Number(this.keyDown('A') || this.keyDown('LEFT') || this.touch.left);
      const vertical = Number(this.keyDown('S') || this.keyDown('DOWN') || this.touch.down)
        - Number(this.keyDown('W') || this.keyDown('UP') || this.touch.up);
      moving = this.player.move(horizontal, vertical);
      this.updateNearby();
    } else {
      this.player.stop();
    }
    this.player.animate(time, this.reducedMotion);
    this.interactions.animate(time, this.reducedMotion);
    this.lighting?.setAlpha(this.reducedMotion ? 1 : 0.95 + Math.sin(time / 1500) * 0.05);

    if ((moving && time - this.lastPositionTime >= 650) || (this.wasMoving && !moving)) {
      this.reportPosition();
      this.lastPositionTime = time;
    }
    this.wasMoving = moving;
  }

  setActive(active: boolean): void {
    this.requestedActive = active;
    this.clearControls();
    this.syncInputState();
    this.updateNearby();
  }

  setPlayerPosition(position: Point): void {
    this.pendingPosition = safePlayerPosition(position);
    this.player?.setPosition(this.pendingPosition);
    this.clearControls();
    this.reportPosition();
    this.updateNearby();
  }

  getPlayerPosition(): Point {
    return this.player?.position() ?? { ...this.pendingPosition };
  }

  setInspected(ids: readonly string[]): void {
    this.inspectedIds = [...ids];
    this.interactions?.setInspected(ids);
  }

  setTouchDirection(direction: Direction, pressed: boolean): void {
    this.touch[direction] = pressed && this.isActive();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
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
