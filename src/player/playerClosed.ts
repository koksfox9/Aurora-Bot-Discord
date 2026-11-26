export type PlayerClosedEvent = {
  byRemote: boolean;
  code: number;
  reason: string;
};

const RECOVERABLE_VOICE_CLOSE_CODES = new Set([
  1000, // Normal closure.
  1001, // Endpoint is going away.
  1006, // Abnormal closure without a close frame.
  4006, // Discord voice session is no longer valid.
  4009, // Discord voice session timed out.
  4014 // The bot was moved between voice channels.
]);

export function isRecoverablePlayerClose(event: PlayerClosedEvent) {
  return !event.byRemote || RECOVERABLE_VOICE_CLOSE_CODES.has(event.code);
}
