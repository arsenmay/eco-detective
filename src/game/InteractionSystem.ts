import Phaser from 'phaser';
import type { Equipment, Point } from '../types';
import { worldToScreen } from '../rendering/projection';

export const INTERACTION_REACH = 99;

type DeviceMarker = {
  device: Equipment;
  halo: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Arc;
  number: Phaser.GameObjects.Text;
  caption: Phaser.GameObjects.Text;
  activeDot: Phaser.GameObjects.Arc;
};

/** The same reach check is used for the keyboard, touch button, and room markers. */
export class InteractionSystem {
  private readonly scene: Phaser.Scene;
  private readonly markers: DeviceMarker[];
  private inspected = new Set<string>();
  private nearbyId: string | null = null;
  private reducedMotion = false;
  private readonly feedback = new Set<Phaser.GameObjects.Arc>();

  constructor(scene: Phaser.Scene, equipment: readonly Equipment[], onClick: (id: string) => void) {
    this.scene = scene;
    this.markers = equipment.map((device, index) => {
      const { x, y } = worldToScreen(device.position, 54);
      const halo = scene.add.circle(x, y, 29, 0x49ead3, 0.09).setDepth(100039);
      const ring = scene.add.circle(x, y, 19, 0x10273b, 0.94)
        .setStrokeStyle(1, 0x54d7c5, 0.78).setDepth(100040);
      ring.setInteractive(new Phaser.Geom.Circle(19, 19, 25), Phaser.Geom.Circle.Contains);
      ring.on('pointerdown', () => onClick(device.id));
      const number = scene.add.text(x, y, String(index + 1).padStart(2, '0'), {
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: '13px', color: '#bcf9ec', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(100041);
      const caption = scene.add.text(x, y + 30, device.shortName, {
        fontFamily: 'Manrope, Arial, sans-serif', fontSize: '12px', color: '#b0c4d4',
        backgroundColor: '#101f30', padding: { x: 8, y: 4 },
      }).setOrigin(0.5, 0).setDepth(100042);
      const activeDot = scene.add.circle(x + 15, y - 14, 4, 0x9bffe8, 1)
        .setStrokeStyle(2, 0x0b2332).setDepth(100043).setVisible(false);
      return { device, halo, ring, number, caption, activeDot };
    });
  }

  nearest(position: Point): string | null {
    let nearest: string | null = null;
    let distance = INTERACTION_REACH;
    for (const { device } of this.markers) {
      const candidate = Phaser.Math.Distance.Between(position.x, position.y, device.position.x, device.position.y);
      if (candidate <= distance) {
        distance = candidate;
        nearest = device.id;
      }
    }
    return nearest;
  }

  inRange(id: string, position: Point): boolean {
    const marker = this.markers.find(({ device }) => device.id === id);
    return !!marker && Phaser.Math.Distance.Between(
      position.x, position.y, marker.device.position.x, marker.device.position.y,
    ) <= INTERACTION_REACH;
  }

  setNearby(id: string | null): void {
    if (id === this.nearbyId) return;
    this.nearbyId = id;
    this.refresh();
  }

  setInspected(ids: readonly string[]): void {
    this.inspected = new Set(ids);
    this.refresh();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (!reduced) return;
    for (const pulse of this.feedback) {
      this.scene.tweens.killTweensOf(pulse);
      pulse.destroy();
    }
    this.feedback.clear();
  }

  showInspectionFeedback(id: string): void {
    const marker = this.markers.find(({ device }) => device.id === id);
    if (!marker || this.reducedMotion) return;
    const projected = worldToScreen(marker.device.position, 54);
    const pulse = this.scene.add.circle(projected.x, projected.y, 20)
      .setStrokeStyle(2, 0x83ffd1, 0.85).setDepth(100044);
    this.feedback.add(pulse);
    this.scene.tweens.add({
      targets: pulse, scale: 2.8, alpha: 0, duration: 1000, ease: 'Cubic.Out',
      onComplete: () => { this.feedback.delete(pulse); pulse.destroy(); },
    });
  }

  animate(time: number, reducedMotion: boolean): void {
    for (const marker of this.markers) {
      const nearby = marker.device.id === this.nearbyId;
      marker.halo.setAlpha(nearby ? (reducedMotion ? 1 : 0.76 + Math.sin(time / 260) * 0.24) : 0.5);
      marker.ring.setScale(nearby && !reducedMotion ? 1 + Math.sin(time / 400) * 0.025 : 1);
    }
  }

  private refresh(): void {
    this.markers.forEach((marker, index) => {
      const inspected = this.inspected.has(marker.device.id);
      const nearby = marker.device.id === this.nearbyId;
      const color = inspected ? 0x67e2a3 : nearby ? 0x8effec : 0x54d7c5;
      marker.ring.setFillStyle(nearby ? 0x1b4b55 : 0x10273b, 0.98);
      marker.ring.setStrokeStyle(nearby ? 2 : 1, color, nearby ? 1 : 0.7);
      marker.number.setText(inspected ? '✓' : String(index + 1).padStart(2, '0'));
      marker.number.setColor(inspected ? '#82f1b2' : '#c1fff0');
      marker.caption.setColor(nearby ? '#effffb' : inspected ? '#9cd6b4' : '#b0c4d4');
      marker.caption.setText(nearby ? `${marker.device.shortName} · ОСМОТР` : marker.device.shortName);
      marker.caption.setVisible(nearby);
      marker.activeDot.setVisible(nearby);
      marker.halo.setFillStyle(color, nearby ? 0.12 : 0.08);
    });
  }
}
