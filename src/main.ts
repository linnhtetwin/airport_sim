import './style.css';
import { Game } from './game';
import { configFromUrl, showStartScreen } from './ui/startScreen';

async function main() {
  const viewport = document.getElementById('viewport')!;
  const hud = document.getElementById('hud')!;
  const overlay = document.getElementById('overlay')!;

  const cfg = configFromUrl() ?? (await showStartScreen(overlay));
  overlay.innerHTML = `<div class="loading"><div class="spinner"></div><h2>Opening ${cfg.icao}…</h2><p data-el="status">Starting…</p></div>`;
  const status = overlay.querySelector<HTMLElement>('[data-el="status"]')!;
  const game = new Game(cfg, viewport, hud);
  (window as unknown as { game: Game }).game = game; // handy for debugging in the console
  try {
    await game.init((s) => (status.textContent = s));
    overlay.remove();
  } catch (e) {
    console.error(e);
    overlay.innerHTML = `<div class="loading error"><h2>Couldn't open ${cfg.icao}</h2><p>${String((e as Error).message ?? e)}</p><button onclick="location.href=location.pathname">Back</button></div>`;
  }
}

void main();
