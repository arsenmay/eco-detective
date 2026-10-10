import Phaser from 'phaser';
import type { CampaignCase, CampaignPlan, Rect } from '../campaign/types';
import { applyRoomEnergyPlan, drawRoom, WORLD_HEIGHT, WORLD_WIDTH, type RoomArtwork } from './roomArtwork';

export type CampaignArtwork = RoomArtwork & { thermalLayer: Phaser.GameObjects.Container };

const PALETTES = {
  hall: { floor: 0x203247, tile: 0x263b51, accent: 0x67dfcc, light: 0xeff6df },
  kitchen: { floor: 0x243b42, tile: 0x2b454c, accent: 0x91d9ac, light: 0xf9f0ce },
  thermal: { floor: 0x24354b, tile: 0x2b3c53, accent: 0xf4b475, light: 0xffe6b6 },
  school: { floor: 0x1b2e45, tile: 0x20364e, accent: 0x8caaf2, light: 0xd1e9ff },
};

const TITLES = {
  hall: ['КОРИДОР И ЛЕСТНИЧНЫЙ ХОЛЛ', '02 / СВЕТ И БЕЗОПАСНОСТЬ'],
  kitchen: ['ШКОЛЬНАЯ СТОЛОВАЯ', '03 / УМНАЯ КУХНЯ'],
  thermal: ['КЛАССЫ И СПОРТИВНЫЙ ЗАЛ', '04 / ТЕПЛОВОЙ СЛЕД'],
  school: ['ШТАБ ЭНЕРГЕТИЧЕСКОГО КРИЗИСА', '05 / ВСЯ ШКОЛА'],
};

/** All room art follows the exact furniture geometry used for collisions. */
export function drawCampaignRoom(scene: Phaser.Scene, level: CampaignCase): CampaignArtwork {
  if (level.theme === 'lab') return { ...drawRoom(scene), thermalLayer: scene.add.container().setDepth(10).setVisible(false) };
  const palette = PALETTES[level.theme];
  const bounds = level.room.bounds;
  const floor = scene.add.graphics();
  drawFloor(floor, bounds, palette.floor, palette.tile);
  drawZones(scene, floor, level);

  const light = scene.add.graphics();
  const planned = scene.add.graphics();
  if (level.theme === 'hall') drawHall(scene, floor, light, planned, level);
  if (level.theme === 'kitchen') drawKitchen(scene, floor, light, planned, level);
  if (level.theme === 'thermal') drawThermal(scene, floor, light, planned, level);
  if (level.theme === 'school') drawSchool(scene, floor, light, planned, level);

  for (const furniture of level.room.furniture) drawFixture(floor, furniture, level.theme);
  drawWalls(floor, bounds, palette.accent);
  const [title, sector] = TITLES[level.theme];
  text(scene, bounds.x, 46, title, 12, '#b5cbdf');
  text(scene, bounds.x + bounds.width, 46, sector, 10, '#72d7c7').setOrigin(1, 0);
  text(scene, bounds.x, bounds.y + bounds.height + 41, 'ВЫМЫШЛЕННАЯ УЧЕБНАЯ МОДЕЛЬ · СШ №225, МИНСК', 9, '#71879c');
  text(scene, bounds.x + bounds.width, bounds.y + bounds.height + 41, `УЛИКИ 01—${String(level.equipment.length).padStart(2, '0')}`, 9, '#71879c').setOrigin(1, 0);
  const modelLabel = text(scene, bounds.x, 69, 'ИССЛЕДУЙТЕ ОБОРУДОВАНИЕ · СОПОСТАВЬТЕ ФАКТЫ', 10, '#6093a9');
  const scanningLine = scene.add.rectangle(bounds.x, bounds.y, bounds.width, 1, 0x65edda, 0.1).setOrigin(0).setDepth(5);
  const thermalLayer = createThermalLayer(scene, level);
  bake(scene, floor, `campaign-${level.id}-floor`, 0);
  return {
    lighting: bake(scene, light, `campaign-${level.id}-lighting`, 8),
    standbyScreens: bake(scene, planned, `campaign-${level.id}-planned`, 7).setAlpha(0),
    modelLabel, scanningLine, thermalLayer,
  };
}

export function applyCampaignVisualPlan(artwork: CampaignArtwork, level: CampaignCase, plan: CampaignPlan | null): void {
  if (level.theme === 'lab' && (!plan || plan.kind === 'timeline')) {
    applyRoomEnergyPlan(artwork, plan?.kind === 'timeline' ? plan : null);
    return;
  }
  artwork.standbyScreens.setAlpha(plan ? 0.85 : 0);
  let caption = 'ИССЛЕДУЙТЕ ОБОРУДОВАНИЕ · СОПОСТАВЬТЕ ФАКТЫ';
  if (plan?.kind === 'lighting') caption = 'ПЛАН ОСВЕЩЕНИЯ · БЕЗОПАСНЫЕ МАРШРУТЫ СОХРАНЕНЫ';
  if (plan?.kind === 'kitchen') caption = `ПЛАН КУХНИ · ВЫБРАНО РЕШЕНИЙ: ${plan.upgradeIds.length}`;
  if (plan?.kind === 'thermal') caption = `ТЕПЛОВОЙ ПЛАН · КЛАСС ${plan.classTemp} °C / ЗАЛ ${plan.gymTemp} °C`;
  if (plan?.kind === 'crisis') caption = `ПЛАН ШКОЛЫ · ПРОЕКТОВ: ${plan.projectIds.length} · БАЛАНСЫ РАЗДЕЛЕНЫ`;
  artwork.modelLabel.setText(caption);
  artwork.modelLabel.setColor(plan ? '#72d9b9' : '#4a8a9a');
}

function bake(scene: Phaser.Scene, graphics: Phaser.GameObjects.Graphics, key: string, depth: number): Phaser.GameObjects.Image {
  if (!scene.textures.exists(key)) graphics.generateTexture(key, WORLD_WIDTH, WORLD_HEIGHT);
  graphics.destroy();
  return scene.add.image(0, 0, key).setOrigin(0).setDepth(depth);
}

function text(scene: Phaser.Scene, x: number, y: number, value: string, size = 10, color = '#7d96ab'): Phaser.GameObjects.Text {
  return scene.add.text(x, y, value, {
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    fontSize: `${size}px`, color, letterSpacing: 0.8,
  }).setDepth(9);
}

function drawFloor(art: Phaser.GameObjects.Graphics, bounds: Rect, floorColor: number, tileColor: number): void {
  art.fillStyle(0x070f1d);
  art.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  art.fillStyle(0x020713, 0.6);
  art.fillRoundedRect(bounds.x - 26, bounds.y - 24, bounds.width + 61, bounds.height + 62, 14);
  art.fillStyle(0x31455c);
  art.fillRoundedRect(bounds.x - 30, bounds.y - 34, bounds.width + 60, bounds.height + 60, 10);
  art.fillStyle(floorColor);
  art.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  const tile = 46;
  for (let row = 0; row * tile < bounds.height; row += 1) {
    for (let column = 0; column * tile < bounds.width; column += 1) {
      if ((row + column) % 2 === 1) continue;
      art.fillStyle(tileColor, 0.65);
      art.fillRect(bounds.x + column * tile, bounds.y + row * tile, Math.min(tile - 1, bounds.width - column * tile), Math.min(tile - 1, bounds.height - row * tile));
    }
  }
  art.lineStyle(1, 0x8193a8, 0.11);
  for (let x = bounds.x; x < bounds.x + bounds.width; x += tile) art.lineBetween(x, bounds.y, x, bounds.y + bounds.height);
  for (let y = bounds.y; y < bounds.y + bounds.height; y += tile) art.lineBetween(bounds.x, y, bounds.x + bounds.width, y);
}

function drawWalls(art: Phaser.GameObjects.Graphics, bounds: Rect, accent: number): void {
  const { x, y, width, height } = bounds;
  art.fillStyle(0x304459);
  art.fillRoundedRect(x - 30, y - 34, width + 60, 34, 7);
  art.fillStyle(0x203448);
  art.fillRect(x - 30, y, 30, height);
  art.fillRect(x + width, y, 30, height);
  art.fillStyle(0x304459);
  art.fillRect(x - 30, y + height, width + 60, 22);
  art.lineStyle(2, accent, 0.33);
  art.lineBetween(x + 5, y - 1, x + width - 5, y - 1);
  art.lineStyle(1, 0x9db2c5, 0.24);
  art.lineBetween(x - 12, y - 29, x + width + 12, y - 29);
  art.lineBetween(x + width + 14, y + 5, x + width + 14, y + height);
  // The doorway is drawn in the perimeter, outside the walkable body bounds.
  const doorX = x + width * 0.79;
  art.fillStyle(0x091728);
  art.fillRect(doorX - 42, y + height, 84, 22);
  art.lineStyle(2, 0x84a5b5, 0.8);
  art.lineBetween(doorX - 42, y + height + 5, doorX + 42, y + height + 5);
  art.fillStyle(accent, 0.85);
  art.fillRoundedRect(doorX - 19, y + height + 7, 38, 4, 2);
  for (const [cx, cy, dx, dy] of [
    [x + 10, y + 10, 1, 1], [x + width - 10, y + 10, -1, 1],
    [x + 10, y + height - 10, 1, -1], [x + width - 10, y + height - 10, -1, -1],
  ]) {
    art.lineStyle(2, accent, 0.25);
    art.lineBetween(cx, cy, cx + dx * 16, cy);
    art.lineBetween(cx, cy, cx, cy + dy * 16);
  }
}

function drawZones(scene: Phaser.Scene, art: Phaser.GameObjects.Graphics, level: CampaignCase): void {
  const colors = [0x48bfc0, 0x829dda, 0xcba87b, 0x75ba97];
  level.room.zones.forEach((zone, index) => {
    const color = colors[index % colors.length];
    art.fillStyle(color, level.theme === 'school' ? 0.11 : 0.045);
    art.fillRoundedRect(zone.x + 3, zone.y + 3, zone.width - 6, zone.height - 6, 6);
    art.lineStyle(1, color, 0.18);
    art.strokeRoundedRect(zone.x + 3, zone.y + 3, zone.width - 6, zone.height - 6, 6);
    const gym = /спорт|gym/i.test(zone.name);
    if (gym) {
      art.fillStyle(0x6c5944, 0.5);
      art.fillRect(zone.x + 5, zone.y + 5, zone.width - 10, zone.height - 10);
      art.lineStyle(1, 0xbaa486, 0.18);
      for (let y = zone.y + 12; y < zone.y + zone.height - 5; y += 16) art.lineBetween(zone.x + 5, y, zone.x + zone.width - 5, y);
      drawCourt(art, zone);
    }
    text(scene, zone.x + 13, zone.y + zone.height - 24, zone.name.toLocaleUpperCase('ru-RU'), 9, '#7895a8');
  });
}

function drawCourt(art: Phaser.GameObjects.Graphics, zone: Rect): void {
  const margin = 24;
  const x = zone.x + margin;
  const y = zone.y + margin;
  const width = zone.width - margin * 2;
  const height = zone.height - margin * 2;
  if (width < 30 || height < 30) return;
  art.lineStyle(2, 0xe4d7b9, 0.45);
  art.strokeRect(x, y, width, height);
  art.lineBetween(x + width / 2, y, x + width / 2, y + height);
  art.strokeCircle(x + width / 2, y + height / 2, Math.min(35, height / 4));
  for (const cx of [x, x + width - 42]) art.strokeRect(cx, y + height / 2 - 29, 42, 58);
  // Two wall-mounted baskets are decoration, not unmodeled obstacles.
  for (const cx of [zone.x + 10, zone.x + zone.width - 10]) {
    art.fillStyle(0xb6c3c9, 0.75);
    art.fillRect(cx - 2, zone.y + zone.height / 2 - 24, 4, 48);
    art.lineStyle(2, 0xe4a276, 0.8);
    art.strokeEllipse(cx + (cx < zone.x + zone.width / 2 ? 10 : -10), zone.y + zone.height / 2, 20, 13);
  }
}

function window(art: Phaser.GameObjects.Graphics, x: number, y: number, height = 78, right = false): void {
  const direction = right ? -1 : 1;
  for (let layer = 0; layer < 4; layer += 1) {
    art.fillStyle(0x8de5ee, 0.026);
    art.fillPoints([
      new Phaser.Geom.Point(x, y - height / 2),
      new Phaser.Geom.Point(x, y + height / 2),
      new Phaser.Geom.Point(x + direction * (180 - layer * 24), y + height / 2 + 59 - layer * 8),
      new Phaser.Geom.Point(x + direction * (180 - layer * 24), y - height / 2 + 32),
    ], true);
  }
  art.fillStyle(0x0b1929);
  art.fillRect(x - 7, y - height / 2 - 5, 17, height + 10);
  art.fillStyle(0x4e8aab);
  art.fillRect(x - 3, y - height / 2, 8, height);
  art.fillStyle(0xb9e5ee, 0.85);
  art.fillRect(x, y - height / 2 + 3, 3, height - 6);
  art.fillStyle(0x355269);
  art.fillRect(x - 5, y - 2, 13, 4);
}

function ceilingLight(art: Phaser.GameObjects.Graphics, x: number, y: number, width = 94, warm = false): void {
  art.fillStyle(warm ? 0xffe4a8 : 0xa2ede6, 0.035);
  art.fillEllipse(x, y + 19, width + 61, 80);
  art.fillStyle(0x081824, 0.55);
  art.fillRoundedRect(x - width / 2 - 4, y - 7, width + 8, 17, 4);
  art.fillStyle(0x778a98);
  art.fillRoundedRect(x - width / 2, y - 7, width, 12, 3);
  art.fillStyle(warm ? 0xffe9c2 : 0xd5f7e8, 0.92);
  art.fillRoundedRect(x - width / 2 + 4, y - 5, width - 8, 6, 2);
}

function drawHall(scene: Phaser.Scene, art: Phaser.GameObjects.Graphics, light: Phaser.GameObjects.Graphics, planned: Phaser.GameObjects.Graphics, level: CampaignCase): void {
  const b = level.room.bounds;
  for (const y of [b.y + 112, b.y + 271, b.y + 424]) window(art, b.x + 2, y, 82);
  // A continuous marked route visibly connects the classroom doors and stairs.
  const routeY = b.y + b.height * 0.61;
  art.lineStyle(2, 0x62c7b6, 0.2);
  for (let x = b.x + 61; x < b.x + b.width - 75; x += 29) art.lineBetween(x, routeY, x + 12, routeY);
  for (const x of [b.x + 127, b.x + b.width * 0.55, b.x + b.width - 154]) {
    art.fillStyle(0x54bea9, 0.18);
    art.fillTriangle(x - 5, routeY - 5, x + 7, routeY, x - 5, routeY + 5);
  }
  for (const x of [b.x + 191, b.x + 430, b.x + 702]) {
    ceilingLight(light, x, b.y + 182, 106);
    ceilingLight(light, x, b.y + 430, 106);
  }
  // The emergency fixture retains a distinct green indicator in the planned layer.
  art.fillStyle(0x203c36);
  art.fillRoundedRect(b.x + b.width - 142, b.y + 7, 98, 22, 4);
  art.fillStyle(0x9cf0b8);
  art.fillRect(b.x + b.width - 131, b.y + 13, 72, 3);
  art.fillTriangle(b.x + b.width - 73, b.y + 18, b.x + b.width - 65, b.y + 18, b.x + b.width - 69, b.y + 24);
  text(scene, b.x + b.width - 95, b.y + 34, 'ЭВАКУАЦИЯ', 8, '#99c2a4').setOrigin(0.5, 0);
  for (const x of [b.x + 94, b.x + 226, b.x + 357]) drawNotice(art, x, b.y + 35, 62, 65);
  text(scene, b.x + 75, routeY + 20, 'БЕЗОПАСНЫЙ МАРШРУТ', 9, '#658e95');
  planned.fillStyle(0x7cf0b9, 0.65);
  planned.fillRoundedRect(b.x + b.width - 135, b.y + 11, 81, 5, 2);
}

function drawKitchen(scene: Phaser.Scene, art: Phaser.GameObjects.Graphics, light: Phaser.GameObjects.Graphics, planned: Phaser.GameObjects.Graphics, level: CampaignCase): void {
  const b = level.room.bounds;
  // Stainless backsplash and utensils sit on the wall, leaving aisle geometry intact.
  art.fillStyle(0x879393, 0.23);
  art.fillRect(b.x + 25, b.y + 5, b.width - 50, 30);
  art.lineStyle(1, 0xbccbc4, 0.22);
  for (let x = b.x + 25; x < b.x + b.width - 25; x += 32) art.lineBetween(x, b.y + 5, x, b.y + 35);
  for (let index = 0; index < 5; index += 1) {
    const x = b.x + 435 + index * 18;
    art.lineStyle(2, 0x9baaaa, 0.7);
    art.lineBetween(x, b.y + 12, x, b.y + 27);
    art.strokeCircle(x, b.y + 29, 4);
  }
  window(art, b.x + 2, b.y + 168, 95);
  window(art, b.x + 2, b.y + 403, 95);
  for (const [x, y] of [[b.x + 269, b.y + 210], [b.x + 619, b.y + 210], [b.x + 456, b.y + 421]]) ceilingLight(light, x, y, 114, true);
  drawNotice(art, b.x + b.width - 113, b.y + 49, 66, 90);
  text(scene, b.x + b.width - 113, b.y + 45, 'МЕНЮ', 9, '#cad8c3').setOrigin(0.5, 0);
  text(scene, b.x + 35, b.y + b.height - 52, 'ЧИСТАЯ ЗОНА · ХРАНЕНИЕ ПРОДУКТОВ', 9, '#8aa4a2');
  art.lineStyle(2, 0x96cfb2, 0.17);
  for (let x = b.x + 265; x < b.x + b.width - 160; x += 25) art.lineBetween(x, b.y + b.height - 100, x + 12, b.y + b.height - 100);
  for (const item of level.room.furniture) {
    if (!/fridge|freezer|холод|мороз|warmer|oven/i.test(item.kind)) continue;
    planned.fillStyle(0x6be8b6, 0.8);
    planned.fillRoundedRect(item.x - item.width / 2 + 8, item.y - item.height / 2 + 8, Math.min(19, item.width - 16), 4, 2);
  }
}

function drawThermal(scene: Phaser.Scene, art: Phaser.GameObjects.Graphics, light: Phaser.GameObjects.Graphics, planned: Phaser.GameObjects.Graphics, level: CampaignCase): void {
  const b = level.room.bounds;
  for (const y of [b.y + 112, b.y + 310, b.y + 455]) {
    window(art, b.x + 2, y, 76);
    window(art, b.x + b.width - 2, y, 76, true);
    planned.lineStyle(3, 0x75e8b1, 0.8);
    planned.lineBetween(b.x + 11, y - 32, b.x + 11, y + 32);
    planned.lineBetween(b.x + b.width - 11, y - 32, b.x + b.width - 11, y + 32);
  }
  for (const zone of level.room.zones) {
    ceilingLight(light, zone.x + zone.width / 2, zone.y + 52, Math.min(125, zone.width * 0.42), true);
    if (/класс|class/i.test(zone.name)) {
      art.fillStyle(0x345f5d, 0.55);
      art.fillRoundedRect(zone.x + zone.width / 2 - 54, zone.y + 9, 108, 25, 3);
      art.lineStyle(1, 0xb1d2bd, 0.55);
      art.lineBetween(zone.x + zone.width / 2 - 37, zone.y + 17, zone.x + zone.width / 2 + 18, zone.y + 17);
      art.lineBetween(zone.x + zone.width / 2 - 37, zone.y + 24, zone.x + zone.width / 2 + 30, zone.y + 24);
    }
  }
  text(scene, b.x + 23, b.y + b.height - 47, 'ТЕПЛОВИЗОР: УЧЕБНАЯ ВИЗУАЛИЗАЦИЯ', 9, '#aa9989');
}

function drawSchool(scene: Phaser.Scene, art: Phaser.GameObjects.Graphics, light: Phaser.GameObjects.Graphics, planned: Phaser.GameObjects.Graphics, level: CampaignCase): void {
  const b = level.room.bounds;
  // Recessed conduits form a building-scale flow diagram on the floor.
  const center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  for (const zone of level.room.zones) {
    const x = zone.x + zone.width / 2;
    const y = zone.y + zone.height / 2;
    art.lineStyle(9, 0x0c2034, 0.7);
    art.lineBetween(x, y, x, center.y);
    art.lineBetween(x, center.y, center.x, center.y);
    art.lineStyle(2, 0x75b8dc, 0.35);
    art.lineBetween(x, y, x, center.y);
    art.lineBetween(x, center.y, center.x, center.y);
    planned.lineStyle(2, 0x75ecc0, 0.75);
    planned.lineBetween(x, y, x, center.y);
    planned.lineBetween(x, center.y, center.x, center.y);
  }
  art.lineStyle(1, 0x79b4cd, 0.18);
  art.strokeCircle(center.x, center.y, 65);
  art.strokeCircle(center.x, center.y, 72);
  for (let i = 0; i < 12; i += 1) {
    const angle = i * Math.PI / 6;
    art.lineBetween(center.x + Math.cos(angle) * 66, center.y + Math.sin(angle) * 66, center.x + Math.cos(angle) * 71, center.y + Math.sin(angle) * 71);
  }
  text(scene, center.x, center.y + 84, 'ОБЩИЙ БАЛАНС ШКОЛЫ', 10, '#7298b4').setOrigin(0.5, 0);
  for (const x of [b.x + 218, b.x + b.width - 218]) {
    ceilingLight(light, x, b.y + 196, 102);
    ceilingLight(light, x, b.y + 429, 102);
  }
  for (const y of [b.y + 110, b.y + 315, b.y + 452]) window(art, b.x + 2, y, 78);
  drawNotice(art, b.x + b.width - 60, b.y + 42, 47, 72);
}

function drawNotice(art: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number): void {
  art.fillStyle(0x040c16, 0.5);
  art.fillRoundedRect(x - width / 2 + 4, y + 6, width, height, 4);
  art.fillStyle(0x687b86);
  art.fillRoundedRect(x - width / 2, y, width, height, 3);
  art.fillStyle(0x273f4b);
  art.fillRect(x - width / 2 + 4, y + 4, width - 8, height - 8);
  for (let index = 0; index < 3; index += 1) {
    const px = x - width / 2 + 9 + (index % 2) * (width / 2 - 5);
    const py = y + 12 + Math.floor(index / 2) * (height / 2 - 9);
    art.fillStyle(index === 1 ? 0x9eb4b0 : 0xd0c5a6, 0.88);
    art.fillRoundedRect(px, py, width / 2 - 15, height / 2 - 12, 1);
    art.fillStyle(0x4c707d, 0.8);
    art.fillRect(px + 3, py + 4, Math.max(3, width / 2 - 22), 2);
    art.fillRect(px + 3, py + 9, Math.max(3, width / 2 - 25), 1);
  }
}

type Furniture = CampaignCase['room']['furniture'][number];

function drawFixture(art: Phaser.GameObjects.Graphics, fixture: Furniture, theme: CampaignCase['theme']): void {
  const { x, y, width, height } = fixture;
  const left = x - width / 2;
  const top = y - height / 2;
  const kind = fixture.kind.toLocaleLowerCase('en-US');
  art.fillStyle(0x030c17, 0.62);
  art.fillRoundedRect(left + 5, top + 8, width + 2, height + 2, Math.min(6, width / 4, height / 4));
  if (/partition|wall|перегород|стен/.test(kind)) {
    art.fillStyle(0x425368);
    art.fillRect(left, top, width, height);
    art.fillStyle(0x658095, 0.5);
    art.fillRect(left + 2, top + 2, width - 4, Math.min(4, height - 4));
    art.lineStyle(1, 0x8fa6b7, 0.4);
    art.strokeRect(left, top, width, height);
    return;
  }
  if (/stair|лест/.test(kind)) {
    drawStairs(art, fixture);
    return;
  }
  if (/board|доск/.test(kind)) {
    art.fillStyle(0x63777f);
    art.fillRoundedRect(left, top, width, height, 3);
    art.fillStyle(0x234348);
    art.fillRect(left + 4, top + 4, width - 8, height - 8);
    art.lineStyle(1, 0x96c6b8, 0.65);
    for (let i = 0; i < 3; i += 1) art.lineBetween(left + 10, top + 9 + i * 6, left + width * (0.42 + i * 0.12), top + 9 + i * 6);
    return;
  }
  if (/fridge|freezer|refriger|холод|мороз/.test(kind)) {
    drawColdStorage(art, fixture, /freezer|мороз/.test(kind));
    return;
  }
  if (theme === 'kitchen' && kind === 'counter' && y < 200 && x < 740) {
    drawVentilation(art, fixture);
    return;
  }
  if (/oven|warmer|hob|plate|heater|stove|печь|плит|мармит/.test(kind) && theme === 'kitchen') {
    drawCooking(art, fixture, /warmer|мармит/.test(kind));
    return;
  }
  if (/vent|fan|hood|вент|вытяж/.test(kind)) {
    drawVentilation(art, fixture);
    return;
  }
  if (/meter|server|panel|controller|control|rack|cabinet|щит|счёт|счет|контрол|термо/.test(kind)) {
    drawControlPanel(art, fixture, /server|rack/.test(kind));
    return;
  }
  if (/radiator|heater|heating|батар|радиатор|тепло/.test(kind)) {
    art.fillStyle(0x8c9c9f);
    art.fillRoundedRect(left, top, width, height, 4);
    art.lineStyle(2, 0x526e7e, 0.8);
    if (width > height) for (let px = left + 8; px < left + width - 5; px += 9) art.lineBetween(px, top + 4, px, top + height - 4);
    else for (let py = top + 8; py < top + height - 5; py += 9) art.lineBetween(left + 4, py, left + width - 4, py);
    art.fillStyle(0xd7b77d);
    art.fillCircle(left + width - 7, top + 7, 3);
    return;
  }
  if (/plant|растен|цвет/.test(kind)) {
    drawPlant(art, fixture);
    return;
  }
  if (/bench|seat|скам|chair|стул/.test(kind)) {
    art.fillStyle(0x546c7c);
    art.fillRoundedRect(left, top, width, height, 5);
    art.fillStyle(0x314b63);
    art.fillRoundedRect(left + 3, top + 4, width - 6, height - 7, 4);
    art.lineStyle(2, 0x839ea7, 0.5);
    art.lineBetween(left + 5, top + 4, left + width - 5, top + 4);
    return;
  }
  if (/door|двер/.test(kind)) {
    art.fillStyle(0x55718a);
    art.fillRoundedRect(left, top, width, height, 3);
    art.lineStyle(1, 0x98b3c0, 0.6);
    art.strokeRect(left + 4, top + 4, width - 8, height - 8);
    art.fillStyle(0xd5c499);
    art.fillCircle(left + width - 9, y, 2);
    return;
  }
  drawTable(art, fixture, theme === 'school' && kind === 'counter' ? 'kitchen' : theme);
  if (theme === 'school' && kind === 'desk') {
    for (const cx of [x - width * 0.24, x + width * 0.24]) {
      art.fillStyle(0x172e41);
      art.fillRoundedRect(cx - 21, y - 19, 42, 25, 3);
      art.fillStyle(0x76cdc5);
      art.fillRoundedRect(cx - 17, y - 16, 34, 17, 2);
      art.fillStyle(0xc3f3e5, 0.85);
      art.fillRect(cx - 13, y - 12, 22, 2);
      art.fillRect(cx - 13, y - 7, 15, 1);
      art.fillStyle(0x28475b);
      art.fillRoundedRect(cx - 21, y + 11, 42, 10, 2);
      art.lineStyle(1, 0x78949f, 0.6);
      for (let index = 0; index < 6; index += 1) art.lineBetween(cx - 17 + index * 6, y + 14, cx - 17 + index * 6, y + 17);
    }
  }
}

function drawTable(art: Phaser.GameObjects.Graphics, f: Furniture, theme: CampaignCase['theme']): void {
  const left = f.x - f.width / 2;
  const top = f.y - f.height / 2;
  const kitchen = theme === 'kitchen';
  art.fillStyle(kitchen ? 0x657c82 : 0x536579);
  art.fillRoundedRect(left, top, f.width, f.height, 5);
  art.fillStyle(kitchen ? 0x829695 : 0x40566b);
  art.fillRoundedRect(left + 3, top + 3, f.width - 6, f.height - 6, 3);
  art.lineStyle(1, kitchen ? 0xc2d0c4 : 0x87a5b7, 0.5);
  art.strokeRoundedRect(left, top, f.width, f.height, 5);
  if (kitchen) {
    const items = Math.max(1, Math.floor(f.width / 52));
    for (let index = 0; index < items; index += 1) {
      const x = left + (index + 0.5) * f.width / items;
      art.fillStyle(0x2d5352);
      art.fillRoundedRect(x - 16, f.y - 13, 32, 25, 3);
      art.fillStyle(index % 2 ? 0xd5b78b : 0x91ac8b);
      art.fillEllipse(x, f.y - 2, 23, 13);
      art.fillStyle(0x486d61);
      art.fillCircle(x - 5, f.y - 3, 4);
      art.fillCircle(x + 5, f.y + 1, 3);
    }
  } else if (f.width > 50 && f.height > 28) {
    art.fillStyle(0xd1c59d, 0.8);
    art.fillRoundedRect(left + 10, top + 9, Math.min(27, f.width - 20), Math.min(29, f.height - 16), 1);
    art.lineStyle(1, 0x7d817c, 0.65);
    art.lineBetween(left + 14, top + 17, left + 30, top + 17);
    art.lineBetween(left + 14, top + 22, left + 34, top + 22);
    art.fillStyle(0x4e8296);
    art.fillRoundedRect(left + f.width - 33, top + 10, 22, Math.min(28, f.height - 18), 2);
  }
}

function drawStairs(art: Phaser.GameObjects.Graphics, f: Furniture): void {
  const left = f.x - f.width / 2;
  const top = f.y - f.height / 2;
  art.fillStyle(0x50647a);
  art.fillRoundedRect(left, top, f.width, f.height, 4);
  const horizontal = f.width > f.height;
  const count = 9;
  for (let index = 0; index < count; index += 1) {
    art.fillStyle(index % 2 === 0 ? 0x798a98 : 0x627887);
    if (horizontal) art.fillRect(left + 5 + index * (f.width - 10) / count, top + 6, (f.width - 10) / count - 2, f.height - 12);
    else art.fillRect(left + 6, top + 5 + index * (f.height - 10) / count, f.width - 12, (f.height - 10) / count - 2);
  }
  art.lineStyle(3, 0xadbac1, 0.8);
  if (horizontal) {
    art.lineBetween(left + 5, top + 3, left + f.width - 5, top + 3);
    art.lineBetween(left + 5, top + f.height - 3, left + f.width - 5, top + f.height - 3);
  } else {
    art.lineBetween(left + 3, top + 5, left + 3, top + f.height - 5);
    art.lineBetween(left + f.width - 3, top + 5, left + f.width - 3, top + f.height - 5);
  }
}

function drawColdStorage(art: Phaser.GameObjects.Graphics, f: Furniture, freezer: boolean): void {
  const left = f.x - f.width / 2;
  const top = f.y - f.height / 2;
  art.fillStyle(0x7c969e);
  art.fillRoundedRect(left, top, f.width, f.height, 5);
  art.fillStyle(freezer ? 0x9aafbb : 0x9ab0aa);
  art.fillRoundedRect(left + 4, top + 4, f.width - 8, f.height - 8, 3);
  art.lineStyle(1, 0xe1eee5, 0.6);
  art.strokeRoundedRect(left + 3, top + 3, f.width - 6, f.height - 6, 3);
  art.lineStyle(2, 0x607d87, 0.9);
  art.lineBetween(left + 7, top + f.height * 0.38, left + f.width - 7, top + f.height * 0.38);
  art.fillStyle(0x425f71);
  art.fillRoundedRect(left + f.width - 13, top + 10, 4, Math.max(10, f.height * 0.22), 2);
  art.fillRoundedRect(left + f.width - 13, top + f.height * 0.48, 4, Math.max(10, f.height * 0.24), 2);
  art.fillStyle(0x315366);
  art.fillRoundedRect(left + 10, top + 11, Math.min(23, f.width - 25), 12, 2);
  art.fillStyle(freezer ? 0x8ed8e9 : 0x9ae6c2);
  art.fillRect(left + 14, top + 15, 12, 3);
}

function drawCooking(art: Phaser.GameObjects.Graphics, f: Furniture, warmer: boolean): void {
  const left = f.x - f.width / 2;
  const top = f.y - f.height / 2;
  art.fillStyle(0x657c86);
  art.fillRoundedRect(left, top, f.width, f.height, 4);
  art.fillStyle(0x263d49);
  art.fillRoundedRect(left + 5, top + 5, f.width - 10, f.height - 17, 3);
  if (warmer) {
    art.fillStyle(0xaeb5a4);
    art.fillRoundedRect(left + 10, top + 10, f.width - 20, f.height - 26, 3);
    art.lineStyle(2, 0x6b8c8e);
    art.strokeRoundedRect(left + 12, top + 12, f.width - 24, f.height - 30, 3);
    art.fillStyle(0xc2a16e);
    art.fillEllipse(f.x, f.y - 5, Math.max(12, f.width - 33), Math.max(10, f.height - 39));
  } else {
    for (const dx of [-0.23, 0.23]) {
      for (const dy of [-0.2, 0.14]) {
        const radius = Math.min(f.width, f.height) * 0.14;
        art.fillStyle(0x0c1a2a);
        art.fillCircle(f.x + f.width * dx, f.y + f.height * dy - 4, radius);
        art.lineStyle(2, 0xaf8360, 0.8);
        art.strokeCircle(f.x + f.width * dx, f.y + f.height * dy - 4, radius - 2);
      }
    }
  }
  art.fillStyle(0xadb8bb);
  art.fillRect(left + 7, top + f.height - 11, f.width - 14, 6);
  for (const dx of [-0.3, 0, 0.3]) {
    art.fillStyle(0x4a6978);
    art.fillCircle(f.x + f.width * dx, top + f.height - 8, 2.5);
  }
}

function drawVentilation(art: Phaser.GameObjects.Graphics, f: Furniture): void {
  const left = f.x - f.width / 2;
  const top = f.y - f.height / 2;
  art.fillStyle(0x7a8e9b);
  art.fillRoundedRect(left, top, f.width, f.height, 4);
  art.fillStyle(0x294455);
  art.fillRoundedRect(left + 5, top + 5, f.width - 10, f.height - 10, 2);
  if (f.width > f.height * 1.8) {
    art.lineStyle(2, 0x98abb5, 0.7);
    for (let x = left + 10; x < left + f.width - 7; x += 7) art.lineBetween(x, top + 8, x, top + f.height - 8);
  } else {
    const radius = Math.min(f.width, f.height) * 0.3;
    art.lineStyle(1, 0x9cb8c1, 0.75);
    art.strokeCircle(f.x, f.y, radius);
    art.fillStyle(0x748f9e);
    art.fillEllipse(f.x, f.y - radius * 0.4, radius * 0.55, radius * 1.15);
    art.fillEllipse(f.x + radius * 0.35, f.y + radius * 0.24, radius * 1.1, radius * 0.55);
    art.fillEllipse(f.x - radius * 0.4, f.y + radius * 0.15, radius * 0.55, radius * 1.1);
    art.fillStyle(0xb3c7cb);
    art.fillCircle(f.x, f.y, 4);
  }
}

function drawControlPanel(art: Phaser.GameObjects.Graphics, f: Furniture, server: boolean): void {
  const left = f.x - f.width / 2;
  const top = f.y - f.height / 2;
  art.fillStyle(0x536c80);
  art.fillRoundedRect(left, top, f.width, f.height, 4);
  art.fillStyle(0x1b344a);
  art.fillRoundedRect(left + 4, top + 4, f.width - 8, f.height - 8, 3);
  if (server) {
    const rows = Math.max(2, Math.floor(f.height / 17));
    for (let row = 0; row < rows; row += 1) {
      const py = top + 8 + row * (f.height - 13) / rows;
      art.fillStyle(0x3e576d);
      art.fillRoundedRect(left + 7, py, f.width - 14, 11, 2);
      art.fillStyle(0x80e4b5);
      art.fillCircle(left + 11, py + 5, 1.5);
      art.lineStyle(1, 0x142b40);
      art.lineBetween(left + 18, py + 4, left + f.width - 9, py + 4);
      art.lineBetween(left + 18, py + 7, left + f.width - 9, py + 7);
    }
  } else {
    art.fillStyle(0x66c5c1);
    art.fillRoundedRect(left + 8, top + 9, f.width - 16, Math.max(9, f.height * 0.44), 2);
    art.fillStyle(0x204654);
    const graphHeight = Math.max(3, f.height * 0.18);
    for (let index = 0; index < 5; index += 1) art.fillRect(left + 12 + index * (f.width - 25) / 5, top + 15 + graphHeight * (index % 2), Math.max(2, (f.width - 30) / 6), graphHeight);
    for (let i = 0; i < 3; i += 1) {
      art.fillStyle(i === 0 ? 0x79dab3 : 0x648493);
      art.fillCircle(left + 12 + i * (f.width - 23) / 2, top + f.height - 11, 2.5);
    }
  }
}

function drawPlant(art: Phaser.GameObjects.Graphics, f: Furniture): void {
  const scale = Math.min(f.width / 36, f.height / 38);
  art.fillStyle(0x6a7f88);
  art.fillRoundedRect(f.x - 16 * scale, f.y - 5 * scale, 32 * scale, 22 * scale, 5 * scale);
  art.fillStyle(0x314d5a);
  art.fillEllipse(f.x, f.y - 5 * scale, 32 * scale, 15 * scale);
  art.fillStyle(0x538e75);
  art.fillEllipse(f.x - 8 * scale, f.y - 14 * scale, 16 * scale, 25 * scale);
  art.fillEllipse(f.x + 9 * scale, f.y - 13 * scale, 17 * scale, 26 * scale);
  art.fillStyle(0x78b798);
  art.fillEllipse(f.x, f.y - 19 * scale, 15 * scale, 31 * scale);
}

function createThermalLayer(scene: Phaser.Scene, level: CampaignCase): Phaser.GameObjects.Container {
  const container = scene.add.container(0, 0).setDepth(10).setVisible(false);
  if (level.theme !== 'thermal') return container;
  const thermal = scene.add.graphics();
  const b = level.room.bounds;
  thermal.fillStyle(0x154589, 0.12);
  thermal.fillRect(b.x, b.y, b.width, b.height);
  const sources = level.equipment.filter((device) => ['window', 'door', 'heating'].includes(device.category));
  for (const source of sources) {
    const { x, y } = source.position;
    const vertical = source.category === 'window';
    const referenceWindow = source.id.endsWith('window-b');
    const controller = source.category === 'heating';
    for (let layer = 5; layer > 0; layer -= 1) {
      const color = referenceWindow || controller
        ? [0xffffff, 0xbff7e5, 0x91e6d5, 0x47baae, 0x288799, 0x2d538b][layer]
        : [0xffffff, 0xffed93, 0xffbf55, 0xed763e, 0xd44063, 0x963371][layer];
      thermal.fillStyle(color, 0.1 + (5 - layer) * 0.04);
      const size = referenceWindow || controller ? 0.67 : 1;
      thermal.fillEllipse(x, y, (vertical ? 20 + layer * 19 : 26 + layer * 23) * size, (vertical ? 40 + layer * 15 : 23 + layer * 14) * size);
    }
    thermal.lineStyle(1, referenceWindow || controller ? 0x93e3ce : 0xffdca0, 0.75);
    thermal.strokeCircle(x, y, 26);
  }
  const image = bake(scene, thermal, `campaign-${level.id}-thermal`, 10);
  const legend = scene.add.text(b.x + 22, b.y + 18, 'ТЕПЛОВОЙ СЛЕД\nУчебная иллюстрация, не измерение', {
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: '11px',
    color: '#ffdf9d', backgroundColor: '#111e32', padding: { x: 10, y: 7 },
  });
  const scale = scene.add.graphics();
  const scaleX = b.x + b.width - 217;
  scale.fillStyle(0x111e32, 0.92);
  scale.fillRoundedRect(scaleX, b.y + 18, 195, 45, 4);
  [0x288799, 0x47baae, 0xffbf55, 0xed763e, 0xd44063].forEach((color, index) => {
    scale.fillStyle(color, 0.85);
    scale.fillRect(scaleX + 13 + index * 33, b.y + 28, 31, 7);
  });
  const scaleText = scene.add.text(scaleX + 12, b.y + 40, 'МЕНЬШЕ ← СЛЕД → БОЛЬШЕ', {
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: '9px', color: '#bad0d9',
  });
  container.add([image, legend, scale, scaleText]);
  return container;
}
