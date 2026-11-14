export function isDuplicateFailureSkip(skip: boolean, sameFailure: boolean, delayedDuplicate: boolean) {
  return skip && (sameFailure || delayedDuplicate);
}

export function shouldSkipActiveTrack(skip: boolean, activeTrackId?: string, reportedTrackId?: string) {
  return skip && activeTrackId !== undefined && (!reportedTrackId || reportedTrackId === activeTrackId);
}
