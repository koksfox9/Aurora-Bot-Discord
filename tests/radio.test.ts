import assert from "node:assert/strict";
import test from "node:test";
import { PlayerState, type KazagumoPlayer, type KazagumoTrack } from "kazagumo";
import type { AppConfig } from "../src/config.js";
import { GuildAudioSession } from "../src/player/GuildAudioSession.js";

type RadioPlayer = KazagumoPlayer & { calls: string[] };

function track(identifier: string): KazagumoTrack {
  return {
    identifier,
    title: identifier,
    author: "Radio",
    length: 0,
    uri: `https://8.8.8.8/${identifier}`,
    sourceName: "http",
    isStream: true
  } as unknown as KazagumoTrack;
}

function createPlayer(current?: KazagumoTrack): RadioPlayer {
  const calls: string[] = [];
  const queue = {
    current,
    size: 0,
    clear: () => calls.push("clear"),
    *[Symbol.iterator]() {
      // The session serializes the queue after changing stations.
    }
  };
  return {
    calls,
    state: PlayerState.CONNECTED,
    queue,
    paused: false,
    playing: Boolean(current),
    setLoop: (mode: string) => {
      calls.push(`loop:${mode}`);
      return undefined;
    },
    play: async (next: KazagumoTrack, options?: { replaceCurrent?: boolean }) => {
      calls.push(`play:${next.identifier}:${options?.replaceCurrent}`);
      queue.current = next;
      return undefined;
    }
  } as unknown as RadioPlayer;
}

function createSession(player: RadioPlayer, nextTrack: KazagumoTrack) {
  const kazagumo = {
    getPlayer: () => player,
    search: async () => ({ tracks: [nextTrack] })
  } as never;
  const config = {
    playback: { defaultVolume: 0.75 },
    media: { radioAllowedDomains: new Set(["8.8.8.8"]) }
  } as AppConfig;
  const session = new GuildAudioSession("guild", "bot", config, kazagumo);
  (session as unknown as { player: KazagumoPlayer }).player = player;
  return session;
}

for (const scenario of [
  { name: "replaces a playing song", current: track("song"), next: track("station") },
  { name: "replaces one radio station with another", current: track("station-a"), next: track("station-b") },
  { name: "starts a station when nothing is playing", current: undefined, next: track("station") }
]) {
  test(`setRadio ${scenario.name}`, async () => {
    const player = createPlayer(scenario.current);
    const session = createSession(player, scenario.next);

    await session.setRadio("https://8.8.8.8/stream", undefined, { id: "user", username: "User" });

    assert.deepEqual(player.calls, ["clear", `play:${scenario.next.identifier}:true`, "loop:track"]);
    assert.equal(player.queue.current?.identifier, scenario.next.identifier);
  });
}
