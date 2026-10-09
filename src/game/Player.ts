import Phaser from 'phaser';
import type { Point } from '../types';
import { capMovementVector } from './cameraLayout';

export const PLAYER_SPEED = 184;

/** A small top-down investigator; all artwork is generated locally. */
export class Player {
  readonly sprite: Phaser.Physics.Arcade.Image;
  private readonly halo: Phaser.GameObjects.Arc;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private moving = false;

  constructor(scene: Phaser.Scene, position: Point) {
    if (!scene.textures.exists('investigator')) {
      const art = scene.make.graphics({ x: 0, y: 0 });
      art.fillStyle(0x0b1724);
      art.fillRoundedRect(18, 34, 10, 17, 4);
      art.fillRoundedRect(32, 34, 10, 17, 4);
      art.fillStyle(0x101f30);
      art.fillRoundedRect(17, 43, 12, 10, 3);
      art.fillRoundedRect(31, 43, 12, 10, 3);
      art.fillStyle(0x247d94);
      art.fillRoundedRect(13, 25, 34, 17, 7);
      art.fillStyle(0x47c6ca);
      art.fillRoundedRect(20, 24, 20, 21, 6);
      art.fillStyle(0x276e86);
      art.fillRoundedRect(25, 28, 10, 17, 3);
      art.lineStyle(1, 0x175268, 0.9);
      art.lineBetween(30, 28, 30, 44);
      art.fillStyle(0xe9d69a);
      art.fillRoundedRect(22, 31, 5, 6, 1);
      art.fillStyle(0x162c3d);
      art.fillRoundedRect(39, 35, 11, 13, 2);
      art.fillStyle(0x82e9d5);
      art.fillRoundedRect(41, 37, 7, 8, 1);
      art.fillStyle(0x92e5da);
      art.fillRoundedRect(14, 27, 5, 10, 2);
      art.fillRoundedRect(41, 27, 5, 10, 2);
      art.fillStyle(0xf0c29e);
      art.fillCircle(30, 20, 10);
      art.fillStyle(0x243149);
      art.fillCircle(30, 17, 11);
      art.fillStyle(0x324966);
      art.fillEllipse(29, 13, 16, 10);
      art.fillStyle(0x81fff0);
      art.fillRoundedRect(18, 15, 4, 10, 2);
      art.fillRoundedRect(38, 15, 4, 10, 2);
      art.lineStyle(2, 0xadfff1, 0.6);
      art.lineBetween(22, 28, 22, 37);
      art.generateTexture('investigator', 60, 60);
      art.destroy();
    }

    this.shadow = scene.add.ellipse(position.x, position.y + 8, 36, 20, 0x030a14, 0.5).setDepth(24);
    this.halo = scene.add.circle(position.x, position.y, 26, 0x3ce5d0, 0.075)
      .setStrokeStyle(1, 0x58f0de, 0.28).setDepth(25);
    this.sprite = scene.physics.add.image(position.x, position.y, 'investigator').setDepth(55);
    this.sprite.setCircle(12, 18, 18);
    this.sprite.setCollideWorldBounds(true);
    this.sprite.setMaxVelocity(PLAYER_SPEED);
    this.sprite.setDamping(false);
    this.sprite.setRotation(Math.PI);
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
    this.sprite.setRotation(Math.atan2(vy, vx) + Math.PI / 2);
    return true;
  }

  stop(): void {
    this.moving = false;
    this.sprite.setVelocity(0, 0);
  }

  animate(time: number, reducedMotion: boolean): void {
    this.halo.setPosition(this.sprite.x, this.sprite.y);
    this.shadow.setPosition(this.sprite.x, this.sprite.y + 8);
    this.halo.setAlpha(reducedMotion ? 1 : 0.8 + Math.sin(time / 500) * 0.2);
    const bob = !reducedMotion && this.moving ? 1 + Math.sin(time / 70) * 0.018 : 1;
    this.sprite.setScale(bob);
  }

  position(): Point {
    return { x: this.sprite.x, y: this.sprite.y };
  }

  setPosition(position: Point): void {
    this.stop();
    this.sprite.setPosition(position.x, position.y);
    this.sprite.body?.reset(position.x, position.y);
    this.halo.setPosition(position.x, position.y);
    this.shadow.setPosition(position.x, position.y + 8);
  }
}
