import Phaser from 'phaser';
import type { EnergyPlan, Point } from '../types';

export const WORLD_WIDTH = 1120;
export const WORLD_HEIGHT = 760;
export const ROOM_BOUNDS = { x: 112, y: 126, width: 896, height: 548 };
export const SPAWN: Point = { x: 870, y: 600 };

export type SolidRect = { x: number; y: number; width: number; height: number };

/** Walkable aisles are intentionally wider than the investigator's body. */
export const FURNITURE: readonly SolidRect[] = [
  { x: 330, y: 285, width: 130, height: 64 },
  { x: 550, y: 285, width: 130, height: 64 },
  { x: 330, y: 455, width: 130, height: 64 },
  { x: 550, y: 455, width: 130, height: 64 },
  { x: 365, y: 341, width: 32, height: 24 },
  { x: 585, y: 341, width: 32, height: 24 },
  { x: 365, y: 511, width: 32, height: 24 },
  { x: 585, y: 511, width: 32, height: 24 },
  { x: 823, y: 176, width: 168, height: 62 },
  { x: 556, y: 152, width: 282, height: 34 },
  { x: 990, y: 361, width: 34, height: 114 },
  { x: 163, y: 619, width: 36, height: 38 },
  { x: 239, y: 545, width: 34, height: 27 },
  { x: 699, y: 609, width: 38, height: 34 },
];

export function safePlayerPosition(position: Point): Point {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return { ...SPAWN };
  const radius = 13;
  const clamped = {
    x: Phaser.Math.Clamp(position.x, ROOM_BOUNDS.x + radius, ROOM_BOUNDS.x + ROOM_BOUNDS.width - radius),
    y: Phaser.Math.Clamp(position.y, ROOM_BOUNDS.y + radius, ROOM_BOUNDS.y + ROOM_BOUNDS.height - radius),
  };
  if (FURNITURE.some((rect) =>
    Math.abs(clamped.x - rect.x) < rect.width / 2 + radius
    && Math.abs(clamped.y - rect.y) < rect.height / 2 + radius,
  )) return { ...SPAWN };
  return clamped;
}

function label(scene: Phaser.Scene, x: number, y: number, text: string, size = 11, color = '#8da3b8') {
  return scene.add.text(x, y, text, {
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    fontSize: `${size}px`, color, letterSpacing: 1,
  }).setDepth(9);
}

function computer(art: Phaser.GameObjects.Graphics, x: number, y: number, bright = true): void {
  art.fillStyle(0x07101b, 0.8);
  art.fillRoundedRect(x - 24, y - 22, 51, 35, 5);
  art.fillStyle(0x293b50);
  art.fillRoundedRect(x - 23, y - 25, 47, 31, 4);
  art.fillStyle(bright ? 0x49c8be : 0x254555);
  art.fillRoundedRect(x - 19, y - 21, 39, 22, 2);
  art.fillStyle(bright ? 0xa6f7e2 : 0x42717b, 0.65);
  art.fillRect(x - 15, y - 17, 23, 2);
  art.fillRect(x - 15, y - 11, 16, 2);
  art.fillRect(x - 15, y - 5, 27, 1);
  art.fillStyle(0x152235);
  art.fillRect(x - 3, y + 6, 7, 6);
  art.fillRoundedRect(x - 12, y + 10, 24, 4, 2);
  art.fillStyle(0x182738);
  art.fillRoundedRect(x - 23, y + 19, 46, 13, 3);
  art.lineStyle(1, 0x455971, 0.7);
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      art.strokeRect(x - 19 + column * 5, y + 22 + row * 4, 3, 2);
    }
  }
  art.fillStyle(0x708b9c);
  art.fillEllipse(x + 30, y + 24, 9, 13);
}

function workstation(art: Phaser.GameObjects.Graphics, x: number, y: number, two = true): void {
  // Low side faces and the offset shadow give the desks a little depth without
  // obscuring the walkable aisles of this deliberately top-down scene.
  art.fillStyle(0x020713, 0.55);
  art.fillRoundedRect(x - 76, y - 25, 154, 71, 9);
  art.fillStyle(0x1b2d43);
  art.fillRoundedRect(x - 70, y - 32, 140, 68, 7);
  art.fillStyle(0x44546b);
  art.fillRoundedRect(x - 70, y - 36, 140, 65, 6);
  art.fillStyle(0x35465b);
  art.fillRoundedRect(x - 67, y - 33, 134, 59, 5);
  art.fillStyle(0x6f8495, 0.16);
  art.fillRoundedRect(x - 65, y - 31, 130, 8, 3);
  art.fillStyle(0x182739);
  art.fillRoundedRect(x - 66, y + 25, 132, 5, 2);
  art.lineStyle(1, 0x63768c, 0.6);
  art.strokeRoundedRect(x - 69, y - 35, 138, 63, 6);
  art.lineStyle(2, 0x0b1b2d, 0.7);
  art.lineBetween(x, y - 32, x, y + 26);
  if (two) {
    computer(art, x - 36, y - 4);
    computer(art, x + 34, y - 4);
  } else {
    computer(art, x - 31, y - 4);
    art.fillStyle(0x263c4f);
    art.fillRoundedRect(x + 18, y - 21, 31, 36, 3);
    art.fillStyle(0x4ce1c5);
    art.fillRect(x + 22, y - 17, 23, 3);
    art.fillStyle(0x809da7);
    art.fillRect(x + 22, y - 8, 16, 2);
    art.fillRect(x + 22, y - 2, 19, 2);
  }
  // The chair sits to the side of each investigation marker.
  art.fillStyle(0x020713, 0.5);
  art.fillEllipse(x + 35, y + 63, 40, 28);
  art.fillStyle(0x26405d);
  art.fillRoundedRect(x + 18, y + 42, 34, 25, 7);
  art.fillStyle(0x446786);
  art.fillRoundedRect(x + 16, y + 57, 38, 9, 3);
  art.lineStyle(2, 0x648399, 0.65);
  art.lineBetween(x + 20, y + 44, x + 49, y + 44);

  // Cable clips, a PC tower at the far edge and a warm paper detail keep the
  // otherwise technical room feeling like a classroom people actually use.
  art.fillStyle(0x142235);
  art.fillRoundedRect(x + 52, y - 29, 11, 38, 2);
  art.fillStyle(0x536779);
  art.fillRect(x + 55, y - 24, 5, 1);
  art.fillRect(x + 55, y - 19, 5, 1);
  art.fillStyle(0x74e5be);
  art.fillCircle(x + 57, y + 2, 1.3);
  art.fillStyle(0xe1cba0, 0.75);
  art.fillRoundedRect(x - 60, y + 14, 12, 10, 1);
}

function plant(art: Phaser.GameObjects.Graphics, x: number, y: number): void {
  art.fillStyle(0x06101b, 0.5);
  art.fillEllipse(x + 6, y + 8, 56, 27);
  art.fillStyle(0x667e87);
  art.fillRoundedRect(x - 18, y - 8, 36, 34, 6);
  art.fillStyle(0x314351);
  art.fillEllipse(x, y - 8, 38, 19);
  art.fillStyle(0x42856e);
  art.fillEllipse(x - 10, y - 24, 20, 37);
  art.fillEllipse(x + 13, y - 19, 21, 36);
  art.fillStyle(0x69b69a);
  art.fillEllipse(x, y - 33, 18, 41);
  art.fillStyle(0x335e58);
  art.fillEllipse(x + 1, y - 14, 30, 19);
}

function cacheArtwork(scene: Phaser.Scene, art: Phaser.GameObjects.Graphics, key: string, depth: number): Phaser.GameObjects.Image {
  art.generateTexture(key, WORLD_WIDTH, WORLD_HEIGHT);
  const image = scene.add.image(0, 0, key).setOrigin(0).setDepth(depth);
  art.destroy();
  return image;
}

export type RoomArtwork = {
  lighting: Phaser.GameObjects.Image;
  standbyScreens: Phaser.GameObjects.Image;
  modelLabel: Phaser.GameObjects.Text;
  scanningLine: Phaser.GameObjects.Rectangle;
};

/** Original artwork is generated once and never needs a downloaded asset. */
export function drawRoom(scene: Phaser.Scene): RoomArtwork {
  const floor = scene.add.graphics().setDepth(0);
  floor.fillStyle(0x070f1c);
  floor.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  floor.fillStyle(0x040913, 0.6);
  floor.fillRoundedRect(87, 108, 958, 605, 16);
  floor.fillStyle(0x213348);
  floor.fillRoundedRect(80, 88, 964, 611, 10);
  floor.fillStyle(0x16263b);
  floor.fillRect(110, 121, 902, 555);

  for (let row = 0; row < 12; row += 1) {
    for (let column = 0; column < 19; column += 1) {
      const x = 112 + column * 48;
      const y = 126 + row * 48;
      floor.fillStyle((row + column) % 2 === 0 ? 0x1c2d42 : 0x192a3e, 0.72);
      floor.fillRect(x, y, Math.min(46, 1008 - x), Math.min(46, 674 - y));
    }
  }
  floor.lineStyle(1, 0x40516a, 0.16);
  for (let x = 112; x <= 1008; x += 48) floor.lineBetween(x, 126, x, 674);
  for (let y = 126; y <= 674; y += 48) floor.lineBetween(112, y, 1008, y);
  floor.lineStyle(2, 0x34495e, 0.5);
  floor.strokeRect(122, 136, 876, 528);

  // Furniture islands and technical aisle markings add a clear spatial rhythm.
  for (const [x, y] of [[330, 285], [550, 285], [330, 455], [550, 455]] as const) {
    floor.fillStyle(0x0d1b2b, 0.35);
    floor.fillRoundedRect(x - 84, y - 46, 170, 116, 10);
    floor.lineStyle(1, 0x7395a4, 0.12);
    floor.strokeRoundedRect(x - 84, y - 46, 170, 116, 10);
  }
  floor.lineStyle(1, 0x43c9be, 0.15);
  for (let x = 744; x < 924; x += 19) floor.lineBetween(x, 625, x + 8, 625);
  for (let y = 296; y < 588; y += 20) floor.lineBetween(748, y, 748, y + 7);
  floor.lineStyle(2, 0x60e8d0, 0.3);
  for (const [x, y, sx, sy] of [[127, 140, 1, 1], [994, 140, -1, 1], [127, 660, 1, -1], [994, 660, -1, -1]]) {
    floor.lineBetween(x, y, x + sx * 19, y);
    floor.lineBetween(x, y, x, y + sy * 19);
  }

  // Three invented windows illuminate the room from the west wall.
  for (const y of [219, 348, 477]) {
    for (let layer = 0; layer < 5; layer += 1) {
      floor.fillStyle(0x62c8db, 0.024);
      floor.fillPoints([
        new Phaser.Geom.Point(112, y - 25 + layer * 2),
        new Phaser.Geom.Point(112, y + 41 - layer * 2),
        new Phaser.Geom.Point(385 - layer * 23, y + 117 - layer * 9),
        new Phaser.Geom.Point(390 - layer * 25, y + 6 + layer * 3),
      ], true);
    }
    floor.fillStyle(0x0b1526);
    floor.fillRect(88, y - 33, 25, 95);
    floor.fillStyle(0x5397b4);
    floor.fillRect(95, y - 29, 13, 87);
    floor.fillStyle(0xa5deec, 0.75);
    floor.fillRect(99, y - 26, 5, 81);
    floor.fillStyle(0x243d55);
    floor.fillRect(90, y + 10, 23, 4);
    floor.fillRect(90, y + 56, 23, 5);
    floor.lineStyle(1, 0x94d8e5, 0.5);
    floor.lineBetween(110, y - 29, 110, y + 58);
  }

  const art = scene.add.graphics().setDepth(6);
  // Upper wall and its horizontal technical strip.
  art.fillStyle(0x314359);
  art.fillRoundedRect(80, 87, 964, 37, 8);
  art.fillStyle(0x202f45);
  art.fillRect(112, 105, 896, 19);
  art.lineStyle(2, 0x718297, 0.3);
  art.lineBetween(100, 89, 1025, 89);
  art.lineStyle(1, 0x4fe2cd, 0.38);
  art.lineBetween(120, 121, 999, 121);
  art.fillStyle(0x24364b);
  art.fillRect(1008, 124, 28, 552);
  art.fillStyle(0x32455a);
  art.fillRect(1018, 124, 17, 552);
  art.fillStyle(0x24364b);
  art.fillRect(82, 124, 28, 552);

  // Small wall fixtures: ventilation, clock and a classroom materials shelf.
  art.fillStyle(0x101e2e);
  art.fillRoundedRect(130, 93, 63, 18, 3);
  art.lineStyle(1, 0x7390a0, 0.5);
  for (let x = 137; x <= 185; x += 6) art.lineBetween(x, 97, x, 106);
  art.fillStyle(0x111d2e);
  art.fillCircle(712, 107, 11);
  art.lineStyle(1, 0x85a3b3, 0.7);
  art.strokeCircle(712, 107, 9);
  art.lineBetween(712, 107, 712, 101);
  art.lineBetween(712, 107, 717, 110);
  art.fillStyle(0x425467);
  art.fillRoundedRect(279, 91, 89, 16, 3);
  for (let index = 0; index < 7; index += 1) {
    art.fillStyle([0x638b96, 0x957f66, 0x416a82, 0x73a094][index % 4]);
    art.fillRoundedRect(284 + index * 10, 91, 7, 12, 1);
  }
  for (const y of [219, 348, 477]) {
    art.fillStyle(0x0b1526);
    art.fillRect(88, y - 33, 25, 95);
    art.fillStyle(0x5397b4);
    art.fillRect(95, y - 29, 13, 87);
    art.fillStyle(0xa5deec, 0.75);
    art.fillRect(99, y - 26, 5, 81);
    art.fillStyle(0x243d55);
    art.fillRect(90, y + 10, 23, 4);
    art.fillRect(90, y + 56, 23, 5);
    art.lineStyle(1, 0x94d8e5, 0.5);
    art.lineBetween(110, y - 29, 110, y + 58);
  }

  // Blackboard and a small timetable.
  art.fillStyle(0x080f1c, 0.5);
  art.fillRoundedRect(407, 136, 298, 46, 5);
  art.fillStyle(0x49616e);
  art.fillRoundedRect(410, 127, 292, 48, 4);
  art.fillStyle(0x173c43);
  art.fillRoundedRect(414, 131, 284, 38, 2);
  art.lineStyle(1, 0x89b6ad, 0.65);
  art.lineBetween(435, 145, 504, 145);
  art.lineBetween(435, 151, 536, 151);
  art.lineBetween(435, 157, 487, 157);
  art.strokeRect(603, 140, 70, 20);
  art.lineBetween(605, 150, 671, 150);
  art.lineBetween(627, 142, 627, 158);
  art.lineBetween(651, 142, 651, 158);
  art.fillStyle(0xbacbc2);
  art.fillRect(673, 169, 12, 2);

  // Teacher's table: projector, papers, an open notebook and a mug.
  art.fillStyle(0x050c18, 0.55);
  art.fillRoundedRect(734, 155, 181, 70, 8);
  art.fillStyle(0x46546b);
  art.fillRoundedRect(734, 143, 178, 64, 6);
  art.fillStyle(0x394a60);
  art.fillRoundedRect(738, 147, 170, 56, 4);
  art.lineStyle(1, 0x627488, 0.55);
  art.strokeRoundedRect(735, 143, 176, 64, 6);
  art.fillStyle(0x8299a7);
  art.fillRoundedRect(789, 157, 63, 37, 6);
  art.fillStyle(0x13243a);
  art.fillCircle(831, 174, 11);
  art.fillStyle(0x45d6da);
  art.fillCircle(831, 174, 6);
  art.lineStyle(1, 0xd9eeeb, 0.65);
  art.strokeCircle(831, 174, 8);
  art.lineStyle(1, 0x314c62, 0.7);
  for (let x = 797; x < 810; x += 4) art.lineBetween(x, 162, x, 184);
  art.fillStyle(0xbfbd9f);
  art.fillRoundedRect(748, 153, 30, 34, 2);
  art.lineStyle(1, 0x777a69, 0.7);
  art.lineBetween(754, 160, 770, 160);
  art.lineBetween(754, 166, 770, 166);
  art.fillStyle(0x577a91);
  art.fillCircle(886, 175, 9);
  art.fillStyle(0x172b40);
  art.fillCircle(886, 175, 6);

  // A soft optical cone is illustrative; the lesson projector stays available.
  floor.fillStyle(0x79c9ee, 0.032);
  floor.fillPoints([
    new Phaser.Geom.Point(831, 171), new Phaser.Geom.Point(676, 135),
    new Phaser.Geom.Point(675, 164), new Phaser.Geom.Point(831, 178),
  ], true);

  workstation(art, 330, 285);
  workstation(art, 550, 285);
  workstation(art, 330, 455, false);
  workstation(art, 550, 455);

  // A wall-mounted router rack, with visible status LEDs.
  art.fillStyle(0x061020, 0.6);
  art.fillRoundedRect(969, 309, 40, 123, 5);
  art.fillStyle(0x415268);
  art.fillRoundedRect(974, 301, 33, 117, 4);
  art.fillStyle(0x14283d);
  art.fillRoundedRect(978, 305, 25, 109, 3);
  for (let row = 0; row < 6; row += 1) {
    art.fillStyle(0x3c5067);
    art.fillRoundedRect(980, 310 + row * 16, 21, 12, 2);
    art.fillStyle(0x6bf2bd);
    art.fillCircle(984, 316 + row * 16, 1.5);
    art.lineStyle(1, 0x14253b);
    art.lineBetween(990, 314 + row * 16, 998, 314 + row * 16);
    art.lineBetween(990, 318 + row * 16, 998, 318 + row * 16);
  }
  art.lineStyle(2, 0x44576a, 0.9);
  art.lineBetween(989, 302, 989, 280);
  art.lineBetween(989, 280, 960, 280);
  art.lineBetween(960, 280, 960, 250);
  art.fillStyle(0x56748a);
  art.fillRoundedRect(947, 234, 25, 16, 3);
  art.lineStyle(2, 0x7c95a6);
  art.lineBetween(950, 235, 946, 221);
  art.lineBetween(969, 235, 973, 221);

  // Noticeboard and a restrained technical drawing on the east wall.
  art.fillStyle(0x405368);
  art.fillRoundedRect(970, 490, 36, 92, 3);
  art.fillStyle(0x153140);
  art.fillRect(974, 494, 28, 84);
  art.lineStyle(1, 0x4eacb0, 0.7);
  art.strokeRect(980, 502, 16, 17);
  art.lineBetween(988, 519, 988, 535);
  art.lineBetween(980, 535, 996, 535);
  art.strokeCircle(981, 548, 3);
  art.strokeCircle(995, 548, 3);

  plant(art, 163, 619);
  // Bag, notebooks and an empty stool complete the inhabited classroom.
  art.fillStyle(0x26374d);
  art.fillRoundedRect(222, 532, 34, 27, 7);
  art.lineStyle(2, 0x597386, 0.7);
  art.strokeRoundedRect(229, 524, 18, 18, 4);
  art.fillStyle(0x58758a);
  art.fillRoundedRect(680, 592, 38, 34, 7);
  art.fillStyle(0x35495f);
  art.fillRoundedRect(684, 594, 30, 26, 4);

  // Daylight sensor and pinboard notes are decor, not additional evidence.
  art.fillStyle(0x576b7c);
  art.fillRoundedRect(127, 559, 15, 26, 3);
  art.fillStyle(0x57cfc0);
  art.fillRoundedRect(131, 564, 7, 7, 2);
  art.fillStyle(0xd5c59c);
  art.fillRoundedRect(976, 560, 9, 13, 1);
  art.fillStyle(0x92b5bb);
  art.fillRoundedRect(988, 559, 10, 14, 1);
  art.lineStyle(1, 0x4d7285, 0.8);
  art.lineBetween(978, 564, 982, 564);
  art.lineBetween(990, 564, 995, 564);

  // The doorway is an illustration; this prototype has one room.
  art.fillStyle(0x324459);
  art.fillRoundedRect(80, 674, 964, 25, 5);
  art.fillStyle(0x0d1b2d);
  art.fillRect(817, 674, 104, 25);
  art.lineStyle(2, 0x728a9b, 0.6);
  art.lineBetween(817, 680, 921, 680);
  art.lineStyle(1, 0x52d4bd, 0.45);
  art.strokeRect(826, 682, 87, 10);
  art.fillStyle(0x2be0bc, 0.7);
  art.fillRoundedRect(853, 676, 36, 4, 2);

  const light = scene.add.graphics().setDepth(8);
  for (const [x, y, width] of [[326, 207, 108], [552, 207, 108], [324, 570, 108], [810, 415, 126]] as const) {
    light.fillStyle(0xbcf5ec, 0.045);
    light.fillEllipse(x, y + 22, width + 40, 86);
    light.fillStyle(0x0a1625, 0.35);
    light.fillRoundedRect(x - width / 2 - 3, y - 6, width + 6, 18, 5);
    light.fillStyle(0x779495);
    light.fillRoundedRect(x - width / 2, y - 7, width, 12, 4);
    light.fillStyle(0xd2f5df, 0.9);
    light.fillRoundedRect(x - width / 2 + 4, y - 5, width - 8, 6, 2);
  }

  label(scene, 112, 47, 'ЛАБОРАТОРИЯ ИНФОРМАТИКИ', 12, '#afc4d6');
  label(scene, 874, 47, 'SECTOR A / 01', 11, '#4dcab6');
  label(scene, 230, 152, 'СЕГОДНЯ\nЭНЕРГИЯ = P × t', 9, '#7d9aad');
  label(scene, 123, 717, 'УЧЕБНАЯ МОДЕЛЬ • КАБИНЕТ A-01', 10, '#657e96');
  label(scene, 822, 717, 'ОБЪЕКТЫ: 01—06', 10, '#658a96');
  label(scene, 467, 601, 'РАБОЧАЯ ЗОНА', 10, '#506c80');

  label(scene, 215, 647, 'СВЕТ / ДНЕВНОЙ РЕЖИМ', 9, '#5d7f91');
  const modelLabel = label(scene, 112, 68, 'СКАНИРОВАНИЕ УЧЕБНОЙ МОДЕЛИ', 10, '#4a8a9a');

  // The six student screens can enter the fictional planned standby mode.
  // The teacher's PC, projector and network deliberately remain unchanged.
  const screens = scene.add.graphics();
  for (const [x, y] of [[294, 281], [364, 281], [514, 281], [584, 281], [514, 451], [584, 451]] as const) {
    screens.fillStyle(0x071725, 0.95);
    screens.fillRoundedRect(x - 19, y - 21, 39, 22, 2);
    screens.fillStyle(0x5dafa6, 0.8);
    screens.fillCircle(x + 2, y - 10, 4);
    screens.fillStyle(0x071725, 0.98);
    screens.fillCircle(x + 4, y - 12, 4);
  }
  const standbyScreens = cacheArtwork(scene, screens, 'lab-standby-screens', 7).setAlpha(0);
  const scanningLine = scene.add.rectangle(112, 126, 896, 1, 0x65edda, 0.1)
    .setOrigin(0, 0).setDepth(5);

  // Bake the many small original drawing commands once; each frame only draws
  // a few room textures. This keeps software-rendered mobile scenes fast.
  cacheArtwork(scene, floor, 'lab-floor', 0);
  cacheArtwork(scene, art, 'lab-furniture', 6);
  return { lighting: cacheArtwork(scene, light, 'lab-lighting', 8), standbyScreens, modelLabel, scanningLine };
}

export function applyRoomEnergyPlan(artwork: RoomArtwork, plan: EnergyPlan | null): void {
  const standby = plan !== null && plan.computerHours < 10;
  artwork.standbyScreens.setAlpha(standby ? 0.9 : 0);
  artwork.modelLabel.setText(plan
    ? `РЕЖИМ МОДЕЛИ · ПК ${plan.computerHours} Ч / СВЕТ ${plan.lightingHours} Ч`
    : 'СКАНИРОВАНИЕ УЧЕБНОЙ МОДЕЛИ');
  artwork.modelLabel.setColor(plan ? '#72d9b9' : '#4a8a9a');
}
