import Phaser from 'phaser';
import type { CampaignCase, CampaignPlan, Rect } from '../campaign/types';
import type { Equipment, Point } from '../types';
import { getDepth, worldToScreen } from './projection';

export type RenderQuality = 'low' | 'medium' | 'high';
type Fixture = CampaignCase['room']['furniture'][number];
type Palette = { floor: number; tile: number; wall: number; wallEdge: number; accent: number; wood: number; trim: number };
type Material = { top: number; left: number; right: number; edge?: number };
type Surface = { graphics: Phaser.GameObjects.Graphics; point: (x: number, y: number, z?: number) => Point };
type LightSource = { object: Phaser.GameObjects.Graphics; kind: 'window' | 'ceiling' | 'screen'; equipmentId?: string; baseAlpha: number };
type DustParticle = { image: Phaser.GameObjects.Image; x: number; y: number; phase: number };

const PALETTES: Record<CampaignCase['theme'], Palette> = {
  lab: { floor: 0x26394c, tile: 0x2b4053, wall: 0x334a5e, wallEdge: 0x76909c, accent: 0x60e0d0, wood: 0x8f7762, trim: 0xadc4c8 },
  hall: { floor: 0x344553, tile: 0x3b5060, wall: 0x45596a, wallEdge: 0x91a5ad, accent: 0x8ddabe, wood: 0x92785d, trim: 0xc3d4ce },
  kitchen: { floor: 0x3d5051, tile: 0x475b5a, wall: 0x617273, wallEdge: 0xa7b7b2, accent: 0x99dcba, wood: 0xb09773, trim: 0xd3e0da },
  thermal: { floor: 0x344356, tile: 0x3b4e60, wall: 0x536075, wallEdge: 0x9aa7b8, accent: 0xf0bf83, wood: 0xa07c55, trim: 0xd4cbb9 },
  school: { floor: 0x2d3c55, tile: 0x354662, wall: 0x3e4f6b, wallEdge: 0x829bb3, accent: 0x9bbcf1, wood: 0x987c66, trim: 0xb6c8d2 },
};
const METAL: Material = { top: 0xb9c6c5, left: 0x6d818a, right: 0x8da2a7, edge: 0xd9e3df };
const DARK: Material = { top: 0x415769, left: 0x203647, right: 0x2f4758, edge: 0x69808c };

/** Original dimetric art: cached prop textures and independent depth anchors. */
export class RoomRenderer {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly lights: LightSource[] = [];
  private readonly thermal: Phaser.GameObjects.Container;
  private readonly detailEffects: Phaser.GameObjects.Graphics[] = [];
  private readonly dust: DustParticle[] = [];
  private plan: CampaignPlan | null = null;
  private hour = 10;
  private quality: RenderQuality = 'high';
  private readonly palette: Palette;
  private readonly ambient: Phaser.GameObjects.Graphics;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly level: CampaignCase) {
    this.palette = PALETTES[level.theme];
    this.drawFloor();
    this.drawBackWalls();
    this.drawFloorDetails();
    for (const fixture of level.room.furniture) this.drawFixture(fixture);
    this.drawRoomEquipment();
    this.createDust();
    this.drawDoorsAndSigns();
    this.ambient = this.addGraphics(-8);
    this.drawAmbientVeil();
    this.thermal = scene.add.container(0, 0).setDepth(26000).setVisible(false);
    this.objects.push(this.thermal);
    this.drawThermalOverlay();
    this.refreshLighting();
  }

  update(time: number, active: boolean, reducedMotion: boolean, quality: RenderQuality = this.quality): void {
    if (this.destroyed) return;
    if (quality !== this.quality) {
      this.quality = quality;
      for (const effect of this.detailEffects) effect.setVisible(quality === 'high');
      for (const source of this.lights) source.object.setVisible(quality !== 'low' || source.kind !== 'screen');
    }
    const breathing = active && !reducedMotion && quality === 'high' ? 0.98 + Math.sin(time / 1900) * 0.02 : 1;
    for (const source of this.lights) source.object.setAlpha(source.baseAlpha * breathing);
    for (const particle of this.dust) {
      const visible = active && !reducedMotion && quality === 'high' && this.hour >= 7 && this.hour <= 17;
      particle.image.setVisible(visible);
      if (visible) {
        const drift = (time / 150 + particle.phase) % 42;
        particle.image.setPosition(particle.x + Math.sin(time / 4500 + particle.phase) * 7, particle.y - drift);
        particle.image.setAlpha(0.12 * Math.sin(drift / 42 * Math.PI));
      }
    }
  }
  setPlan(plan: CampaignPlan | null): void {
    this.plan = plan ? structuredClone(plan) : null;
    this.refreshLighting();
  }
  setThermalView(enabled: boolean): void {
    this.thermal.setVisible(enabled && (this.level.theme === 'thermal' || this.level.theme === 'school'));
  }
  /** Visual simulation hour, separate from real player session duration. */
  setTime(hour: number): void {
    if (!Number.isFinite(hour)) return;
    this.hour = ((hour % 24) + 24) % 24;
    this.refreshLighting();
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const object of this.objects) if (object.scene) object.destroy();
    this.objects.length = 0;
    this.lights.length = 0;
    this.detailEffects.length = 0;
    this.dust.length = 0;
  }
  private addGraphics(depth: number): Phaser.GameObjects.Graphics {
    const object = this.scene.add.graphics().setDepth(depth);
    this.objects.push(object);
    return object;
  }
  private addText(point: Point, value: string, size: number, color: string, depth = -10): Phaser.GameObjects.Text {
    const p = worldToScreen(point);
    const text = this.scene.add.text(p.x, p.y, value, {
      fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: `${size}px`, color,
      letterSpacing: 1, fontStyle: 'bold', stroke: '#162735', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(depth).setAlpha(0.7);
    this.objects.push(text);
    return text;
  }
  private drawFloor(): void {
    const { bounds } = this.level.room;
    const s = worldSurface(this.addGraphics(-100));
    for (let i = 4; i >= 0; i -= 1) quad(s, bounds.x - 10 - i * 5, bounds.y - 10 - i * 5, bounds.width + 20 + i * 10, bounds.height + 20 + i * 10, -11 - i * 2, 0x030a16, 0.07 + (4 - i) * 0.04);
    box(s, bounds.x - 9, bounds.y - 9, bounds.width + 18, bounds.height + 18, -10, 10, { top: 0x59697a, left: 0x192a3c, right: 0x2b3c50, edge: 0x637783 });
    quad(s, bounds.x, bounds.y, bounds.width, bounds.height, 0, this.palette.floor);
    const tile = 48;
    let row = 0;
    for (let y = bounds.y; y < bounds.y + bounds.height; y += tile, row += 1) {
      let column = 0;
      for (let x = bounds.x; x < bounds.x + bounds.width; x += tile, column += 1) {
        const w = Math.min(tile, bounds.x + bounds.width - x), h = Math.min(tile, bounds.y + bounds.height - y);
        quad(s, x + 0.7, y + 0.7, w - 1.4, h - 1.4, 0.1, (row + column) % 2 ? this.palette.tile : this.palette.floor, 0.94);
      }
    }
    for (let x = bounds.x; x <= bounds.x + bounds.width; x += tile) line(s, x, bounds.y, 0.2, x, bounds.y + bounds.height, 0.2, 0x91a6b6, 1, 0.055);
    for (let y = bounds.y; y <= bounds.y + bounds.height; y += tile) line(s, bounds.x, y, 0.2, bounds.x + bounds.width, y, 0.2, 0x91a6b6, 1, 0.055);
  }
  private drawBackWalls(): void {
    const b = this.level.room.bounds;
    const s = worldSurface(this.addGraphics(getDepth({ x: b.x, y: b.y }, -70)));
    const height = 76;
    verticalX(s, b.x - 3, b.y, b.height, 0, height, this.palette.wall, 1);
    verticalY(s, b.x, b.y - 3, b.width, 0, height, shade(this.palette.wall, 1.14), 1);
    verticalX(s, b.x - 3, b.y, b.height, 0, 7, 0x253a4d, 1);
    verticalY(s, b.x, b.y - 3, b.width, 0, 7, 0x31475b, 1);
    line(s, b.x - 3, b.y, height, b.x - 3, b.y + b.height, height, this.palette.wallEdge, 3, 0.7);
    line(s, b.x, b.y - 3, height, b.x + b.width, b.y - 3, height, this.palette.wallEdge, 3, 0.75);
    line(s, b.x, b.y - 3, 8, b.x + b.width, b.y - 3, 8, this.palette.accent, 1, 0.22);
    line(s, b.x - 3, b.y, 8, b.x - 3, b.y + b.height, 8, this.palette.accent, 1, 0.22);
    const rim = worldSurface(this.addGraphics(-80));
    line(rim, b.x, b.y + b.height, 2, b.x + b.width, b.y + b.height, 2, this.palette.wallEdge, 3, 0.8);
    line(rim, b.x + b.width, b.y, 2, b.x + b.width, b.y + b.height, 2, this.palette.wallEdge, 3, 0.8);
    for (let i = 0; i < (this.level.theme === 'kitchen' ? 2 : 3); i += 1) this.drawWindow(b.x - 2, b.y + 85 + i * 155, 92, 22, 46);
    const posterX = b.x + 250;
    verticalY(s, posterX, b.y - 2, 48, 25, 31, 0x1e3544, 1);
    verticalY(s, posterX + 3, b.y - 1, 42, 28, 25, 0xd9d5bb, 0.92);
    line(s, posterX + 9, b.y, 45, posterX + 32, b.y, 45, this.palette.accent, 3, 0.85);
    for (let i = 0; i < 3; i += 1) line(s, posterX + 9, b.y, 39 - i * 4, posterX + 35, b.y, 39 - i * 4, 0x69867a, 1, 0.8);
  }
  private drawWindow(x: number, y: number, width: number, bottom: number, height: number): void {
    const s = worldSurface(this.addGraphics(getDepth({ x, y }, -60)));
    verticalX(s, x, y - width / 2 - 4, width + 8, bottom - 4, height + 8, 0x122638, 1);
    verticalX(s, x + 1, y - width / 2, width, bottom, height, 0x74a9bd, 1);
    verticalX(s, x + 2, y - width / 2 + 3, width - 6, bottom + 3, height - 6, 0xbbd5dc, 0.82);
    verticalX(s, x + 3, y - width / 2 + 4, width - 8, bottom + 4, height * 0.32, 0x87b1bb, 0.6);
    line(s, x + 4, y, bottom, x + 4, y, bottom + height, 0xe1e8df, 3, 0.9);
    line(s, x + 4, y - width / 2, bottom + height * 0.57, x + 4, y + width / 2, bottom + height * 0.57, 0xe1e8df, 3, 0.9);
    box(s, x - 2, y - width / 2 - 5, 11, width + 10, bottom - 4, 4, { top: 0xb6c3bc, left: 0x607987, right: 0x829b9f });
    const pool = this.addGraphics(-60), p = worldSurface(pool);
    for (let layer = 0; layer < 5; layer += 1) {
      const reach = 172 - layer * 21;
      polygon(p, [[x + 8, y - width / 2, 0.6], [x + 8, y + width / 2, 0.6], [x + reach, y + width / 2 + 85, 0.6], [x + reach, y - width / 2 + 85, 0.6]], 0xffecc4, 0.026);
    }
    this.lights.push({ object: pool, kind: 'window', baseAlpha: 1 });
  }
  private drawFloorDetails(): void {
    const s = worldSurface(this.addGraphics(-70));
    const colors = [this.palette.accent, 0xa9bfe4, 0xd9af7b, 0x8ecb9a];
    this.level.room.zones.forEach((zone, i) => {
      if (/спорт/i.test(zone.name)) {
        quad(s, zone.x + 5, zone.y + 5, zone.width - 10, zone.height - 10, 0.3, 0x957350, 0.48);
        for (let y = zone.y + 5; y < zone.y + zone.height - 5; y += 15) line(s, zone.x + 5, y, 0.4, zone.x + zone.width - 5, y, 0.4, 0xd6bb94, 1, 0.15);
        this.drawSportsCourt(s, zone);
      } else quad(s, zone.x + 5, zone.y + 5, zone.width - 10, zone.height - 10, 0.3, colors[i % colors.length], 0.032);
      this.addText({ x: zone.x + zone.width / 2, y: zone.y + zone.height - 16 }, zone.name.split(' · ')[0].toLocaleUpperCase('ru-RU'), 8, '#8ea9b8', -50).setAlpha(0.48);
    });
    if (this.level.theme === 'hall') {
      const b = this.level.room.bounds;
      for (let x = b.x + 95; x < b.x + b.width - 45; x += 34) line(s, x, b.y + b.height * 0.61, 0.4, x + 14, b.y + b.height * 0.61, 0.4, 0x8adebc, 2, 0.3);
    }
  }
  private drawSportsCourt(s: Surface, zone: Rect): void {
    const x = zone.x + 24, y = zone.y + 24, w = zone.width - 48, h = zone.height - 48;
    if (w <= 0 || h <= 0) return;
    outlineQuad(s, x, y, w, h, 0.5, 0xf0dfb9, 1.5, 0.55);
    line(s, x + w / 2, y, 0.5, x + w / 2, y + h, 0.5, 0xf0dfb9, 1.5, 0.55);
    const points: [number, number, number][] = [];
    for (let i = 0; i <= 32; i += 1) { const angle = i / 32 * Math.PI * 2; points.push([x + w / 2 + Math.cos(angle) * 25, y + h / 2 + Math.sin(angle) * 25, 0.6]); }
    polyline(s, points, 0xf0dfb9, 1.5, 0.5);
    outlineQuad(s, x, y + h / 2 - 26, 35, 52, 0.6, 0xf0dfb9, 1.5, 0.5);
    outlineQuad(s, x + w - 35, y + h / 2 - 26, 35, 52, 0.6, 0xf0dfb9, 1.5, 0.5);
  }
  private drawFixture(fixture: Fixture): void {
    if (fixture.kind === 'partition') {
      const alongX = fixture.width > fixture.height, length = alongX ? fixture.width : fixture.height, segments = Math.ceil(length / 36);
      for (let i = 0; i < segments; i += 1) {
        const size = length / segments;
        this.drawFixtureImage({ ...fixture, x: fixture.x + (alongX ? -length / 2 + size * (i + 0.5) : 0), y: fixture.y + (!alongX ? -length / 2 + size * (i + 0.5) : 0), width: alongX ? size : fixture.width, height: alongX ? fixture.height : size }, 0);
      }
      return;
    }
    // Six student stations plus one teacher station match the demo passports.
    const variant = fixture.kind === 'desk' && this.level.theme === 'lab'
      ? fixture.y < 200 ? 0 : fixture.x < 400 && fixture.y > 400 ? 2 : 1
      : 0;
    this.drawFixtureImage(fixture, variant);
  }
  private drawFixtureImage(fixture: Fixture, variant: number): void {
    const z = fixtureHeight(fixture.kind);
    const textureKey = `eco3-fixture-${this.level.theme}-${fixture.kind}-${fixture.width}-${fixture.height}-${variant}`;
    const padding = 16, width = Math.ceil((fixture.width + fixture.height) * 0.75 + padding * 2), height = Math.ceil((fixture.width + fixture.height) * 0.375 + z + padding * 2);
    const anchorX = width / 2, anchorY = z + padding + (fixture.width + fixture.height) * 0.375 / 2;
    if (!this.scene.textures.exists(textureKey)) {
      const art = this.scene.make.graphics({ x: 0, y: 0 });
      const s: Surface = { graphics: art, point: (x, y, height = 0) => ({ x: anchorX + (x - y) * 0.75, y: anchorY + (x + y) * 0.375 - height }) };
      this.paintFixture(s, fixture, variant);
      art.generateTexture(textureKey, width, height);
      art.destroy();
    }
    this.drawShadow(fixture);
    const p = worldToScreen(fixture), image = this.scene.add.image(p.x, p.y, textureKey).setOrigin(anchorX / width, anchorY / height).setDepth(getDepth(fixture));
    this.objects.push(image);
    if (variant > 0) {
      const screenLight = this.addGraphics(getDepth(fixture, 0.4)), s = worldSurface(screenLight);
      for (const offset of variant === 2 ? [0] : [-fixture.width * 0.23, fixture.width * 0.23]) {
        verticalY(s, fixture.x + offset - 17, fixture.y - 11.5, 34, 55, 24, 0x58ead9, 0.08);
        quad(s, fixture.x + offset - 19, fixture.y - 12, 38, 23, 45.3, 0x59eddc, 0.035);
      }
      this.lights.push({ object: screenLight, kind: 'screen', equipmentId: variant === 2 ? 'teacher-pc' : 'pc-bank', baseAlpha: 1 });
    }
  }
  private drawShadow(fixture: Fixture): void {
    const s = worldSurface(this.addGraphics(-30));
    for (let i = 3; i >= 0; i -= 1) quad(s, fixture.x - fixture.width / 2 - i * 2 + 4, fixture.y - fixture.height / 2 - i * 2 + 6, fixture.width + i * 4, fixture.height + i * 4, 0.7, 0x030b14, 0.035 + (3 - i) * 0.016);
  }
  private paintFixture(s: Surface, fixture: Fixture, variant: number): void {
    const { width: w, height: h, kind } = fixture, x = -w / 2, y = -h / 2;
    if (kind === 'partition') {
      box(s, x, y, w, h, 0, 62, { top: 0x9da9b0, left: 0x42556c, right: 0x526880, edge: 0xb4bcc0 });
      box(s, x - 0.3, y - 0.3, w + 0.6, h + 0.6, 0, 7, { top: 0x657988, left: 0x263c50, right: 0x334b60 });
      return;
    }
    if (kind === 'plant') {
      box(s, -w * 0.29, -h * 0.25, w * 0.58, h * 0.5, 0, 21, { top: 0x947a61, left: 0x5a4b45, right: 0x776151, edge: 0xba9777 });
      quad(s, -w * 0.24, -h * 0.2, w * 0.48, h * 0.4, 21.3, 0x172d29);
      for (let i = 0; i < 7; i += 1) {
        const angle = i * 2.4, dx = Math.cos(angle) * w * 0.28, dy = Math.sin(angle) * h * 0.25;
        line(s, 0, 0, 21, dx, dy, 30 + i % 3 * 9, 0x4d856c, 2, 1);
        polygon(s, [[dx, dy, 25 + i % 3 * 9], [dx - 9, dy + 2, 35 + i % 3 * 9], [dx, dy + 7, 44 + i % 3 * 9], [dx + 10, dy + 1, 36 + i % 3 * 9]], i % 2 ? 0x68a280 : 0x3e7b68, 1);
      }
      return;
    }
    if (kind === 'board') {
      box(s, x, y, w, h, 0, 70, { top: 0x90a39f, left: 0x45616a, right: 0x638184 });
      verticalY(s, x + 5, y + h + 0.5, w - 10, 18, 46, 0x244e47, 1);
      for (let i = 0; i < 4; i += 1) line(s, x + 17, y + h + 0.6, 57 - i * 9, x + w * (i % 2 ? 0.6 : 0.84), y + h + 0.6, 57 - i * 9, 0xc5ded1, 1, 0.6);
      box(s, x + 3, y + h, w - 6, 4, 15, 3, METAL);
      return;
    }
    if (kind === 'stairs') {
      const steps = 8;
      for (let i = 0; i < steps; i += 1) box(s, x, y + i * h / steps, w, h / steps, 0, (steps - i) * 6, { top: i % 2 ? 0x9aaab0 : 0xaab6ba, left: 0x4f6578, right: 0x718a97, edge: 0xc5cdd0 });
      for (const px of [x + 6, x + w - 6]) {
        line(s, px, y + 5, 59, px, y + h - 4, 22, 0xb3c3c5, 3, 1);
        for (let i = 0; i < 4; i += 1) line(s, px, y + 9 + i * 25, 5 + (3 - i) * 9, px, y + 9 + i * 25, 52 - i * 9, 0x9aaeb4, 2, 1);
      }
      return;
    }
    if (kind === 'chair' || kind === 'bench') {
      const bench = kind === 'bench';
      for (const px of [x + 5, x + w - 9]) for (const py of [y + 4, y + h - 7]) box(s, px, py, 4, 4, 0, 22, DARK);
      box(s, x, y, w, h, 22, 6, { top: bench ? this.palette.wood : 0x547487, left: bench ? 0x66574a : 0x2c485d, right: bench ? 0x786553 : 0x3c5e75, edge: bench ? 0xb1987b : 0x87a4b2 });
      box(s, x, y, w, 5, 28, bench ? 15 : 25, { top: 0x86a0ad, left: 0x355064, right: 0x527487, edge: 0xa4b9bf });
      if (!bench) for (const px of [x - 2, x + w - 2]) box(s, px, y + 3, 4, h - 7, 27, 3, DARK);
      return;
    }
    if (kind === 'fridge' || kind === 'freezer') {
      const freezer = kind === 'freezer';
      box(s, x, y, w, h, 0, 74, { top: 0xd3ddd7, left: 0x7e979f, right: 0xafc2c2, edge: 0xe1e8df });
      verticalY(s, x + 5, y + h + 0.4, w - 10, 7, 60, 0xc2d2cd, 1);
      verticalY(s, x + 8, y + h + 0.6, w - 16, 36, 2, 0x728f97, 1);
      line(s, x + w - 15, y + h + 1, 42, x + w - 15, y + h + 1, 59, 0x607d88, 3, 1);
      line(s, x + w - 15, y + h + 1, 15, x + w - 15, y + h + 1, 27, 0x607d88, 3, 1);
      verticalY(s, x + 12, y + h + 0.8, 20, 53, 9, freezer ? 0x416987 : 0x477d68, 1);
      verticalY(s, x + 14, y + h + 1, 15, 56, 3, freezer ? 0x9ad3ec : 0xa5e2bb, 1);
      return;
    }
    if (kind === 'rack' || kind === 'cabinet') {
      const rack = kind === 'rack';
      box(s, x, y, w, h, 0, 68, { top: rack ? 0x597184 : 0x8e9e9e, left: 0x273e52, right: rack ? 0x3e596b : 0x647a86, edge: 0xa0b4b8 });
      verticalY(s, x + 4, y + h + 0.3, w - 8, 8, 54, rack ? 0x122936 : 0x566e7d, 1);
      if (rack) for (let i = 0; i < 5; i += 1) {
        verticalY(s, x + 8, y + h + 0.5, w - 16, 13 + i * 9, 6, 0x3c5362, 1);
        verticalY(s, x + 10, y + h + 0.7, 4, 15 + i * 9, 2, i % 3 ? 0x6ed4b7 : 0xe3bc75, 1);
      }
      else for (const px of [x + w * 0.47, x + w * 0.53]) line(s, px, y + h + 0.8, 26, px, y + h + 0.8, 37, 0xc4d3cb, 2, 1);
      return;
    }
    if (kind === 'heater') {
      box(s, x, y, w, h, 0, 34, { top: 0xc4cec8, left: 0x778e98, right: 0xa0b4b6, edge: 0xe0e5db });
      for (let px = x + 6; px < x + w - 3; px += 7) line(s, px, y + h + 0.3, 4, px, y + h + 0.3, 29, 0x6c8993, 2, 0.8);
      return;
    }
    if (kind === 'bag') {
      box(s, x, y, w, h, 0, 23, { top: 0xb09b77, left: 0x7b6858, right: 0x927a60, edge: 0xc7b48e });
      line(s, -7, -3, 24, -7, -3, 30, 0x655642, 3, 1); line(s, 7, -3, 24, 7, -3, 30, 0x655642, 3, 1); line(s, -7, -3, 30, 7, -3, 30, 0x655642, 3, 1);
      return;
    }
    if (kind === 'oven') {
      box(s, x, y, w, h, 0, 48, METAL);
      verticalY(s, x + 5, y + h + 0.5, w - 10, 6, 32, 0x344a55, 1);
      verticalY(s, x + 10, y + h + 0.7, w - 20, 12, 22, 0x152d39, 1);
      line(s, x + 15, y + h + 0.8, 30, x + w - 15, y + h + 0.8, 30, 0xc7d4ce, 2, 1);
      for (const px of [x + w * 0.28, x + w * 0.72]) outlineQuad(s, px - 13, -10, 26, 23, 48.5, 0x41535b, 2, 0.8);
      return;
    }
    if (kind === 'counter') {
      box(s, x + 3, y + 3, w - 6, h - 6, 0, 40, { top: 0xb8c6bd, left: 0x587782, right: 0x819aa0, edge: 0xc6d5ca });
      box(s, x - 1, y - 1, w + 2, h + 2, 40, 5, METAL);
      if (w > 140 && h < 100) for (let i = 0; i < 3; i += 1) {
        const px = x + 15 + i * (w - 40) / 3;
        box(s, px, y + 12, 30, h - 24, 45, 3, { top: 0x5b6d71, left: 0x364d59, right: 0x455b63, edge: 0xa6b9b8 });
        quad(s, px + 3, y + 15, 24, h - 30, 48.2, [0x93b56c, 0xc5a269, 0xbb8170][i], 0.8);
      }
      return;
    }
    for (const px of [x + 5, x + w - 10]) for (const py of [y + 5, y + h - 10]) box(s, px, py, 5, 5, 0, 40, { top: 0x82969e, left: 0x3a5265, right: 0x5a7180 });
    box(s, x + 4, y + 4, w - 8, h - 8, 33, 7, DARK);
    box(s, x - 1, y - 1, w + 2, h + 2, 40, 5, { top: this.palette.wood, left: shade(this.palette.wood, 0.58), right: shade(this.palette.wood, 0.8), edge: shade(this.palette.wood, 1.28) });
    line(s, x + 7, y + 9, 45.4, x + w - 7, y + 9, 45.4, 0xd4ba92, 1, 0.12);
    if (variant > 0) for (const dx of variant === 2 ? [0] : [-w * 0.23, w * 0.23]) this.paintComputer(s, dx, -10, 45);
    else if (kind === 'desk') {
      quad(s, -w * 0.24, -h * 0.12, w * 0.3, h * 0.38, 45.4, 0xd5dbc7, 0.95);
      for (let i = 0; i < 3; i += 1) line(s, -w * 0.2, 2 + i * 4, 45.6, w * 0.03, 2 + i * 4, 45.6, 0x6c9189, 1, 0.7);
      box(s, w * 0.22, -h * 0.2, 12, 12, 45, 8, { top: 0xc6c8a5, left: 0x7b967f, right: 0xa0b497 });
    } else if (kind === 'table') for (const dx of [-w * 0.26, w * 0.26]) {
      quad(s, dx - 13, -10, 26, 21, 45.4, 0xc6d4c7, 0.9); quad(s, dx - 8, -7, 16, 15, 45.5, 0xe4e4c6, 0.95);
    }
  }
  private paintComputer(s: Surface, x: number, y: number, z: number): void {
    box(s, x + 23, y - 18, 11, 17, z, 23, { top: 0x5c7484, left: 0x21394c, right: 0x3b5468, edge: 0x91a8b1 });
    verticalY(s, x + 25, y - 0.8, 7, z + 4, 13, 0x1a3346, 1);
    verticalY(s, x + 27, y - 0.5, 2, z + 17, 2, 0x85e4bc, 0.9);
    box(s, x - 8, y - 1, 16, 13, z, 2, DARK);
    box(s, x - 3, y + 1, 6, 5, z + 2, 5, METAL);
    box(s, x - 20, y - 6, 40, 4, z + 7, 28, { top: 0x617c89, left: 0x1b3243, right: 0x344d60, edge: 0x94adb8 });
    verticalY(s, x - 17, y - 1.5, 34, z + 10, 23, 0x0c2437, 1);
    verticalY(s, x - 15, y - 1.2, 30, z + 12, 19, 0x28637b, 1);
    verticalY(s, x - 13, y - 1, 26, z + 13, 2, 0x4cafa6, 0.8);
    verticalY(s, x - 13, y - 1, 12, z + 18, 8, 0x5187a6, 0.8);
    for (let i = 0; i < 3; i += 1) line(s, x + 2, y - 0.8, z + 19 + i * 3, x + 12, y - 0.8, z + 19 + i * 3, 0x91d5d0, 1, 0.8);
    box(s, x - 16, y + 12, 31, 11, z + 0.1, 1.4, { top: 0x647d89, left: 0x2b4558, right: 0x3e596b });
    for (let i = 0; i < 3; i += 1) line(s, x - 12, y + 14 + i * 3, z + 1.6, x + 11, y + 14 + i * 3, z + 1.6, 0xa0b6bb, 0.7, 0.6);
    box(s, x + 24, y + 11, 7, 11, z, 2, DARK);
  }
  private drawRoomEquipment(): void {
    for (const equipment of this.level.equipment) {
      if (equipment.category === 'lighting') {
        this.drawLighting(equipment);
        if (this.level.theme === 'lab') {
          for (const position of [{ x: 325, y: 360 }, { x: 545, y: 360 }, { x: 805, y: 210 }]) this.drawLighting({ ...equipment, position });
        }
      }
      if (equipment.category === 'projector') this.drawProjector(equipment);
      if (equipment.category === 'document') this.drawDocument(equipment);
      if (equipment.category === 'ventilation') this.drawVentilation(equipment);
    }
    if (this.level.theme === 'school') {
      const f = this.level.room.furniture.find((item) => item.kind === 'cabinet');
      if (f) {
        const s = worldSurface(this.addGraphics(getDepth(f, 0.6)));
        verticalY(s, f.x - 32, f.y + f.height / 2 + 0.7, 64, 33, 22, 0x112d43, 1);
        for (let i = 0; i < 4; i += 1) verticalY(s, f.x - 27, f.y + f.height / 2 + 1, 16 + i * 9, 36 + i * 4, 2, this.palette.accent, 0.9);
      }
    }
  }
  private createDust(): void {
    const key = 'eco3-window-dust';
    if (!this.scene.textures.exists(key)) {
      const graphics = this.scene.make.graphics({ x: 0, y: 0 });
      graphics.fillStyle(0xf3eacb, 0.9).fillCircle(2, 2, 1.2);
      graphics.generateTexture(key, 4, 4);
      graphics.destroy();
    }
    const b = this.level.room.bounds;
    // Exactly eight lightweight sprites, shared texture, no growing emitter.
    for (let i = 0; i < 8; i += 1) {
      const p = worldToScreen({ x: b.x + 42 + i % 3 * 28, y: b.y + 112 + i % 3 * 155 + Math.floor(i / 3) * 14 });
      const image = this.scene.add.image(p.x, p.y, key).setDepth(-20).setAlpha(0.08).setVisible(false);
      this.objects.push(image);
      this.dust.push({ image, x: p.x, y: p.y, phase: i * 5.17 });
    }
  }
  private drawLighting(equipment: Equipment): void {
    const p = equipment.position, s = worldSurface(this.addGraphics(getDepth(p, 5))), width = this.level.theme === 'hall' ? 90 : 82;
    box(s, p.x - width / 2, p.y - 6, width, 12, 70, 6, { top: 0x9baeb8, left: 0x526b7f, right: 0x718b9a, edge: 0xc4d2d4 });
    quad(s, p.x - width / 2 + 4, p.y - 4, width - 8, 8, 69.6, 0xf2edce, 0.95);
    for (const x of [p.x - width / 2 + 9, p.x + width / 2 - 9]) line(s, x, p.y, 76, x, p.y, 82, 0xa8b5bf, 1, 0.5);
    const pool = this.addGraphics(-45), surface = worldSurface(pool);
    for (let i = 4; i >= 0; i -= 1) quad(surface, p.x - 65 - i * 10, p.y - 40 - i * 10, 130 + i * 20, 80 + i * 20, 0.6, this.level.theme === 'kitchen' ? 0xffe6b5 : 0xb8efd9, 0.009 + (4 - i) * 0.003);
    this.lights.push({ object: pool, kind: 'ceiling', equipmentId: equipment.id, baseAlpha: 1 });
  }
  private drawProjector(equipment: Equipment): void {
    const p = equipment.position, s = worldSurface(this.addGraphics(getDepth(p, 2)));
    box(s, p.x - 23, p.y - 16, 46, 32, 61, 12, { top: 0xc8d4cd, left: 0x617d8b, right: 0x96adb3, edge: 0xe4e9da });
    verticalY(s, p.x - 15, p.y + 16.5, 12, 64, 6, 0x315e70, 1);
    verticalY(s, p.x + 5, p.y + 16.5, 11, 65, 3, 0x607e86, 1);
    const beam = this.addGraphics(-35);
    polygon(worldSurface(beam), [[p.x - 11, p.y + 16, 65], [p.x - 5, p.y + 16, 65], [p.x - 90, p.y + 160, 1], [p.x + 70, p.y + 160, 1]], 0xbadce1, 0.022);
    this.detailEffects.push(beam);
  }
  private drawDocument(equipment: Equipment): void {
    const p = equipment.position, s = worldSurface(this.addGraphics(-18));
    quad(s, p.x - 15, p.y - 13, 30, 26, 0.8, 0x162c3c, 0.5); quad(s, p.x - 13, p.y - 12, 25, 24, 1, 0xc9cfb5, 0.86);
    for (let i = 0; i < 4; i += 1) line(s, p.x - 9, p.y - 7 + i * 4, 1.2, p.x + (i % 2 ? 5 : 8), p.y - 7 + i * 4, 1.2, 0x577e78, 1, 0.85);
    line(s, p.x - 9, p.y + 8, 1.2, p.x - 2, p.y + 8, 1.2, this.palette.accent, 2, 0.75);
  }
  private drawVentilation(equipment: Equipment): void {
    const p = equipment.position, s = worldSurface(this.addGraphics(getDepth(p, 1)));
    box(s, p.x - 42, p.y - 23, 84, 46, 65, 14, { top: 0xc3cdc8, left: 0x658391, right: 0x8ca4ad, edge: 0xd9e0d6 });
    quad(s, p.x - 31, p.y - 15, 62, 30, 79.2, 0x536d78, 1);
    for (let i = 0; i < 6; i += 1) line(s, p.x - 28, p.y - 12 + i * 5, 79.4, p.x + 28, p.y - 12 + i * 5, 79.4, 0x9cb2b7, 1, 0.7);
  }
  private drawDoorsAndSigns(): void {
    const b = this.level.room.bounds, x = b.x + b.width * 0.79, s = worldSurface(this.addGraphics(-17));
    quad(s, x - 43, b.y + b.height - 9, 86, 11, 0.8, 0xb4bfc0, 0.85);
    for (let i = 0; i < 3; i += 1) line(s, x - 39, b.y + b.height - 7 + i * 3, 1, x + 39, b.y + b.height - 7 + i * 3, 1, 0x57707c, 1, 0.6);
    this.addText({ x, y: b.y + b.height - 29 }, 'ВЫХОД', 8, '#a0ccbe', -15);
    const anchor = { x: b.x + b.width - 137, y: b.y };
    const wall = worldSurface(this.addGraphics(getDepth(anchor, -30)));
    verticalY(wall, b.x + b.width - 205, b.y - 1, 136, 37, 24, 0x122c40, 0.8);
    const p = worldToScreen(anchor, 48);
    const sign = this.scene.add.text(p.x, p.y, `СЕКТОР ${String(this.level.order).padStart(2, '0')}`, {
      fontFamily: 'ui-monospace, monospace', fontSize: '9px', color: '#b8d8dc', letterSpacing: 1.5,
    }).setOrigin(0.5).setRotation(Math.atan(0.5)).setDepth(getDepth(anchor, -20));
    this.objects.push(sign);
  }
  private drawAmbientVeil(): void {
    const b = this.level.room.bounds;
    quad(worldSurface(this.ambient), b.x, b.y, b.width, b.height, 0.7, 0x05122b, 0.12);
  }
  private drawThermalOverlay(): void {
    const children: Phaser.GameObjects.Graphics[] = [];
    for (const equipment of this.level.equipment) {
      if (!['window', 'door', 'heating'].includes(equipment.category)) continue;
      const graphics = this.scene.add.graphics(), s = worldSurface(graphics), p = equipment.position;
      const color = equipment.category === 'heating' ? 0xfa8b58 : equipment.id.includes('window-b') ? 0x83bdff : 0xff4d72;
      for (let i = 4; i >= 0; i -= 1) quad(s, p.x - 31 - i * 11, p.y - 24 - i * 9, 62 + i * 22, 48 + i * 18, 0.8, color, 0.035 + (4 - i) * 0.015);
      outlineQuad(s, p.x - 31, p.y - 24, 62, 48, 1, color, 1.4, 0.8);
      children.push(graphics);
    }
    this.thermal.add(children);
  }
  private refreshLighting(): void {
    const daylight = this.hour >= 7 && this.hour <= 17;
    for (const source of this.lights) {
      if (source.kind === 'window') source.baseAlpha = daylight ? 0.75 + Math.sin((this.hour - 7) / 10 * Math.PI) * 0.25 : 0.1;
      else if (source.kind === 'screen') {
        const hours = source.equipmentId === 'teacher-pc' ? 2 : this.plan?.kind === 'timeline' ? this.plan.computerHours : 10;
        source.baseAlpha = this.hour >= 8 && this.hour < 8 + hours ? 1 : 0.08;
      } else source.baseAlpha = this.ceilingIsOn(source.equipmentId) ? 1 : 0.1;
      source.object.setAlpha(source.baseAlpha);
    }
    this.ambient?.setAlpha(daylight ? 0.22 : 0.9);
  }
  private ceilingIsOn(id?: string): boolean {
    if (!id) return true;
    if (this.plan?.kind === 'timeline') return this.hour >= 8 && this.hour < 8 + this.plan.lightingHours;
    if (this.plan?.kind === 'lighting') {
      if (id.includes('emergency')) return this.plan.emergencyMode !== 'off';
      const mode = id.includes('window') ? this.plan.windowMode : id.includes('stairs') ? this.plan.stairsMode : this.plan.interiorMode;
      if (mode === 'off') return false;
      if (mode === 'daylight') return this.hour >= 8 && this.hour < 18 && !(this.hour >= 10 && this.hour < 16);
      if (mode === 'presence') return (this.hour >= 8 && this.hour < 11) || (this.hour >= 14 && this.hour < 17);
      if (mode === 'schedule') return this.hour >= 8 && this.hour < 16;
      return this.hour >= 7 && this.hour < 19;
    }
    return this.hour >= 8 && this.hour < (this.level.theme === 'lab' ? 16 : 18);
  }
}
export function renderRoom(scene: Phaser.Scene, level: CampaignCase): RoomRenderer { return new RoomRenderer(scene, level); }
function fixtureHeight(kind: string): number {
  return ({ partition: 62, board: 70, fridge: 74, freezer: 74, rack: 68, cabinet: 68, stairs: 61, plant: 67, chair: 54, heater: 34, bag: 31, bench: 44, desk: 84 } as Record<string, number>)[kind] ?? 50;
}
function worldSurface(graphics: Phaser.GameObjects.Graphics): Surface { return { graphics, point: (x, y, z = 0) => worldToScreen({ x, y }, z) }; }
function polygon(s: Surface, coordinates: [number, number, number][], color: number, alpha = 1): void { s.graphics.fillStyle(color, alpha).fillPoints(coordinates.map(([x, y, z]) => s.point(x, y, z)), true); }
function polyline(s: Surface, coordinates: [number, number, number][], color: number, width = 1, alpha = 1): void { s.graphics.lineStyle(width, color, alpha).strokePoints(coordinates.map(([x, y, z]) => s.point(x, y, z)), false); }
function quad(s: Surface, x: number, y: number, width: number, height: number, z: number, color: number, alpha = 1): void { polygon(s, [[x, y, z], [x + width, y, z], [x + width, y + height, z], [x, y + height, z]], color, alpha); }
function outlineQuad(s: Surface, x: number, y: number, width: number, height: number, z: number, color: number, lineWidth = 1, alpha = 1): void { polyline(s, [[x, y, z], [x + width, y, z], [x + width, y + height, z], [x, y + height, z], [x, y, z]], color, lineWidth, alpha); }
function verticalY(s: Surface, x: number, y: number, width: number, z: number, height: number, color: number, alpha = 1): void { polygon(s, [[x, y, z], [x + width, y, z], [x + width, y, z + height], [x, y, z + height]], color, alpha); }
function verticalX(s: Surface, x: number, y: number, width: number, z: number, height: number, color: number, alpha = 1): void { polygon(s, [[x, y, z], [x, y + width, z], [x, y + width, z + height], [x, y, z + height]], color, alpha); }
function box(s: Surface, x: number, y: number, width: number, height: number, z: number, elevation: number, material: Material): void {
  verticalY(s, x, y + height, width, z, elevation, material.right); verticalX(s, x + width, y, height, z, elevation, material.left); quad(s, x, y, width, height, z + elevation, material.top);
  if (material.edge) { outlineQuad(s, x, y, width, height, z + elevation + 0.05, material.edge, 0.7, 0.5); line(s, x + width, y + height, z, x + width, y + height, z + elevation, material.edge, 0.7, 0.35); }
}
function line(s: Surface, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, color: number, width = 1, alpha = 1): void {
  const a = s.point(x1, y1, z1), b = s.point(x2, y2, z2); s.graphics.lineStyle(width, color, alpha).lineBetween(a.x, a.y, b.x, b.y);
}
function shade(color: number, factor: number): number {
  return (Math.min(255, Math.round((color >> 16 & 255) * factor)) << 16) | (Math.min(255, Math.round((color >> 8 & 255) * factor)) << 8) | Math.min(255, Math.round((color & 255) * factor));
}
