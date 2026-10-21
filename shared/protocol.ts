// Messages exchanged client <-> server. The client only sends intents.

export type Role = "innocent" | "killer";
export type Phase = "lobby" | "playing" | "meeting" | "ended";
export type MeetingStage = "discussion" | "vote" | "result";
export const SKIP = "skip";

export type ClientMsg =
  | { t: "create"; name: string; look?: Look }
  | { t: "join"; code: string; name: string; look?: Look }
  | { t: "rejoin"; code: string; token: string }
  | { t: "input"; dx: number; dy: number }
  | { t: "start" }
  | { t: "kill" }
  | { t: "report" }
  | { t: "chat"; phrase: number; target?: string }
  | { t: "vote"; target: string }; // a player id or SKIP

// Cosmetic choice (id from data/skins.json). Never tied to a role.
export interface Look {
  skin: string;
}

export interface PlayerView {
  id: string;
  name: string;
  color: string;
  look: Look;
  x: number;
  y: number;
  alive: boolean;
  away?: boolean; // connection lost, waiting for reconnection
  // Only present if the recipient is allowed to know it (themselves, killer teammate, game end).
  role?: Role;
}

export interface BodyView {
  id: string;
  color: string;
  look: Look;
  x: number;
  y: number;
}

export interface YouView {
  role?: Role;
  alive: boolean;
  // Seconds left before the next kill (killers only).
  killCooldown?: number;
}

export interface MeetingView {
  stage: MeetingStage;
  secondsLeft: number;
  reporter: string;
  body: string; // id of the player whose body was reported
  voted: string[]; // who has already voted (not for whom)
  myVote?: string;
  result?: {
    ejected?: string;
    tally: Record<string, number>; // target (or SKIP) -> vote count
    ejectedRole?: Role; // only if revealRoleOnEject
  };
}

export interface ChatLine {
  from: string;
  phrase: number;
  target?: string;
  ghost: boolean;
}

export type ServerMsg =
  | {
      t: "joined";
      code: string;
      you: string;
      token: string; // secret, only used to reconnect
      map: { width: number; height: number };
      radius: number;
      killRange: number;
      reportRange: number;
      minPlayers: number;
    }
  | {
      t: "snapshot";
      time: number;
      phase: Phase;
      host: string;
      you: YouView;
      players: PlayerView[];
      bodies: BodyView[];
      meeting?: MeetingView;
      winner?: Role;
    }
  | ({ t: "chat" } & ChatLine)
  | { t: "error"; message: string };
