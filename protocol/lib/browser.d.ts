export type DefinitionFiles = Map<string, Uint8Array>;
export type CheckResult = { ok: true } | { ok: false; problems: { path: string; message: string }[] };
export interface Protocol {
  readonly hash: `sha256:${string}`;
  readonly names: readonly string[];
  check(name: string, value: unknown): CheckResult;
}
export function loadProtocol(files: DefinitionFiles): Promise<Protocol>;
