import Phaser from 'phaser';
import type { DetectiveFacing, DetectivePose } from './detectivePose';

const SCALE = 2;
const PREFIX = 'eco-detective-v3-';
type View = 'front' | 'back' | 'right';
type Part = 'head' | 'coat' | 'arm' | 'leg' | 'scanner';

const sizes: Record<Part, [number, number]> = {
  head: [44, 40], coat: [54, 48], arm: [22, 42], leg: [22, 31], scanner: [18, 28],
};

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, fill: string | CanvasGradient, stroke?: string): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

function line(ctx: CanvasRenderingContext2D, x: number, y: number, endX: number, endY: number, color: string, width = 1): void {
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(endX, endY); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient): void {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
}

function coat(ctx: CanvasRenderingContext2D, view: View): void {
  const gradient = ctx.createLinearGradient(7, 6, 44, 46);
  gradient.addColorStop(0, '#377f94'); gradient.addColorStop(0.4, '#246373'); gradient.addColorStop(1, '#143343');
  ctx.beginPath();
  if (view === 'right') {
    ctx.moveTo(18, 4); ctx.bezierCurveTo(26, 0, 37, 6, 38, 18); ctx.lineTo(42, 43); ctx.lineTo(19, 46); ctx.lineTo(13, 36); ctx.lineTo(14, 15);
  } else {
    ctx.moveTo(15, 5); ctx.bezierCurveTo(18, 0, 36, 0, 39, 5); ctx.lineTo(47, 15); ctx.lineTo(42, 23); ctx.lineTo(46, 43);
    ctx.quadraticCurveTo(38, 48, 27, 44); ctx.quadraticCurveTo(15, 48, 8, 43); ctx.lineTo(12, 23); ctx.lineTo(7, 15);
  }
  ctx.closePath(); ctx.fillStyle = gradient; ctx.fill(); ctx.strokeStyle = '#0c2131'; ctx.lineWidth = 1.5; ctx.stroke();
  const front = view !== 'back';
  if (front) {
    ctx.beginPath(); ctx.moveTo(20, 4); ctx.lineTo(26, 15); ctx.lineTo(33, 4); ctx.closePath(); ctx.fillStyle = '#122a3c'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(16, 6); ctx.lineTo(21, 19); ctx.lineTo(27, 14); ctx.lineTo(21, 3); ctx.closePath(); ctx.fillStyle = '#4290a0'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(37, 6); ctx.lineTo(31, 19); ctx.lineTo(27, 14); ctx.lineTo(32, 3); ctx.closePath(); ctx.fillStyle = '#225362'; ctx.fill();
    line(ctx, 26, 17, 27, 43, '#82d5cd', 0.9);
    for (const y of [21, 28, 36]) ellipse(ctx, 29, y, 1.05, 1.05, '#a4b3ad');
    rounded(ctx, 13, 27, 9, 9, 2, '#1a4754', '#46898e');
    rounded(ctx, 33, 27, 7, 9, 2, '#133948', '#39747f');
    rounded(ctx, 16, 17, 5, 7, 1, '#102c3a', '#5facac');
    line(ctx, 17, 19, 20, 19, '#a1eee2');
  } else {
    line(ctx, 27, 4, 27, 43, '#173f4d');
    ctx.beginPath(); ctx.moveTo(10, 16); ctx.quadraticCurveTo(27, 24, 44, 16); ctx.strokeStyle = '#43878d'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(21, 11); ctx.lineTo(27, 7); ctx.lineTo(33, 11); ctx.lineTo(31, 19); ctx.lineTo(27, 22); ctx.lineTo(23, 19); ctx.closePath();
    ctx.fillStyle = '#1b3e4c'; ctx.fill(); ctx.strokeStyle = '#7be2d2'; ctx.lineWidth = 0.8; ctx.stroke();
    line(ctx, 25, 11, 29, 17, '#a4ecda', 1.4); line(ctx, 29, 11, 25, 17, '#a4ecda', 1.4);
  }
  rounded(ctx, view === 'right' ? 15 : 11, 24, view === 'right' ? 25 : 32, 4, 1, '#0d2434');
  rounded(ctx, view === 'right' ? 27 : 24, 24.4, 6, 3.2, 0.8, '#9a9c83', '#d5d3b0');
  line(ctx, 11, 41, 20, 43, '#4ee0cc', 1.4); line(ctx, 35, 43, 42, 41, '#35baaf', 1.2);
  line(ctx, 14, 9, 10, 14, '#67b0b4', 0.9);
}

function head(ctx: CanvasRenderingContext2D, view: View): void {
  // The neck and three-quarter face remain upright in all views.
  rounded(ctx, 17, 27, 12, 11, 4, '#b58064', '#754f48');
  if (view === 'back') {
    const hair = ctx.createLinearGradient(10, 4, 30, 31); hair.addColorStop(0, '#3f5364'); hair.addColorStop(0.5, '#263747'); hair.addColorStop(1, '#152331');
    ellipse(ctx, 22, 17, 14, 16, hair);
    ctx.beginPath(); ctx.moveTo(11, 18); ctx.quadraticCurveTo(18, 26, 22, 30); ctx.quadraticCurveTo(31, 23, 33, 15); ctx.strokeStyle = '#182a37'; ctx.lineWidth = 2; ctx.stroke();
    for (const x of [14, 19, 25, 29]) { ctx.beginPath(); ctx.moveTo(x, 7); ctx.quadraticCurveTo(x + 5, 14, x + 1, 24); ctx.strokeStyle = '#4b6471'; ctx.lineWidth = 0.7; ctx.stroke(); }
    rounded(ctx, 7, 17, 4, 12, 2, '#162f3d', '#65b9bf'); line(ctx, 8, 19, 8, 25, '#7ae8d7', 1);
    return;
  }
  const skin = ctx.createLinearGradient(11, 12, 32, 33); skin.addColorStop(0, '#f2caa7'); skin.addColorStop(0.5, '#dcaa89'); skin.addColorStop(1, '#ae775f');
  ctx.beginPath();
  if (view === 'right') {
    ctx.moveTo(17, 9); ctx.bezierCurveTo(25, 6, 32, 14, 31, 19); ctx.lineTo(36, 24); ctx.lineTo(31, 26); ctx.quadraticCurveTo(31, 35, 23, 34); ctx.lineTo(14, 29); ctx.lineTo(12, 16);
  } else {
    ctx.moveTo(12, 11); ctx.bezierCurveTo(18, 4, 33, 8, 34, 17); ctx.lineTo(32, 29); ctx.quadraticCurveTo(22, 38, 14, 29); ctx.lineTo(10, 18);
  }
  ctx.closePath(); ctx.fillStyle = skin; ctx.fill(); ctx.strokeStyle = '#704b44'; ctx.lineWidth = 1; ctx.stroke();
  ellipse(ctx, view === 'right' ? 15 : 11, 24, 3, 4.5, '#c28d72');
  // A swept hair silhouette, not a helmet or a featureless circle.
  const hair = ctx.createLinearGradient(10, 2, 28, 22); hair.addColorStop(0, '#526477'); hair.addColorStop(0.45, '#2c3e50'); hair.addColorStop(1, '#142534');
  ctx.beginPath(); ctx.moveTo(10, 23); ctx.lineTo(7, 14); ctx.lineTo(9, 7); ctx.lineTo(15, 4); ctx.lineTo(18, 1); ctx.lineTo(26, 3); ctx.lineTo(33, 8); ctx.lineTo(35, 14);
  ctx.bezierCurveTo(29, 12, 28, 8, 26, 10); ctx.bezierCurveTo(23, 17, 16, 14, 15, 20); ctx.lineTo(15, 27); ctx.lineTo(11, 26); ctx.closePath();
  ctx.fillStyle = hair; ctx.fill(); ctx.strokeStyle = '#132535'; ctx.lineWidth = 1.1; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(12, 11); ctx.bezierCurveTo(18, 7, 22, 11, 27, 6); ctx.strokeStyle = '#7a8997'; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(14, 7); ctx.quadraticCurveTo(22, 4, 28, 7); ctx.strokeStyle = '#556b7c'; ctx.lineWidth = 0.8; ctx.stroke();
  if (view === 'right') {
    line(ctx, 25, 18, 30, 18, '#503b38', 1.1); ellipse(ctx, 29, 21, 1.2, 1.3, '#163345');
    line(ctx, 31, 29, 27, 30, '#814c45', 0.8);
    rounded(ctx, 19, 17, 12, 7, 2, '#52b9b8b0', '#b4e9d8'); line(ctx, 22, 18, 30, 18, '#d0fff0', 0.8);
  } else {
    line(ctx, 17, 18, 21, 18, '#503b38', 1.1); line(ctx, 27, 18, 31, 19, '#503b38', 1.1);
    ellipse(ctx, 19, 22, 1.05, 1.3, '#173247'); ellipse(ctx, 28, 22, 1.05, 1.3, '#173247');
    line(ctx, 24, 23, 23, 27, '#bd7e66', 0.8); line(ctx, 22, 30, 27, 30, '#8d5148', 0.8);
    rounded(ctx, 15, 19, 19, 6.5, 2, '#3eb6b445', '#8ad9d4'); line(ctx, 16, 20, 30, 20, '#d2fff299', 0.65);
  }
  rounded(ctx, 7, 19, 5, 10, 2, '#193241', '#497b8d'); rounded(ctx, 8.5, 21, 2, 5, 1, '#85f4d8');
  ctx.beginPath(); ctx.moveTo(10, 28); ctx.quadraticCurveTo(13, 34, 18, 32); ctx.strokeStyle = '#354c59'; ctx.lineWidth = 1.4; ctx.stroke(); ellipse(ctx, 18, 32, 1.5, 1.1, '#a1e8d5');
}

function arm(ctx: CanvasRenderingContext2D, view: View): void {
  const sleeve = ctx.createLinearGradient(5, 2, 17, 26); sleeve.addColorStop(0, '#347f90'); sleeve.addColorStop(0.6, '#245c6d'); sleeve.addColorStop(1, '#17384b');
  ctx.beginPath(); ctx.moveTo(6, 2); ctx.quadraticCurveTo(15, 0, 17, 8); ctx.lineTo(16, 26); ctx.lineTo(7, 27); ctx.lineTo(3, 9); ctx.closePath();
  ctx.fillStyle = sleeve; ctx.fill(); ctx.strokeStyle = '#102b3d'; ctx.lineWidth = 1.2; ctx.stroke();
  line(ctx, 5, 8, 8, 23, '#73c0c3', 0.8); rounded(ctx, 7, 25, 9, 4, 1.5, '#17303f', '#3e7480');
  rounded(ctx, 8, 28, 7, 9, 3, '#d1a287', '#8d6658');
  line(ctx, 10, 31, 10, 35, '#af7f69', 0.6); line(ctx, 12, 31, 12, 35, '#af7f69', 0.6);
  if (view !== 'back') { rounded(ctx, 7, 13, 6, 6, 1, '#245563'); line(ctx, 8, 14, 12, 14, '#76ded0', 0.9); }
}

function leg(ctx: CanvasRenderingContext2D, view: View): void {
  const pants = ctx.createLinearGradient(4, 1, 16, 26); pants.addColorStop(0, '#203442'); pants.addColorStop(1, '#0f202f');
  rounded(ctx, 7, 0, 9, 24, 3, pants, '#091b28');
  line(ctx, 8, 4, 9, 18, '#44616e', 0.7); line(ctx, 8, 15, 15, 16, '#152c3a', 0.8);
  const boot = ctx.createLinearGradient(4, 22, 19, 30); boot.addColorStop(0, '#334650'); boot.addColorStop(1, '#101e2a');
  rounded(ctx, view === 'right' ? 7 : 4, 22, view === 'right' ? 14 : 15, 8, 3, boot, '#081824');
  line(ctx, 5, 29, 19, 29, '#4c696f', 1); line(ctx, 8, 23, 14, 23, '#76bdb9', 0.8);
  if (view !== 'back') { line(ctx, 8, 25, 13, 25, '#658288', 0.8); line(ctx, 8, 27, 13, 27, '#658288', 0.8); }
}

function scanner(ctx: CanvasRenderingContext2D): void {
  rounded(ctx, 3, 3, 12, 22, 3, '#152a3d', '#466f7e');
  rounded(ctx, 5, 5, 8, 13, 1.5, '#247a79', '#69d6c4');
  const screen = ctx.createLinearGradient(5, 5, 13, 18); screen.addColorStop(0, '#9ff7df'); screen.addColorStop(1, '#39b7b3');
  rounded(ctx, 5.5, 5.5, 7, 12, 1, screen);
  line(ctx, 7, 10, 8, 13, '#277c7c', 0.9); line(ctx, 8, 13, 10, 8, '#277c7c', 0.9); line(ctx, 10, 8, 11, 10, '#277c7c', 0.9);
  ellipse(ctx, 9, 21, 1.5, 1.5, '#7c9b9f'); line(ctx, 6, 24, 12, 24, '#466973', 0.7);
}

function ensureTextures(scene: Phaser.Scene): void {
  for (const view of ['front', 'back', 'right'] as const) {
    for (const part of ['head', 'coat', 'arm', 'leg', 'scanner'] as const) {
      const key = `${PREFIX}${view}-${part}`;
      if (scene.textures.exists(key)) continue;
      const [width, height] = sizes[part];
      const texture = scene.textures.createCanvas(key, width * SCALE, height * SCALE);
      if (!texture) throw new Error('Could not create detective artwork.');
      const ctx = texture.context;
      ctx.scale(SCALE, SCALE); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (part === 'head') head(ctx, view);
      else if (part === 'coat') coat(ctx, view);
      else if (part === 'arm') arm(ctx, view);
      else if (part === 'leg') leg(ctx, view);
      else scanner(ctx);
      texture.refresh();
    }
  }
}

export type DetectiveArtwork = {
  visual: Phaser.GameObjects.Container;
  update: (facing: DetectiveFacing, pose: DetectivePose, time: number, reducedMotion: boolean) => void;
};

/** Original local canvas artwork, split into parts for readable upright animation. */
export function createDetectiveArtwork(scene: Phaser.Scene): DetectiveArtwork {
  ensureTextures(scene);
  const visual = scene.add.container(0, 0).setSize(54, 90);
  const shadow = scene.add.ellipse(0, 1, 37, 15, 0x030a14, 0.45);
  const ring = scene.add.ellipse(0, 1, 43, 20, 0x4de1ce, 0.045).setStrokeStyle(0.8, 0x6be3d2, 0.25);
  const figure = scene.add.container(0, 0);
  const makePart = (part: Part, x: number, y: number, originX = 0.5, originY = 0.5) => {
    const image = scene.add.image(x, y, `${PREFIX}front-${part}`).setOrigin(originX, originY);
    image.setDisplaySize(...sizes[part]);
    return image;
  };
  const farArm = makePart('arm', -18, -56, 0.5, 0.12);
  const farLeg = makePart('leg', -7, -29, 0.5, 0);
  const nearLeg = makePart('leg', 7, -29, 0.5, 0);
  const body = makePart('coat', 0, -37);
  const face = makePart('head', 0, -48, 0.5, 1);
  const nearArm = scene.add.container(18, -56);
  const armImage = makePart('arm', 0, 0, 0.5, 0.12);
  const device = makePart('scanner', 1, 31).setRotation(0.13);
  nearArm.add([armImage, device]);
  const scanBeam = scene.add.graphics();
  const badgeGlow = scene.add.circle(17, -35, 1.7, 0x9df8df, 0.75);
  figure.add([farArm, farLeg, nearLeg, body, face, nearArm, badgeGlow]);
  visual.add([shadow, ring, scanBeam, figure]);
  let currentFacing: DetectiveFacing | null = null;

  return {
    visual,
    update(facing, pose, time, reducedMotion) {
      if (facing !== currentFacing) {
        currentFacing = facing;
        const view: View = facing === 'left' ? 'right' : facing;
        const flip = facing === 'left';
        for (const [part, image] of [['head', face], ['coat', body], ['arm', farArm], ['arm', armImage], ['leg', farLeg], ['leg', nearLeg], ['scanner', device]] as const) {
          image.setTexture(`${PREFIX}${view}-${part}`).setFlipX(flip);
        }
        const side = facing === 'left' || facing === 'right';
        farArm.x = side ? (flip ? 7 : -7) : -18;
        nearArm.x = side ? (flip ? -10 : 10) : 18;
        farLeg.x = side ? -3 : -7; nearLeg.x = side ? 5 : 7;
        face.x = facing === 'left' ? -2 : facing === 'right' ? 2 : 0;
        device.x = flip ? -1 : 1;
      }
      const armSign = facing === 'left' ? -1 : 1;
      figure.y = pose.bob + pose.breathe;
      farLeg.y = -29 + pose.stride * 3.3;
      nearLeg.y = -29 - pose.stride * 3.3;
      farLeg.rotation = pose.stride * 0.055;
      nearLeg.rotation = -pose.stride * 0.055;
      farArm.rotation = pose.stride * 0.12 - pose.celebrate * 0.9;
      nearArm.rotation = (-pose.stride * 0.1 - pose.reach * 0.88 - pose.celebrate * 1.7) * armSign;
      face.y = -48 + pose.reach * 1.4 - pose.celebrate;
      ring.setAlpha(pose.scanning ? 1.1 : pose.celebrate ? 1.4 : reducedMotion ? 0.75 : 0.7 + Math.sin(time / 480) * 0.12);
      shadow.setScale(1 - Math.abs(pose.bob) * 0.025, 1);
      badgeGlow.setAlpha(reducedMotion ? 0.7 : 0.65 + Math.sin(time / 260) * 0.25);
      scanBeam.clear();
      if (pose.scanning) {
        const direction = facing === 'front' ? { x: 0.75, y: 0.66 }
          : facing === 'back' ? { x: -0.75, y: -0.66 }
          : { x: facing === 'left' ? -1 : 1, y: -0.1 };
        const cosine = Math.cos(nearArm.rotation);
        const sine = Math.sin(nearArm.rotation);
        const x = nearArm.x + device.x * cosine - device.y * sine;
        const y = nearArm.y + device.x * sine + device.y * cosine + figure.y;
        const targetX = x + direction.x * 64;
        const targetY = y + direction.y * 64;
        scanBeam.fillStyle(0x52ecd8, 0.06);
        scanBeam.fillTriangle(x, y, targetX - direction.y * 16, targetY + direction.x * 16, targetX + direction.y * 16, targetY - direction.x * 16);
        scanBeam.lineStyle(0.8, 0x79eddb, 0.28);
        const sweep = reducedMotion ? 0 : Math.sin(time / 360) * 10;
        scanBeam.lineBetween(x, y, targetX - direction.y * sweep, targetY + direction.x * sweep);
      }
    },
  };
}
