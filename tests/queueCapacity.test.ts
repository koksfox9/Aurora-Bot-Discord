import assert from "node:assert/strict";
import test from "node:test";
import { availableQueueCapacity } from "../src/player/queueCapacity.js";

test("returns only the remaining queue slots", () => {
  assert.equal(availableQueueCapacity(50, 48), 2);
  assert.equal(availableQueueCapacity(50, 50), 0);
  assert.equal(availableQueueCapacity(50, 52), 0);
});

test("caps playlist additions by both queue space and request limit", () => {
  assert.equal(availableQueueCapacity(50, 40, 3), 3);
  assert.equal(availableQueueCapacity(50, 48, 10), 2);
  assert.equal(availableQueueCapacity(50, 40, 0), 0);
  assert.equal(availableQueueCapacity(50, 40, -1), 0);
});
