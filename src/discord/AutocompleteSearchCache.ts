type CachedValue<T> = { expiresAt: number; value: T };

export class AutocompleteSearchCache<T> {
  private readonly cache = new Map<string, CachedValue<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly userCooldowns = new Map<string, number>();

  constructor(
    private readonly ttlMs = 45_000,
    private readonly userCooldownMs = 750,
    private readonly now: () => number = Date.now
  ) {}

  async get(query: string, userId: string, load: () => Promise<T>): Promise<T | undefined> {
    const now = this.now();
    const retryAt = this.userCooldowns.get(userId) ?? 0;
    if (retryAt > now) return undefined;
    this.userCooldowns.set(userId, now + this.userCooldownMs);

    const key = query.trim().toLocaleLowerCase();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    if (cached) this.cache.delete(key);

    let search = this.inFlight.get(key);
    if (!search) {
      search = load().then((value) => {
        this.cache.set(key, { value, expiresAt: this.now() + this.ttlMs });
        return value;
      });
      this.inFlight.set(key, search);
      void search.finally(() => this.inFlight.delete(key)).catch(() => undefined);
    }
    return search;
  }
}
