import assert from "node:assert/strict";
import test from "node:test";
import { isDuplicateFailureSkip, shouldSkipActiveTrack } from "../src/player/failureSkip.js";

test("skips only the active track associated with the reported failure", () => {
  assert.equal(shouldSkipActiveTrack(true, "track-1", "track-1"), true);
  assert.equal(shouldSkipActiveTrack(true, "track-1"), true);
  assert.equal(shouldSkipActiveTrack(false, "track-1", "track-1"), false);
  assert.equal(shouldSkipActiveTrack(true, undefined, "track-1"), false);
  assert.equal(shouldSkipActiveTrack(true, "track-1", "track-2"), false);
});

test("ignores duplicate failure events only when a skip was requested", () => {
  assert.equal(isDuplicateFailureSkip(true, true, false), true);
  assert.equal(isDuplicateFailureSkip(true, false, true), true);
  assert.equal(isDuplicateFailureSkip(true, false, false), false);
  assert.equal(isDuplicateFailureSkip(false, true, true), false);
});
