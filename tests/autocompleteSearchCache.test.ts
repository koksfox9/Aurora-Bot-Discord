import assert from "node:assert/strict";
import test from "node:test";
import { AutocompleteSearchCache } from "../src/discord/AutocompleteSearchCache.js";

test("limits autocomplete requests per user while serving cached results after the cooldown", async () => {
  let now = 1_000;
  let calls = 0;
  const cache = new AutocompleteSearchCache<string[]>(45_000, 750, () => now);
  const load = async () => {
    calls += 1;
    return ["result"];
  };

  assert.deepEqual(await cache.get("Aurora", "user", load), ["result"]);
  assert.equal(await cache.get("Aurora", "user", load), undefined);
  now += 750;
  assert.deepEqual(await cache.get("  aurora ", "user", load), ["result"]);
  assert.equal(calls, 1);
});

test("shares an in-flight identical autocomplete search between users", async () => {
  let resolve!: (value: string[]) => void;
  let calls = 0;
  const cache = new AutocompleteSearchCache<string[]>(45_000, 750, () => 1_000);
  const load = () => {
    calls += 1;
    return new Promise<string[]>((done) => {
      resolve = done;
    });
  };

  const first = cache.get("Aurora", "first-user", load);
  const second = cache.get("aurora", "second-user", load);
  assert.equal(calls, 1);
  resolve(["result"]);
  assert.deepEqual(await first, ["result"]);
  assert.deepEqual(await second, ["result"]);
});

test("refreshes autocomplete results after the cache expires", async () => {
  let now = 1_000;
  let calls = 0;
  const cache = new AutocompleteSearchCache<string[]>(1_000, 0, () => now);
  const load = async () => [String(++calls)];

  assert.deepEqual(await cache.get("Aurora", "user", load), ["1"]);
  now += 1_000;
  assert.deepEqual(await cache.get("Aurora", "user", load), ["2"]);
});

test("removes a failed autocomplete search so it can be retried", async () => {
  let calls = 0;
  const cache = new AutocompleteSearchCache<string[]>(45_000, 0, () => 1_000);
  const load = async () => {
    calls += 1;
    if (calls === 1) throw new Error("search failed");
    return ["result"];
  };

  await assert.rejects(cache.get("Aurora", "user", load), /search failed/);
  assert.deepEqual(await cache.get("Aurora", "user", load), ["result"]);
  assert.equal(calls, 2);
});
