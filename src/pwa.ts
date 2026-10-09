import { registerSW } from 'virtual:pwa-register';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type LauncherCallbacks = {
  installGuide: () => void;
  shareGuide: (url: string | null) => void;
  notify: (message: string) => void;
  beforeReload: () => void;
};

/** Installation and sharing use browser capabilities, never a backend or account. */
export function setupLauncher(root: HTMLElement, callbacks: LauncherCallbacks): void {
  const installButton = root.querySelector<HTMLButtonElement>('#install-game')!;
  const shareButton = root.querySelector<HTMLButtonElement>('#share-game')!;
  const status = root.querySelector<HTMLElement>('#offline-status')!;
  let installPrompt: InstallPromptEvent | null = null;
  const standalone = (): boolean => window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;

  const updateInstalledState = (): void => { installButton.hidden = standalone(); };
  updateInstalledState();
  window.matchMedia('(display-mode: standalone)').addEventListener('change', updateInstalledState);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); installPrompt = event as InstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null; installButton.hidden = true;
    callbacks.notify('Игра установлена. Открывайте её значком приложения.');
  });

  installButton.addEventListener('click', async () => {
    if (!installPrompt) { callbacks.installGuide(); return; }
    const prompt = installPrompt; installPrompt = null;
    installButton.disabled = true;
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') callbacks.notify('Браузер принял запрос на установку.');
    } catch {
      callbacks.installGuide();
    } finally {
      installButton.disabled = false;
    }
  });

  shareButton.addEventListener('click', async () => {
    const address = new URL(import.meta.env.BASE_URL, window.location.origin);
    if (['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)) {
      callbacks.shareGuide(null); return;
    }
    const url = address.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'ECO DETECTIVE', text: 'Раскройте тайну пропавшей энергии!', url });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      callbacks.notify('Ссылка на игру скопирована. Отправьте её друзьям.');
    } catch {
      callbacks.shareGuide(url);
    }
  });

  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) {
    status.textContent = 'Офлайн-запуск доступен в опубликованной HTTPS-версии';
    return;
  }
  status.textContent = 'Подготавливаем игру для запуска без интернета…';
  const markOfflineReady = (): void => { status.textContent = 'Готова к игре без интернета'; };
  // A previously installed worker already holds the complete app cache.
  navigator.serviceWorker.ready.then((registration) => {
    if (registration.scope === new URL(import.meta.env.BASE_URL, location.origin).href) markOfflineReady();
  }).catch(() => { /* Registration callback reports errors. */ });
  const updateSW = registerSW({
    immediate: true,
    onOfflineReady: markOfflineReady,
    onNeedRefresh: () => {
      const notice = document.createElement('div');
      notice.className = 'update-notice'; notice.setAttribute('role', 'status');
      const message = document.createElement('span'); message.textContent = 'Доступна новая версия игры';
      const update = document.createElement('button'); update.className = 'button primary'; update.textContent = 'Обновить';
      const later = document.createElement('button'); later.className = 'button secondary'; later.textContent = 'Позже';
      update.addEventListener('click', () => { callbacks.beforeReload(); void updateSW(true); });
      later.addEventListener('click', () => notice.remove());
      notice.append(message, update, later); root.append(notice);
    },
    onRegisterError: () => { status.textContent = 'Офлайн-копию сохранить не удалось. Игра доступна с интернетом.'; },
  });
}
