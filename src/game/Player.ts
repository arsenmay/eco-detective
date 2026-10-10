import Phaser from 'phaser';
import type { Point } from '../types';
import { capMovementVector } from './cameraLayout';
import { createDetectiveArtwork, type DetectiveArtwork } from '../rendering/DetectiveArtwork';
import { facingFromScreenVector, getDetectivePose, type DetectiveFacing, type DetectiveState } from '../rendering/detectivePose';
import { getDepth, worldDirectionToScreen, worldToScreen } from '../rendering/projection';

export type { DetectiveState } from '../rendering/detectivePose';

export const PLAYER_SPEED = 184;

/** Logical Arcade physics and an independent upright, projected detective. */
export class Player {
  readonly sprite: Phaser.Physics.Arcade.Image;
  readonly visual: Phaser.GameObjects.Container;
  private readonly artwork: DetectiveArtwork;
  private moving = false;
  private facing: DetectiveFacing = 'front';
  private requestedState: DetectiveState | null = null;
  private stateEndsAt = Infinity;

  constructor(private readonly scene: Phaser.Scene, position: Point) {
    // Keeping this 60 px frame, circle and origin preserves every logical
    // collision and saved coordinate from previous versions of the game.
    const bodyTexture = 'eco-detective-logical-body';
    if (!scene.textures.exists(bodyTexture)) {
      scene.textures.createCanvas(bodyTexture, 60, 60)?.refresh();
    }
    this.sprite = scene.physics.add.image(position.x, position.y, bodyTexture).setVisible(false);
    this.sprite.setCircle(12, 18, 18);
    this.sprite.setCollideWorldBounds(true);
    this.sprite.setMaxVelocity(PLAYER_SPEED);
    this.sprite.setDamping(false);
    this.artwork = createDetectiveArtwork(scene);
    this.visual = this.artwork.visual;
    this.animate(scene.time.now, false);
  }

  move(horizontal: number, vertical: number): boolean {
    const vector = capMovementVector(horizontal, vertical);
    const length = Math.hypot(vector.x, vector.y);
    this.moving = length > 0;
    if (!this.moving) {
      this.sprite.setVelocity(0, 0);
      return false;
    }
    const vx = vector.x * PLAYER_SPEED;
    const vy = vector.y * PLAYER_SPEED;
    this.sprite.setVelocity(vx, vy);
    const direction = worldDirectionToScreen(vector);
    this.facing = facingFromScreenVector(direction.x, direction.y, this.facing);
    return true;
  }

  stop(): void {
    this.moving = false;
    this.sprite.setVelocity(0, 0);
  }

  animate(time: number, reducedMotion: boolean): void {
    if (this.requestedState && time >= this.stateEndsAt) this.requestedState = null;
    const position = this.position();
    const screen = worldToScreen(position);
    this.visual.setPosition(screen.x, screen.y).setDepth(getDepth(position, 5));
    this.artwork.update(this.facing, getDetectivePose(time, this.moving, reducedMotion, this.state), time, reducedMotion);
  }

  get state(): DetectiveState {
    return this.requestedState ?? (this.moving ? 'walk' : 'idle');
  }

  /** One-shot poses expire automatically; scan is retained until idle is set. */
  setState(state: DetectiveState, durationMs?: number): void {
    if (state === 'idle' || state === 'walk') {
      this.requestedState = null;
      this.stateEndsAt = Infinity;
      return;
    }
    const defaultDuration = state === 'interact' ? 550 : state === 'inspect' ? 950 : state === 'success' ? 1400 : Infinity;
    const duration = durationMs !== undefined && Number.isFinite(durationMs) ? Math.max(0, durationMs) : defaultDuration;
    this.requestedState = state;
    this.stateEndsAt = this.scene.time.now + duration;
  }

  /** Useful for looking at a device while retaining logical interaction range. */
  faceTowards(target: Point): void {
    const direction = worldDirectionToScreen({ x: target.x - this.sprite.x, y: target.y - this.sprite.y });
    this.facing = facingFromScreenVector(direction.x, direction.y, this.facing);
  }

  position(): Point {
    return { x: this.sprite.x, y: this.sprite.y };
  }

  setPosition(position: Point): void {
    this.stop();
    this.sprite.setPosition(position.x, position.y);
    this.sprite.body?.reset(position.x, position.y);
    this.animate(this.scene.time.now, false);
  }
}
