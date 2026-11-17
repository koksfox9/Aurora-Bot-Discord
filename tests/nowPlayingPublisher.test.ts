import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mock, test, type TestContext } from "node:test";
import type { Client } from "discord.js";
import { NowPlayingPublisher } from "../src/discord/playbackEvents.js";
import type { PlaybackEvent, QueueSnapshot, Track } from "../src/domain/types.js";
import type { PlayerManager } from "../src/player/PlayerManager.js";

const GUILD = "guild";
const track: Track = { id: "t1", source: "youtube", title: "Song", artist: "Band", durationMs: 180_000, addedAt: 0 };

function baseSnapshot(overrides: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    guildId: GUILD,
    textChannelId: "chan",
    connected: true,
    paused: false,
    positionMs: 0,
    loop: "none",
    current: track,
    queue: [],
    queueTotal: 0,
    history: [],
    settings: { volume: 0.75, stayInChannel: false, autoplay: false },
    ...overrides
  };
}

type Reference = { channelId: string; messageId: string };

function setup(t: TestContext, initial: Partial<QueueSnapshot> = {}, initialReference?: Reference) {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  t.after(() => mock.timers.reset());

  const sent: unknown[] = [];
  const edits: Array<{
    id: string;
    payload: {
      embeds: Array<{ toJSON(): { author?: { name: string } } }>;
      components: Array<{ toJSON(): { components: Array<{ disabled?: boolean }> } }>;
    };
  }> = [];
  const deleted: string[] = [];
  const state = { snapshot: baseSnapshot(initial), editError: undefined as unknown, reference: initialReference };
  let nextId = 1;

  const channel = {
    id: "chan",
    isTextBased: () => true,
    send: async (payload: unknown) => {
      sent.push(payload);
      return { id: `m${nextId++}` };
    },
    messages: {
      edit: async (id: string, payload: (typeof edits)[number]["payload"]) => {
        if (state.editError) throw state.editError;
        edits.push({ id, payload });
      },
      delete: async (id: string) => {
        deleted.push(id);
      }
    }
  };
  const client = { channels: { fetch: async () => channel } } as unknown as Client;
  const players = Object.assign(new EventEmitter(), {
    snapshot: () => state.snapshot,
    getNowPlayingMessage: async () => state.reference,
    setNowPlayingMessage: async (_guildId: string, message?: Reference) => {
      state.reference = message;
    }
  }) as unknown as PlayerManager;

  new NowPlayingPublisher(client, players, { refreshMs: 30_000, debounceMs: 1_200 }).install();
  const emit = (type: PlaybackEvent["type"], extra: Partial<PlaybackEvent> = {}) =>
    (players as unknown as EventEmitter).emit("playback", { guildId: GUILD, type, ...extra });
  return { state, sent, edits, deleted, emit };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("sends one message on the first track and edits it for later tracks", async (t) => {
  const { state, sent, edits, emit } = setup(t);
  emit("trackStart");
  await flush();
  assert.equal(sent.length, 1);
  assert.deepEqual(state.reference, { channelId: "chan", messageId: "m1" });

  emit("trackStart");
  await flush();
  assert.equal(sent.length, 1);
  assert.deepEqual(
    edits.map((edit) => edit.id),
    ["m1"]
  );
});

test("rapid track changes never produce duplicate messages", async (t) => {
  const { sent, edits, emit } = setup(t);
  emit("trackStart");
  emit("trackStart");
  emit("trackStart");
  await flush();
  assert.equal(sent.length, 1);
  assert.equal(edits.length, 2);
});

test("bursts of changes collapse into a single edit after the debounce", async (t) => {
  const { edits, emit } = setup(t);
  emit("trackStart");
  await flush();

  emit("settingsChanged");
  emit("settingsChanged");
  emit("queueChanged");
  emit("settingsChanged");
  await flush();
  assert.equal(edits.length, 0);

  mock.timers.tick(1_200);
  await flush();
  assert.equal(edits.length, 1);
});

test("refreshes progress every 30 seconds while playing but not while paused", async (t) => {
  const { state, edits, emit } = setup(t);
  emit("trackStart");
  await flush();

  mock.timers.tick(30_000);
  await flush();
  assert.equal(edits.length, 1);

  state.snapshot = baseSnapshot({ paused: true });
  mock.timers.tick(30_000);
  await flush();
  assert.equal(edits.length, 1);
});

test("live streams are not refreshed on a timer", async (t) => {
  const { edits, emit } = setup(t, { current: { ...track, isLive: true, durationMs: undefined } });
  emit("trackStart");
  await flush();
  mock.timers.tick(90_000);
  await flush();
  assert.equal(edits.length, 0);
});

test("idle turns the message into the end state and stops the timer", async (t) => {
  const { state, edits, emit } = setup(t);
  emit("trackStart");
  await flush();

  state.snapshot = baseSnapshot({ current: undefined, history: [track] });
  emit("idle");
  await flush();
  assert.equal(edits.length, 1);
  const payload = edits[0]!.payload;
  assert.equal(payload.embeds[0]!.toJSON().author?.name, "Kolejka zakończona");
  assert.ok(payload.components.every((row) => row.toJSON().components.every((button) => button.disabled === true)));

  mock.timers.tick(120_000);
  await flush();
  assert.equal(edits.length, 1);
});

test("sends a new message when the previous one was deleted", async (t) => {
  const { state, sent, emit } = setup(t, {}, { channelId: "chan", messageId: "old" });
  state.editError = { code: 10008 };
  emit("trackStart");
  await flush();
  assert.equal(sent.length, 1);
  assert.deepEqual(state.reference, { channelId: "chan", messageId: "m1" });
});

test("forgets a deleted message instead of retrying forever", async (t) => {
  const { state, edits, emit } = setup(t, {}, { channelId: "chan", messageId: "old" });
  state.editError = { code: 10008 };
  emit("settingsChanged");
  mock.timers.tick(1_200);
  await flush();
  assert.equal(state.reference, undefined);
  assert.equal(edits.length, 0);
});

test("removes the old message when announcements moved to another channel", async (t) => {
  const { state, sent, deleted, emit } = setup(t, {}, { channelId: "other", messageId: "old" });
  emit("trackStart");
  await flush();
  assert.deepEqual(deleted, ["old"]);
  assert.equal(sent.length, 1);
  assert.deepEqual(state.reference, { channelId: "chan", messageId: "m1" });
});

test("does nothing without an announcement channel", async (t) => {
  const { sent, edits, emit } = setup(t, { textChannelId: undefined });
  emit("trackStart");
  await flush();
  assert.equal(sent.length, 0);
  assert.equal(edits.length, 0);
});

test("announces playback errors with an escaped title", async (t) => {
  const { sent, emit } = setup(t);
  emit("error", { track: { ...track, title: "[x](https://example.com)" } });
  await flush();
  assert.equal(sent.length, 1);
  assert.match(String(sent[0]), /Nie udało się odtworzyć \*\*\\\[x\]/);
});
