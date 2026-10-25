import './style.css';
import { Game } from './game';
import { configFromUrl, showStartScreen } from './ui/startScreen';
import { showConsentBanner } from './ui/consent';
import { LoadingScreen } from './ui/loading';

async function main() {
  const viewport = document.getElementById('viewport')!;
  const hud = document.getElementById('hud')!;
  const overlay = document.getElementById('overlay')!;

  showConsentBanner();
  // any "Cookie settings" link (start screen, settings dialog) reopens the banner
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-consent-open]')) return;
    e.preventDefault();
    showConsentBanner(true);
  });

  const cfg = configFromUrl() ?? (await showStartScreen(overlay));
  const loading = new LoadingScreen(overlay, cfg.icao, cfg.preset ? `${cfg.preset.name} · ${cfg.preset.city}` : undefined);
  const game = new Game(cfg, viewport, hud);
  (window as unknown as { game: Game }).game = game; // handy for debugging in the console
  try {
    await game.init(loading);
    await loading.finish();
    overlay.remove();
  } catch (e) {
    console.error(e);
    loading.dispose();
    overlay.innerHTML = `<div class="loading error"><h2>Couldn't open ${cfg.icao}</h2><p>${String((e as Error).message ?? e)}</p><button onclick="location.href=location.pathname">Back</button></div>`;
  }
}

void main();
