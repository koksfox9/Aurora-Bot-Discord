import assert from "node:assert/strict";
import test from "node:test";
import { PlayerState, type KazagumoPlayer, type KazagumoTrack } from "kazagumo";
import type { AppConfig } from "../src/config.js";
import { GuildAudioSession } from "../src/player/GuildAudioSession.js";

class TestQueue implements Iterable<KazagumoTrack> {
  current?: KazagumoTrack;
  private readonly items: KazagumoTrack[] = [];

  get size() {
    return this.items.length;
  }

  add(track: KazagumoTrack) {
    this.items.push(track);
  }

  shift() {
    return this.items.shift();
  }

  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }
}

test("autoplay queues and starts an unseen related track when the queue ends", async () => {
  const queue = new TestQueue();
  const player = {
    state: PlayerState.CONNECTED,
    queue,
    voiceId: "voice-channel",
    textId: "text-channel",
    paused: false,
    playing: false,
    position: 0,
    loop: "none",
    play: async () => {
      queue.current = queue.shift();
    }
  } as unknown as KazagumoPlayer;

  const seed = {
    identifier: "seed-track",
    title: "Seed Track",
    author: "Seed Artist",
    length: 180_000,
    uri: "https://www.youtube.com/watch?v=seed-track",
    sourceName: "youtube",
    isStream: false
  } as unknown as KazagumoTrack;
  const related = {
    identifier: "related-track",
    title: "Related Track",
    author: "Seed Artist",
    length: 190_000,
    uri: "https://www.youtube.com/watch?v=related-track",
    sourceName: "youtube",
    isStream: false
  } as unknown as KazagumoTrack;

  const searches: string[] = [];
  const kazagumo = {
    getPlayer: () => player,
    search: async (query: string) => {
      searches.push(query);
      return { tracks: [seed, related] };
    }
  } as never;
  const config = { playback: { defaultVolume: 0.75 } } as AppConfig;
  const session = new GuildAudioSession("guild", "bot", config, kazagumo);
  (session as unknown as { player: KazagumoPlayer }).player = player;

  session.setSettings({ autoplay: true });
  session.onTrackStart(seed);
  session.onTrackEnd();
  session.onPlayerEmpty();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(searches, ["ytmsearch:Seed Artist songs"]);
  assert.equal(queue.current?.identifier, "related-track");
});
