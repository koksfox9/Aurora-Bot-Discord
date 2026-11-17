import assert from "node:assert/strict";
import test from "node:test";
import { ButtonStyle } from "discord.js";
import {
  nowPlayingComponents,
  nowPlayingEmbed,
  nowPlayingPayload,
  progressBar
} from "../src/discord/commands/queueViews.js";
import type { QueueSnapshot, Track } from "../src/domain/types.js";

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: "t1",
    source: "youtube",
    title: "Song",
    artist: "Band",
    durationMs: 180_000,
    webpageUrl: "https://youtu.be/abc",
    thumbnail: "https://img.example/abc.jpg",
    requestedBy: "daniel",
    addedAt: 0,
    ...overrides
  };
}

function snapshot(overrides: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    guildId: "g",
    connected: true,
    paused: false,
    positionMs: 90_000,
    loop: "none",
    current: track(),
    queue: [],
    queueTotal: 0,
    history: [],
    settings: { volume: 0.75, stayInChannel: false, autoplay: false },
    ...overrides
  };
}

const rows = (value: QueueSnapshot) => nowPlayingComponents(value).map((row) => row.toJSON().components);
const buttons = (value: QueueSnapshot) => rows(value).flat();

test("playing embed shows title link, artist, bar, time, volume, loop and footer", () => {
  const json = nowPlayingEmbed(snapshot()).toJSON();
  assert.equal(json.author?.name, "Teraz gra");
  assert.equal(json.color, 0x23a6a6);
  assert.equal(json.title, "Song");
  assert.equal(json.url, "https://youtu.be/abc");
  assert.equal(json.thumbnail?.url, "https://img.example/abc.jpg");
  assert.equal(json.description, "Band\n▰▰▰▰▰▰▱▱▱▱▱▱");
  assert.deepEqual(
    json.fields?.map((field) => [field.name, field.value]),
    [
      ["Czas", "1:30 / 3:00"],
      ["Głośność", "75%"],
      ["Powtarzanie", "Wyłączone"],
      ["Następny", "Kolejka jest pusta"]
    ]
  );
  assert.equal(json.footer?.text, "Dodał daniel · YouTube");
});

test("paused embed changes heading and color, and the toggle button offers resume", () => {
  const value = snapshot({ paused: true });
  const json = nowPlayingEmbed(value).toJSON();
  assert.equal(json.author?.name, "Wstrzymano");
  assert.equal(json.color, 0xf0a232);
  assert.equal(buttons(value)[1]?.emoji?.name, "▶️");
  assert.equal(buttons(snapshot())[1]?.emoji?.name, "⏸️");
});

test("progress bar is fixed width and clamps its input", () => {
  assert.equal(progressBar(0, 100), "▱".repeat(12));
  assert.equal(progressBar(50, 100), `${"▰".repeat(6)}${"▱".repeat(6)}`);
  assert.equal(progressBar(100, 100), "▰".repeat(12));
  assert.equal(progressBar(500, 100), "▰".repeat(12));
  assert.equal(progressBar(-5, 100), "▱".repeat(12));
  assert.equal(progressBar(10, 0), "▱".repeat(12));
});

test("position past the end of the track is clamped in the time field", () => {
  const json = nowPlayingEmbed(snapshot({ positionMs: 999_999 })).toJSON();
  assert.equal(json.fields?.[0]?.value, "3:00 / 3:00");
});

test("unsafe or invalid URLs never reach the embed", () => {
  const json = nowPlayingEmbed(
    snapshot({
      current: track({ webpageUrl: "javascript:alert(1)", url: "ftp://example.com/x", thumbnail: "not a url" })
    })
  ).toJSON();
  assert.equal(json.url, undefined);
  assert.equal(json.thumbnail, undefined);
});

test("long, unsafe titles are escaped and bounded", () => {
  const unsafe = "[tekst](https://example.com) ".repeat(20);
  const json = nowPlayingEmbed(snapshot({ current: track({ title: unsafe, artist: unsafe }) })).toJSON();
  assert.ok((json.title ?? "").length <= 80);
  assert.match(json.title ?? "", /\\\[tekst\]/);
  assert.ok((json.description ?? "").length <= 4_096);
});

test("next track shows how many more are queued", () => {
  const json = nowPlayingEmbed(
    snapshot({ next: track({ id: "t2", title: "Next one" }), queueTotal: 3, queue: [track(), track(), track()] })
  ).toJSON();
  assert.equal(json.fields?.at(-1)?.value, "Next one (+2 więcej)");
});

test("radio shows live status and disables controls that make no sense for a stream", () => {
  const radio = track({ id: "radio", title: "Station", artist: undefined, isLive: true, durationMs: undefined });
  const value = snapshot({ current: radio, radio, loop: "track", history: [track()], queueTotal: 5 });
  const json = nowPlayingEmbed(value).toJSON();
  assert.equal(json.author?.name, "Radio 24/7");
  assert.equal(json.description, undefined);
  assert.equal(json.fields?.[0]?.value, "Na żywo");
  assert.equal(json.fields?.[2]?.value, "Radio");

  const [previous, toggle, skip, stop, shuffle, loop, volumeDown, volumeUp] = buttons(value);
  assert.equal(previous?.disabled, true);
  assert.equal(shuffle?.disabled, true);
  assert.equal(loop?.disabled, true);
  assert.equal(loop?.style, ButtonStyle.Secondary);
  for (const enabled of [toggle, skip, stop, volumeDown, volumeUp]) assert.notEqual(enabled?.disabled, true);
});

test("buttons form two rows of four icon buttons with stable ids", () => {
  const value = snapshot({ history: [track()], queueTotal: 2, queue: [track(), track()] });
  const [transport, options] = rows(value);
  assert.deepEqual(
    transport?.map((button) => "custom_id" in button && button.custom_id),
    ["music:previous", "music:toggle", "music:skip", "music:stop"]
  );
  assert.deepEqual(
    options?.map((button) => "custom_id" in button && button.custom_id),
    ["music:shuffle", "music:loop", "music:voldown", "music:volup"]
  );
  for (const button of buttons(value)) {
    assert.ok(button.emoji?.name);
    assert.ok(!("label" in button) || !button.label);
  }
});

test("loop button reflects the mode", () => {
  const loopButton = (loop: QueueSnapshot["loop"]) => buttons(snapshot({ loop }))[5];
  assert.equal(loopButton("none")?.style, ButtonStyle.Secondary);
  assert.equal(loopButton("none")?.emoji?.name, "🔁");
  assert.equal(loopButton("queue")?.style, ButtonStyle.Success);
  assert.equal(loopButton("queue")?.emoji?.name, "🔁");
  assert.equal(loopButton("track")?.style, ButtonStyle.Success);
  assert.equal(loopButton("track")?.emoji?.name, "🔂");
});

test("previous, shuffle and volume buttons are disabled when they cannot do anything", () => {
  const empty = buttons(snapshot());
  assert.equal(empty[0]?.disabled, true); // no history
  assert.equal(empty[4]?.disabled, true); // fewer than two queued tracks
  const quiet = buttons(snapshot({ settings: { volume: 0.01, stayInChannel: false, autoplay: false } }));
  assert.equal(quiet[6]?.disabled, true);
  const loud = buttons(snapshot({ settings: { volume: 1, stayInChannel: false, autoplay: false } }));
  assert.equal(loud[7]?.disabled, true);
});

test("idle states explain what happened and disable every button", () => {
  const finished = snapshot({ current: undefined, history: [track()] });
  assert.equal(nowPlayingEmbed(finished).toJSON().author?.name, "Kolejka zakończona");
  assert.match(nowPlayingEmbed(finished).toJSON().description ?? "", /Ostatnio grało: \*\*Song\*\*/);

  const left = snapshot({ current: undefined, history: [track()], connected: false });
  assert.equal(nowPlayingEmbed(left).toJSON().author?.name, "Rozłączono");

  const fresh = snapshot({ current: undefined, connected: false });
  assert.equal(nowPlayingEmbed(fresh).toJSON().author?.name, "Nic teraz nie gra");

  for (const value of [finished, left, fresh]) {
    assert.equal(nowPlayingEmbed(value).toJSON().color, 0x6d6f78);
    assert.ok(buttons(value).every((button) => button.disabled === true));
  }
});

test("payload bundles the embed with both button rows", () => {
  const payload = nowPlayingPayload(snapshot());
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.components.length, 2);
});
