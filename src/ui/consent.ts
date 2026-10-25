// Analytics consent (Google Consent Mode v2). index.html sets every consent signal to
// "denied" before GA4 loads; this banner records the player's choice and updates GA4.

import { lsGet, lsSet } from '../data/cache';

type Choice = 'granted' | 'denied';
const KEY = 'aos:consent';

declare global {
  interface Window { gtag?: (...args: unknown[]) => void }
}

export const consentChoice = (): Choice | null => {
  const v = lsGet(KEY);
  return v === 'granted' || v === 'denied' ? v : null;
};

function apply(choice: Choice) {
  lsSet(KEY, choice);
  window.gtag?.('consent', 'update', { analytics_storage: choice });
  if (choice === 'denied') clearAnalyticsCookies();
}

/** Remove GA cookies left from an earlier "accept" (they'd otherwise linger until expiry). */
function clearAnalyticsCookies() {
  const host = location.hostname;
  const domains = ['', host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`];
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (!/^_ga(_|$)|^_gid$|^_gat/.test(name)) continue;
    for (const d of domains) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d ? `; domain=${d}` : ''}`;
    }
  }
}

/** Show the banner (always when `force`, otherwise only if the player hasn't chosen yet). */
export function showConsentBanner(force = false) {
  if (!force && consentChoice()) return;
  document.querySelector('.consent')?.remove();
  const el = document.createElement('div');
  el.className = 'consent';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Analytics cookies');
  el.innerHTML = `
    <div class="consent-text">
      <b>🍪 Analytics cookies</b>
      <p>We'd like to use Google Analytics cookies to see which airports and features players use, so we can improve the game.
      No ads, and nothing is set unless you accept. You can change this later in ⚙ Settings.</p>
    </div>
    <div class="consent-actions">
      <button data-consent="denied">Decline</button>
      <button data-consent="granted" class="accept">Accept</button>
    </div>`;
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-consent]');
    if (!b) return;
    apply(b.dataset.consent as Choice);
    el.remove();
  });
  document.body.appendChild(el);
}
