import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

const PLAYBACK_HOSTS = [
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "spotify.com",
  "spotify.link",
  "soundcloud.com",
  "bandcamp.com",
  "vimeo.com",
  "twitch.tv",
  "nicovideo.jp"
];

export function assertSingleMediaLink(input: string) {
  const links =
    input.match(
      /(?:https?:\/\/[^\s<>()]+|(?:www\.|music\.)?(?:youtube\.com|youtu\.be|open\.spotify\.com)\/[^\s<>()]+|spotify:(?:track|playlist|album):[A-Za-z0-9]+)/gi
    ) ?? [];
  if (links.length > 1) {
    throw new Error("Wyślij tylko jeden link muzyczny naraz, a potem powtórz komendę.");
  }
}

export function assertSafePlaybackInput(input: string) {
  assertSingleMediaLink(input);
  if (/^spotify:(?:track|playlist|album):[A-Za-z0-9]+$/i.test(input.trim())) return;

  const links =
    input.match(
      /(?:https?:\/\/[^\s<>()]+|(?:www\.|music\.)?(?:youtube\.com|youtu\.be|open\.spotify\.com|spotify\.link|soundcloud\.com|bandcamp\.com|vimeo\.com|twitch\.tv|nicovideo\.jp)\/[^\s<>()]+)/gi
    ) ?? [];
  for (const raw of links) {
    const cleaned = raw.replace(/[.,!?;]+$/, "");
    const normalized = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      throw new Error("Podany link muzyczny jest nieprawidłowy.");
    }
    if (url.protocol !== "https:" || url.username || url.password || !isAllowedHost(url.hostname, PLAYBACK_HOSTS)) {
      throw new Error("Link musi prowadzić do obsługiwanego serwisu muzycznego przez HTTPS.");
    }
  }

  if (/^https?:\/\//i.test(input.trim()) && links.length === 0) {
    throw new Error("Ta domena nie znajduje się na liście obsługiwanych serwisów muzycznych.");
  }
}

export async function assertSafeRadioUrl(input: string, allowedDomains: ReadonlySet<string>) {
  if (allowedDomains.size === 0)
    throw new Error("Radio jest wyłączone do czasu skonfigurowania RADIO_ALLOWED_DOMAINS.");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Podaj pełny adres URL strumienia radia.");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) {
    throw new Error("Radio musi używać adresu HTTP(S) bez danych logowania.");
  }
  const hostname = normalizeHostname(url.hostname);
  if (!isAllowedHost(hostname, [...allowedDomains]))
    throw new Error("Domena strumienia nie znajduje się na liście RADIO_ALLOWED_DOMAINS.");
  await assertPublicHostname(hostname);
}

async function assertPublicHostname(hostname: string) {
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => {
      try {
        return ipaddr.process(address).range() !== "unicast";
      } catch {
        return true;
      }
    })
  ) {
    throw new Error("Adres radia nie może wskazywać na localhost ani sieć prywatną.");
  }
}

function isAllowedHost(hostname: string, domains: readonly string[]) {
  const normalized = normalizeHostname(hostname);
  return domains.some((domain) => {
    const suffix = normalizeHostname(domain);
    return normalized === suffix || normalized.endsWith(`.${suffix}`);
  });
}

function normalizeHostname(hostname: string) {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}
