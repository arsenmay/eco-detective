import Phaser from 'phaser';
import type { Equipment, GameBridge, RoomController } from '../types';
import { RoomScene } from './RoomScene';
import { WORLD_HEIGHT, WORLD_WIDTH } from './roomArtwork';

export function createRoom(parent: HTMLElement, equipment: readonly Equipment[], bridge: GameBridge): RoomController {
  const scene = new RoomScene(equipment, bridge);
  const game = new Phaser.Game({
    // This small 2D room uses the broadly supported Canvas renderer; a GPU or
    // WebGL driver is not needed, including on classroom machines.
    type: Phaser.CANVAS,
    parent,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: '#070f1c',
    scene: [scene],
    physics: { default: 'arcade', arcade: { debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true, pixelArt: false, roundPixels: false },
    fps: { target: 60, smoothStep: true },
    callbacks: {
      postBoot: (instance) => {
        instance.canvas.setAttribute('aria-label', 'Кабинет информатики. Двигайтесь WASD или стрелками; E — осмотреть ближайшее оборудование.');
        instance.canvas.setAttribute('role', 'img');
        instance.canvas.style.display = 'block';
      },
    },
  });

  // FIT preserves the complete room on phones and when a side panel changes size.
  const resize = (): void => {
    if (!game.isBooted || !game.canvas || parent.clientWidth < 1 || parent.clientHeight < 1) return;
    game.scale.setParentSize(parent.clientWidth, parent.clientHeight);
  };
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : undefined;
  observer?.observe(parent);
  game.events.once(Phaser.Core.Events.READY, resize);
  game.events.once(Phaser.Core.Events.DESTROY, () => observer?.disconnect());

  return {
    setActive: (active) => scene.setActive(active),
    setPlayerPosition: (position) => scene.setPlayerPosition(position),
    setInspected: (ids) => scene.setInspected(ids),
    setTouchDirection: (direction, pressed) => scene.setTouchDirection(direction, pressed),
    interact: () => scene.interact(),
    setReducedMotion: (reduced) => scene.setReducedMotion(reduced),
    setEnergyPlan: (plan) => scene.setEnergyPlan(plan),
    getPlayerPosition: () => scene.getPlayerPosition(),
  };
}
