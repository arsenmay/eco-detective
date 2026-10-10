import Phaser from 'phaser';
import type { Equipment, GameBridge, RoomController } from '../types';
import { RoomScene } from './RoomScene';

export function createRoom(parent: HTMLElement, equipment: readonly Equipment[], bridge: GameBridge): RoomController {
  const scene = new RoomScene(equipment, bridge);
  const mobileQuery = window.matchMedia('(pointer: coarse)');
  const isMobile = (): boolean => mobileQuery.matches || window.innerWidth <= 900;
  scene.setViewport(Math.max(1, parent.clientWidth), Math.max(1, parent.clientHeight), isMobile());
  const game = new Phaser.Game({
    // This small 2D room uses the broadly supported Canvas renderer; a GPU or
    // WebGL driver is not needed, including on classroom machines.
    type: Phaser.CANVAS,
    parent,
    width: Math.max(1, parent.clientWidth),
    height: Math.max(1, parent.clientHeight),
    backgroundColor: '#070f1c',
    scene: [scene],
    physics: { default: 'arcade', arcade: { debug: false } },
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true, pixelArt: false, roundPixels: false },
    fps: { target: 60, smoothStep: true },
    callbacks: {
      postBoot: (instance) => {
        instance.canvas.setAttribute('aria-label', 'Локация ECO DETECTIVE. Двигайтесь WASD или стрелками; E — осмотреть ближайший объект.');
        instance.canvas.setAttribute('role', 'img');
        instance.canvas.style.display = 'block';
      },
    },
  });

  // RESIZE gives the camera the actual visible pixels. World coordinates never
  // change when panels, phone orientation or the browser viewport change.
  const resize = (): void => {
    if (!game.isBooted || !game.canvas || parent.clientWidth < 1 || parent.clientHeight < 1) return;
    game.scale.setParentSize(parent.clientWidth, parent.clientHeight);
    scene.setViewport(parent.clientWidth, parent.clientHeight, isMobile());
  };
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : undefined;
  observer?.observe(parent);
  window.addEventListener('resize', resize);
  mobileQuery.addEventListener('change', resize);
  game.events.once(Phaser.Core.Events.READY, resize);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    observer?.disconnect();
    window.removeEventListener('resize', resize);
    mobileQuery.removeEventListener('change', resize);
  });

  return {
    setActive: (active) => scene.setActive(active),
    setPlayerPosition: (position) => scene.setPlayerPosition(position),
    setInspected: (ids) => scene.setInspected(ids),
    setTouchDirection: (direction, pressed) => scene.setTouchDirection(direction, pressed),
    setTouchVector: (vector) => scene.setTouchVector(vector),
    changeZoom: (delta) => scene.changeZoom(delta),
    setLevel: (level) => scene.setLevel(level),
    setThermalView: (enabled) => scene.setThermalView(enabled),
    interact: () => scene.interact(),
    setReducedMotion: (reduced) => scene.setReducedMotion(reduced),
    setEnergyPlan: (plan) => scene.setEnergyPlan(plan),
    setCampaignPlan: (plan) => scene.setCampaignPlan(plan),
    getPlayerPosition: () => scene.getPlayerPosition(),
  };
}
