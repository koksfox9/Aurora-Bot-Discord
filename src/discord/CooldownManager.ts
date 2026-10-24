export class CooldownManager {
  private readonly expirations = new Map<string, number>();
  private readonly cleanupTimer = setInterval(() => this.removeExpired(Date.now()), 60_000);

  constructor() {
    this.cleanupTimer.unref();
  }

  check(key: string, cooldownMs: number, now = Date.now()) {
    const retryAt = this.expirations.get(key) ?? 0;
    if (retryAt > now) return retryAt;

    this.expirations.set(key, now + cooldownMs);
    if (this.expirations.size % 64 === 0) this.removeExpired(now);
    return undefined;
  }

  private removeExpired(now: number) {
    for (const [savedKey, expiry] of this.expirations) {
      if (expiry <= now) this.expirations.delete(savedKey);
    }
  }
}
