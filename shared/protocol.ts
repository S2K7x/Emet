// Messages exchanged client <-> server. The client only sends intents.

// Team. Special roles (data/powers.json) are on top of the team.
export type Role = "innocent" | "killer" | "neutral";
// A team, or the id of a neutral role that wins alone (jester, vulture).
export type Winner = "innocent" | "killer" | string;
// Visible status effects drawn on a player.
export type Status = "dance" | "dj" | "shield" | "slip";
export type Phase = "lobby" | "playing" | "meeting" | "ended";
export type MeetingStage = "discussion" | "vote" | "result";
export type MeetingKind = "report" | "emergency" | "round";
export const SKIP = "skip";

export type ClientMsg =
  | { t: "create"; name: string; look?: Look }
  | { t: "join"; code: string; name: string; look?: Look }
  | { t: "rejoin"; code: string; token: string }
  | { t: "input"; dx: number; dy: number }
  | { t: "start" }
  | { t: "kill" }
  | { t: "power" }
  | { t: "task" } // start working at the station you're standing at
  | { t: "emergency" } // press the big red button
  | { t: "pick"; role: string } // role choice at game start
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
  status?: Status[];
  roleId?: string; // special role, only at game end (or yourself)
  // Only present if the recipient is allowed to know it (themselves, killer teammate, game end).
  role?: Role;
}

export interface BodyView {
  id: string;
  victim: string; // whose body it looks like (a fake body copies a living player)
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
  power?: PowerView;
  blind?: number; // vision radius while the lights are out
  tasks?: { station: string; done: boolean }[];
  working?: { station: string; progress: number }; // 0..1
  emergencies?: number; // red button presses left
  offer?: string[]; // role ids to pick from, while the choice is open
  offerLeft?: number; // seconds
}

export interface PowerView {
  id: string; // key in data/powers.json
  cooldown: number; // seconds left
  uses?: number; // left, absent = unlimited
  progress?: string; // e.g. vulture "1/3"
}

export interface ItemView {
  id: string;
  kind: "banana";
  x: number;
  y: number;
}

export interface MeetingView {
  kind: MeetingKind;
  stage: MeetingStage;
  secondsLeft: number;
  reporter: string;
  body: string; // id of the player whose body was reported, "" = emergency meeting
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
      items: ItemView[];
      clock?: { round: number; total: number }; // seconds left in the round / the game
      taskBar?: number; // 0..1, shared quest bar
      meeting?: MeetingView;
      winner?: Winner;
    }
  // One-off visual effect, shown to everyone (or only those who can see that spot).
  | { t: "fx"; kind: string; x?: number; y?: number; text?: string }
  | ({ t: "chat" } & ChatLine)
  | { t: "error"; message: string };
