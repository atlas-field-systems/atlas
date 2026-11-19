import type { Clock } from "./clock.ts";
import type { CoreConfig } from "./config.ts";

export interface CoreOptions {
  clock: Clock;
  config: Partial<CoreConfig>;
}

export interface RunningCore {
  readonly url: string;
  readonly runId: number;
  readonly debugUrl: string | null;
  stop(): Promise<StopResult>;
}

export type StopResult =
  | { archived: true; zip: string }
  | { archived: false; explanation: string }; // reset.md#when-the-zip-fails: nothing cleared

export { startProcess as startCore } from "./process.ts";
