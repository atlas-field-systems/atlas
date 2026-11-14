import type {
  ClientOptions,
  Credential,
  About,
  Result,
  Json,
} from "./client.ts";
import type { diagnostics } from "./diagnostics.ts";

type Internals = {
  options: ClientOptions<Credential>;
  emit: ReturnType<typeof diagnostics>;
  readonly epoch: number;
  verifyRun(): Promise<Result<About>>;
  streamFetch(
    after: number,
    asset_id: string | undefined,
    signal: AbortSignal,
  ): Promise<Response>;
  streamResponse(response: Response): Promise<Result<Json>>;
};
export const internals = new WeakMap<object, Internals>();
export function internal(client: object): Internals {
  const state = internals.get(client);
  if (!state) throw new Error("Unknown SDK client");
  return state;
}
