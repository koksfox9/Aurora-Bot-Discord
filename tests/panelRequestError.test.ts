import assert from "node:assert/strict";
import test from "node:test";
import { PanelRequestError, asPanelRequestError, panelErrorResponse } from "../src/web/PanelRequestError.js";

test("returns a safe 400 response for panel validation errors", () => {
  const response = panelErrorResponse(new PanelRequestError("Nieznany efekt dźwiękowy."));

  assert.deepEqual(response, { status: 400, body: { error: "Nieznany efekt dźwiękowy." } });
});

test("returns a generic 500 response for unexpected failures", () => {
  const response = panelErrorResponse(new Error("secret database address"));

  assert.deepEqual(response, { status: 500, body: { error: "Wewnętrzny błąd serwera." } });
});

test("keeps a safe validation message when wrapping input validation failures", () => {
  const error = asPanelRequestError(new Error("Nieprawidłowy link."), "Nieprawidłowe żądanie.");

  assert(error instanceof PanelRequestError);
  assert.equal(error.message, "Nieprawidłowy link.");
});
