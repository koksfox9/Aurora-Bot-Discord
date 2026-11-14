export function availableQueueCapacity(queueLimit: number, queuedTrackCount: number, requestLimit = queueLimit) {
  const remainingQueueCapacity = Math.max(0, queueLimit - queuedTrackCount);
  return Math.min(remainingQueueCapacity, Math.max(0, requestLimit));
}
