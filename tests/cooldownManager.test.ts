import assert from "node:assert/strict";
import test from "node:test";
import { CooldownManager } from "../src/discord/CooldownManager.js";

test("blocks the same key until expiry, then starts a new cooldown", () => {
  const cooldowns = new CooldownManager();

  assert.equal(cooldowns.check("user-1", 100, 1_000), undefined);
  assert.equal(cooldowns.check("user-1", 100, 1_099), 1_100);
  assert.equal(cooldowns.check("user-1", 100, 1_100), undefined);
  assert.equal(cooldowns.check("user-1", 100, 1_150), 1_200);
});

test("tracks cooldowns independently for different keys", () => {
  const cooldowns = new CooldownManager();

  assert.equal(cooldowns.check("user-1", 500, 2_000), undefined);
  assert.equal(cooldowns.check("user-2", 500, 2_100), undefined);
  assert.equal(cooldowns.check("user-1", 500, 2_200), 2_500);
  assert.equal(cooldowns.check("user-2", 500, 2_200), 2_600);
});
