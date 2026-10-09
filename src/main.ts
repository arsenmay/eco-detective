import './style.css';
import { SCHOOL_CASE } from './data/schoolCase';
import { createRoom } from './game/createRoom';
import { GameUI } from './ui/GameUI';
import { setupLauncher } from './pwa';

const app = document.querySelector<HTMLElement>('#app')!;
const ui = new GameUI(app);
ui.connect(createRoom(ui.roomParent, SCHOOL_CASE.equipment, ui.bridge));
setupLauncher(app, {
  installGuide: () => ui.showInstallationGuide(),
  shareGuide: (url) => ui.showSharingGuide(url),
  notify: (message) => ui.showLauncherNotice(message),
  beforeReload: () => ui.saveBeforeReload(),
});
