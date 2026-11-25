import type { ProtocolTypes } from "@atlas/protocol/types";
import type { AssetEvent, Report } from "@atlas/sdk";

export type Description = ProtocolTypes["requests.asset"];
export interface Registration {
  run: number;
  assetId: string;
  after: number;
  lastTaskId: number;
}

export interface GatewayHost {
  carried(): Promise<{ assetId: string; lastHeard?: number }[]>;
  onEvent(listener: (assetId: string) => void): () => void;
  bind(peer: string, profile: { hash: string; description: Description; session: string; resume?: Registration }): Promise<Registration>;
  refuseDefinitions(peer: string, profile: { hash: string; session: string }): Promise<void>;
  next(assetId: string, after: number): AssetEvent | undefined;
  store(assetId: string, submission: number, reports: Report[]): Promise<void>;
  // Queues a transition until Core confirms it in order or the Asset is removed.
  contact(assetId: string, open: boolean, lastHeard: number): Promise<void>;
}

export class ReportRefused extends Error {}
export class AssetRemoved extends Error {}
