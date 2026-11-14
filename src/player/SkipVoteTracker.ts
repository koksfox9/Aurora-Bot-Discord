export type SkipVoteResult = { status: "pending" | "duplicate" | "skipped"; votes: number; required: number };

export class SkipVoteTracker {
  private trackKey?: string;
  private readonly voters = new Set<string>();

  cast(trackKey: string, userId: string, requiredVotes: number): SkipVoteResult {
    if (this.trackKey !== trackKey) {
      this.trackKey = trackKey;
      this.voters.clear();
    }

    const duplicate = this.voters.has(userId);
    this.voters.add(userId);
    const votes = this.voters.size;
    if (votes >= requiredVotes) return { status: "skipped", votes, required: requiredVotes };
    return { status: duplicate ? "duplicate" : "pending", votes, required: requiredVotes };
  }

  clear() {
    this.trackKey = undefined;
    this.voters.clear();
  }
}
