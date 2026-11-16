import assert from "node:assert/strict";
import test from "node:test";
import type { KazagumoTrack } from "kazagumo";
import { searchResultEmbed } from "../src/discord/commands/media.js";
import { nowPlayingEmbed, queueEmbed } from "../src/discord/commands/queueViews.js";
import { escapeAndTruncate, formatTrackLine } from "../src/discord/trackText.js";
import type { QueueSnapshot, Track } from "../src/domain/types.js";

const unsafeTitle = "[tekst](https://example.com) ".repeat(20);

function track(index: number): Track {
  return {
    id: `track-${index}`,
    source: "youtube",
    title: unsafeTitle,
    artist: unsafeTitle,
    durationMs: 180_000,
    addedAt: 0
  };
}

function snapshot(): QueueSnapshot {
  return {
    guildId: "guild",
    connected: true,
    paused: false,
    positionMs: 1_000,
    loop: "none",
    current: track(0),
    next: track(1),
    queue: Array.from({ length: 10 }, (_, index) => track(index + 1)),
    queueTotal: 10,
    history: [],
    settings: { volume: 0.75, stayInChannel: false, autoplay: false }
  };
}

test("escapes Markdown and preserves the requested text limit", () => {
  assert.equal(escapeAndTruncate("[tekst](url)", 100), "\\[tekst](url)");
  assert.equal(escapeAndTruncate("abcdefgh", 5), "abcd…");
  assert.ok(formatTrackLine(track(0)).length <= 90);
});

test("queue embeds fit Discord field limits with long, unsafe titles", () => {
  const fields = queueEmbed(snapshot(), 1).toJSON().fields ?? [];
  const upcoming = fields.find((field) => field.name === "Następne");

  assert.ok(upcoming);
  assert.ok(upcoming.value.length <= 1_024);
  assert.match(upcoming.value, /\\\[tekst\]\(https:\/\/example\.com\)/);
});

test("now playing and search embeds escape and limit long titles", () => {
  const nowPlaying = nowPlayingEmbed(snapshot()).toJSON();
  assert.ok(nowPlaying.description && nowPlaying.description.length <= 4_096);
  assert.match(nowPlaying.description ?? "", /\\\[tekst\]\(https:\/\/example\.com\)/);

  const result = searchResultEmbed({
    title: unsafeTitle,
    author: unsafeTitle,
    length: 180_000,
    isStream: false
  } as KazagumoTrack).toJSON();
  assert.ok(result.title && result.title.length <= 256);
  assert.match(result.title ?? "", /\\\[tekst\]\(https:\/\/example\.com\)/);
});
