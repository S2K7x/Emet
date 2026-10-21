import { SKIP, type MeetingKind, type MeetingStage, type MeetingView, type Role } from "../../shared/protocol.ts";
import config from "../../data/game.json" with { type: "json" };

export interface MeetingResult {
  ejected?: string;
  tally: Record<string, number>;
}

export class Meeting {
  stage: MeetingStage = "discussion";
  endsAt: number;
  result?: MeetingResult;
  private votes = new Map<string, string>();

  constructor(readonly reporter: string, readonly body: string, now: number, readonly kind: MeetingKind = "report") {
    this.endsAt = now + config.meeting.discussion * 1000;
  }

  // A vote is only accepted during the vote stage, once, from a living player, for a living player or SKIP.
  vote(voter: string, target: string, alive: Set<string>) {
    if (this.stage !== "vote" || this.votes.has(voter) || !alive.has(voter)) return;
    if (target !== SKIP && !alive.has(target)) return;
    this.votes.set(voter, target);
  }

  // Advances the stages; returns true when the meeting is over.
  update(now: number, alive: Set<string>): boolean {
    const allVoted = this.stage === "vote" && [...alive].every((id) => this.votes.has(id));
    if (now < this.endsAt && !allVoted) return false;

    if (this.stage === "discussion") {
      this.stage = "vote";
      this.endsAt = now + config.meeting.vote * 1000;
    } else if (this.stage === "vote") {
      this.result = this.count(alive);
      this.stage = "result";
      this.endsAt = now + config.meeting.result * 1000;
    } else {
      return true;
    }
    return false;
  }

  forget(id: string) {
    this.votes.delete(id);
  }

  private count(alive: Set<string>): MeetingResult {
    const tally: Record<string, number> = {};
    for (const [voter, target] of this.votes) {
      if (alive.has(voter)) tally[target] = (tally[target] ?? 0) + 1;
    }
    // Strict plurality; a tie or SKIP on top = no one.
    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const [top, second] = sorted;
    const ejected = top && top[0] !== SKIP && (!second || second[1] < top[1]) ? top[0] : undefined;
    return { ejected, tally };
  }

  viewFor(viewer: string, now: number, roleOf: (id: string) => Role | undefined): MeetingView {
    const ejected = this.result?.ejected;
    return {
      kind: this.kind,
      stage: this.stage,
      secondsLeft: Math.max(0, Math.ceil((this.endsAt - now) / 1000)),
      reporter: this.reporter,
      body: this.body,
      voted: [...this.votes.keys()],
      myVote: this.votes.get(viewer),
      result: this.result && {
        ejected,
        tally: this.result.tally,
        ejectedRole: ejected && config.meeting.revealRoleOnEject ? roleOf(ejected) : undefined,
      },
    };
  }
}
