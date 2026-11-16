export class PanelRequestError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "PanelRequestError";
  }
}

export function panelErrorResponse(error: unknown) {
  if (error instanceof PanelRequestError) {
    return { status: error.status, body: { error: error.message } };
  }
  return { status: 500, body: { error: "Wewnętrzny błąd serwera." } };
}

export function asPanelRequestError(error: unknown, fallback: string): PanelRequestError {
  if (error instanceof PanelRequestError) return error;
  return new PanelRequestError(error instanceof Error && error.message ? error.message : fallback);
}
