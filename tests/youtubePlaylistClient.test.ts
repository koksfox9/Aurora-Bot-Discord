import assert from "node:assert/strict";
import test from "node:test";
import { getYouTubePlaylistId, normalizeYouTubeVideoUrl } from "../src/sources/YouTubePlaylistClient.js";

const videoId = "-J2rSm8K9_Y";
const playlistId = "PLjiB1Gm1BUm_doOfsN7XPbOVnKuUR5DXF";

test("extracts a playlist ID from a watch URL with both v and list parameters", () => {
  assert.equal(getYouTubePlaylistId(`https://www.youtube.com/watch?v=${videoId}&list=${playlistId}`), playlistId);
});

test("extracts a playlist ID from a canonical playlist URL", () => {
  assert.equal(getYouTubePlaylistId(`https://www.youtube.com/playlist?list=${playlistId}`), playlistId);
});

test("does not accept playlist IDs from untrusted hosts", () => {
  assert.equal(getYouTubePlaylistId(`https://example.com/playlist?list=${playlistId}`), undefined);
});

test("normalizes a watch URL with list= to a single-video URL", () => {
  assert.equal(
    normalizeYouTubeVideoUrl(`https://www.youtube.com/watch?v=${videoId}&list=${playlistId}&index=1`),
    `https://www.youtube.com/watch?v=${videoId}`
  );
});

test("preserves YouTube Radio/Mix IDs and start_radio for /play", () => {
  const url = "https://www.youtube.com/watch?v=VSmje_g4kdk&list=RDVSmje_g4kdk&start_radio=1";
  assert.equal(normalizeYouTubeVideoUrl(url), url);
});

test("normalizes a short video URL with list= to a single-video URL", () => {
  assert.equal(
    normalizeYouTubeVideoUrl(`https://youtu.be/${videoId}?list=${playlistId}`),
    `https://www.youtube.com/watch?v=${videoId}`
  );
});

test("leaves a normal YouTube video URL unchanged", () => {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  assert.equal(normalizeYouTubeVideoUrl(url), url);
});
