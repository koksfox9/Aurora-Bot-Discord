import assert from "node:assert/strict";
import test from "node:test";
import { SkipVoteTracker } from "../src/player/SkipVoteTracker.js";

test("counts unique votes and skips when the threshold is reached", () => {
  const tracker = new SkipVoteTracker();

  assert.deepEqual(tracker.cast("track-1", "user-1", 2), { status: "pending", votes: 1, required: 2 });
  assert.deepEqual(tracker.cast("track-1", "user-2", 2), { status: "skipped", votes: 2, required: 2 });
});

test("does not count a repeated vote twice", () => {
  const tracker = new SkipVoteTracker();

  tracker.cast("track-1", "user-1", 3);
  assert.deepEqual(tracker.cast("track-1", "user-1", 3), { status: "duplicate", votes: 1, required: 3 });
});

test("starts a fresh vote when the current track changes or votes are cleared", () => {
  const tracker = new SkipVoteTracker();

  tracker.cast("track-1", "user-1", 2);
  assert.deepEqual(tracker.cast("track-2", "user-1", 2), { status: "pending", votes: 1, required: 2 });
  tracker.clear();
  assert.deepEqual(tracker.cast("track-2", "user-1", 2), { status: "pending", votes: 1, required: 2 });
});
