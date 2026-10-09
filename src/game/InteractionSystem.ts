import Phaser from 'phaser';
import type { Equipment, Point } from '../types';

export const INTERACTION_REACH = 99;

type DeviceMarker = {
  device: Equipment;
  halo: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Arc;
  number: Phaser.GameObjects.Text;
  caption: Phaser.GameObjects.Text;
};

/** The same reach check is used for the keyboard, touch button, and room markers. */
export class InteractionSystem {
  private readonly markers: DeviceMarker[];
  private inspected = new Set<string>();
  private nearbyId: string | null = null;

  constructor(scene: Phaser.Scene, equipment: readonly Equipment[], onClick: (id: string) => void) {
    this.markers = equipment.map((device, index) => {
      const { x, y } = device.position;
      const halo = scene.add.circle(x, y, 35, 0x49ead3, 0.09).setDepth(39);
      const ring = scene.add.circle(x, y, 19, 0x10273b, 0.94)
        .setStrokeStyle(1, 0x54d7c5, 0.78).setDepth(40);
      ring.setInteractive(new Phaser.Geom.Circle(19, 19, 25), Phaser.Geom.Circle.Contains);
      ring.on('pointerdown', () => onClick(device.id));
      const number = scene.add.text(x, y, String(index + 1).padStart(2, '0'), {
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: '13px', color: '#bcf9ec', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(41);
      const caption = scene.add.text(x, y + 30, device.shortName, {
        fontFamily: 'Manrope, Arial, sans-serif', fontSize: '12px', color: '#b0c4d4',
        backgroundColor: '#101f30', padding: { x: 8, y: 4 },
      }).setOrigin(0.5, 0).setDepth(42);
      return { device, halo, ring, number, caption };
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

  animate(time: number, reducedMotion: boolean): void {
    for (const marker of this.markers) {
      const nearby = marker.device.id === this.nearbyId;
      marker.halo.setAlpha(nearby ? (reducedMotion ? 1 : 0.76 + Math.sin(time / 260) * 0.24) : 0.5);
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
      marker.halo.setFillStyle(color, nearby ? 0.12 : 0.08);
    });
  }
}
