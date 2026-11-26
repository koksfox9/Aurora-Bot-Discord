import assert from "node:assert/strict";
import test from "node:test";
import { isRecoverablePlayerClose } from "../src/player/playerClosed.js";

test("keeps the current track for recoverable Discord voice websocket closures", () => {
  for (const code of [1000, 1001, 1006, 4006, 4009, 4014]) {
    assert.equal(isRecoverablePlayerClose({ code, reason: "temporary", byRemote: true }), true);
  }
  assert.equal(isRecoverablePlayerClose({ code: 4017, reason: "unsupported voice protocol", byRemote: true }), false);
});

test("keeps the current track when the local voice socket closes", () => {
  assert.equal(isRecoverablePlayerClose({ code: 4017, reason: "local reconnect", byRemote: false }), true);
});
