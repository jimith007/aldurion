/** Small built-in list of major ad and tracker hosts. Extend with loadHostsList() using any hosts-format list (e.g. StevenBlack). */
export const AD_HOSTS = [
  "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com", "google-analytics.com", "googletagmanager.com", "googletagservices.com",
  "facebook.net", "connect.facebook.net", "taboola.com", "outbrain.com", "criteo.com", "criteo.net", "adnxs.com", "scorecardresearch.com", "quantserve.com",
  "hotjar.com", "amazon-adsystem.com", "rubiconproject.com", "pubmatic.com", "openx.net", "adsrvr.org", "moatads.com", "casalemedia.com", "advertising.com",
  "ads.twitter.com", "analytics.twitter.com", "ads.linkedin.com", "snap.licdn.com", "bat.bing.com", "clarity.ms", "segment.io", "mixpanel.com", "amplitude.com",
];

export const AD_COSMETIC_CSS = `[id^="google_ads"],[id*="AdSlot"],[class*="adsbygoogle"],ins.adsbygoogle,iframe[src*="doubleclick"],iframe[src*="googlesyndication"],[aria-label="Advertisement"],[data-ad-slot],.ad-banner,.ad-container,.advert,.sponsored-content{display:none!important}`;

export async function loadHostsList(url: string): Promise<string[]> {
  const text = await (await fetch(url)).text();
  return text.split("\n").map((l) => l.trim()).filter((l) => /^(0\.0\.0\.0|127\.0\.0\.1)\s+/.test(l)).map((l) => l.split(/\s+/)[1]).filter((h) => h && h !== "localhost" && !h.startsWith("0."));
}
