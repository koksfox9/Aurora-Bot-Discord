import { Innertube, UniversalCache } from "youtubei.js";

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
let innertubePromise: ReturnType<typeof Innertube.create> | undefined;

export function getYouTubePlaylistId(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname !== "youtube.com" && !hostname.endsWith(".youtube.com") && hostname !== "youtu.be") {
    return undefined;
  }

  const playlistId = url.searchParams.get("list");
  return playlistId && /^[A-Za-z0-9_-]{10,}$/.test(playlistId) ? playlistId : undefined;
}

export function normalizeYouTubeVideoUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input;
  }

  const hostname = url.hostname.toLowerCase();
  const isYouTubeHost = hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtu.be";
  if (!isYouTubeHost || !url.searchParams.has("list")) return input;

  // Keep YouTube Radio/Mix identifiers intact so Lavalink can load the mix.
  // For ordinary playlists, /play keeps its existing single-video behavior.
  if (url.searchParams.get("list")?.startsWith("RD")) return input;

  let videoId = url.searchParams.get("v");
  if (!videoId && hostname === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0];
  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) return input;

  const videoUrl = new URL("https://www.youtube.com/watch");
  videoUrl.searchParams.set("v", videoId);
  return videoUrl.toString();
}

export async function loadYouTubePlaylistVideoIds(
  playlistId: string,
  maxItems: number
): Promise<{ videoIds: string[]; truncated: boolean }> {
  const client = await getInnertube();
  let page = await client.getPlaylist(playlistId);
  const videoIds: string[] = [];
  const seen = new Set<string>();
  let truncated = false;

  while (true) {
    for (const video of page.videos) {
      const videoId = getVideoId(video);
      if (!videoId || seen.has(videoId)) continue;
      seen.add(videoId);
      videoIds.push(videoId);
    }

    if (videoIds.length > maxItems) {
      truncated = true;
      break;
    }
    if (!page.has_continuation) break;
    if (videoIds.length >= maxItems) {
      truncated = true;
      break;
    }
    page = await page.getContinuation();
  }

  return { videoIds: videoIds.slice(0, maxItems), truncated };
}

function getVideoId(video: unknown): string | undefined {
  if (!video || typeof video !== "object") return undefined;
  const value = video as { content_id?: unknown; video_id?: unknown; id?: unknown };
  for (const candidate of [value.content_id, value.video_id, value.id]) {
    if (typeof candidate === "string" && VIDEO_ID_PATTERN.test(candidate)) return candidate;
  }
  return undefined;
}

function getInnertube() {
  if (!innertubePromise) {
    innertubePromise = Innertube.create({ cache: new UniversalCache(false) }).catch((error: unknown) => {
      innertubePromise = undefined;
      throw error;
    });
  }
  return innertubePromise;
}
