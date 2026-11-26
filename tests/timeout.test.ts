import assert from "node:assert/strict";
import test from "node:test";
import { OperationTimeoutError, withTimeout } from "../src/utils/timeout.js";

test("returns an operation result before its timeout", async () => {
  assert.equal(await withTimeout(Promise.resolve("done"), 50, "test operation"), "done");
});

test("rejects an operation that exceeds its timeout", async () => {
  const never = new Promise<never>(() => undefined);

  await assert.rejects(withTimeout(never, 10, "test operation"), OperationTimeoutError);
});
