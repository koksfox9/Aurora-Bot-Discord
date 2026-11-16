import assert from "node:assert/strict";
import test from "node:test";
import { PlayerState, type KazagumoPlayer, type KazagumoTrack } from "kazagumo";
import type { AppConfig } from "../src/config.js";
import { GuildAudioSession } from "../src/player/GuildAudioSession.js";

function playerFixture(loop: "none" | "queue" | "track" = "track") {
  const calls: string[] = [];
  const player = {
    state: PlayerState.CONNECTED,
    loop,
    queue: { current: undefined, size: 0, *[Symbol.iterator]() {} },
    setLoop(mode: "none" | "queue" | "track") {
      calls.push(`loop:${mode}`);
      this.loop = mode;
    },
    skip() {
      calls.push("skip");
    }
  } as unknown as KazagumoPlayer;
  return { player, calls };
}

function makeTrack(identifier: string) {
  return {
    identifier,
    title: identifier,
    author: "Artist",
    length: 180_000,
    uri: `https://youtube.com/watch?v=${identifier}`,
    sourceName: "youtube",
    isStream: false
  } as unknown as KazagumoTrack;
}

function sessionFor(player: KazagumoPlayer) {
  const config = { playback: { defaultVolume: 0.75 } } as AppConfig;
  const session = new GuildAudioSession("guild", "bot", config, {} as never);
  (session as unknown as { player: KazagumoPlayer }).player = player;
  return session;
}

test("skip temporarily disables track loop and restores it on the next track", () => {
  const { player, calls } = playerFixture();
  const session = sessionFor(player);

  const currentTrack = makeTrack("first-track");
  player.queue.current = currentTrack;
  session.onTrackStart(currentTrack);
  assert.equal(session.skip(), true);
  assert.deepEqual(calls, ["loop:none", "skip"]);

  const nextTrack = makeTrack("next-track");
  player.queue.current = nextTrack;
  session.onTrackStart(nextTrack);
  assert.deepEqual(calls, ["loop:none", "skip", "loop:track"]);
});

test("skip leaves radio track loop untouched", () => {
  const { player, calls } = playerFixture();
  const session = sessionFor(player);
  (session as unknown as { radio: unknown }).radio = {
    id: `${"radio-track"}:0:radio-track`
  };
  player.queue.current = makeTrack("radio-track");

  assert.equal(session.skip(), true);
  assert.deepEqual(calls, ["skip"]);
});
