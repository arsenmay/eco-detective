import './style.css';
import './ui/v3Theme.css';
import './ui/DeviceDetails.css';
import { CAMPAIGN_CASES } from './data/campaign';
import { createRoom } from './game/createRoom';
import { GameUI } from './ui/GameUI';
import { setupLauncher } from './pwa';

const app = document.querySelector<HTMLElement>('#app')!;
const ui = new GameUI(app);
ui.connect(createRoom(ui.roomParent, CAMPAIGN_CASES[0].equipment, ui.bridge));
setupLauncher(app, {
  installGuide: () => ui.showInstallationGuide(),
  shareGuide: (url) => ui.showSharingGuide(url),
  notify: (message) => ui.showLauncherNotice(message),
  beforeReload: () => ui.saveBeforeReload(),
});
