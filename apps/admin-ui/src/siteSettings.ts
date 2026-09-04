/** Site appearance settings shared by the Settings General tab and AdminLayout.
 * ponytail: localStorage-backed until the real settings API (Task 5+) lands. */
export const SITE_SETTINGS_KEY = 'accessbase.site-settings';
/** Same-tab writes do not fire 'storage'; dispatch this so the layout re-reads immediately. */
export const SITE_SETTINGS_EVENT = 'site-settings-updated';

export interface SiteSettings {
  siteName: string;
  logoUrl: string;
}

export function loadSiteSettings(): SiteSettings {
  try {
    const raw = localStorage.getItem(SITE_SETTINGS_KEY);
    if (raw) return JSON.parse(raw as string) as SiteSettings;
  } catch {
    // corrupted storage → defaults
  }
  return { siteName: '', logoUrl: '' };
}

export function saveSiteSettings(settings: SiteSettings): void {
  localStorage.setItem(SITE_SETTINGS_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event(SITE_SETTINGS_EVENT));
}
