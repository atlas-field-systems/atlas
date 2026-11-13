export { loadProtocol } from './browser.js';
export type { DefinitionFiles, CheckResult, Protocol } from './browser.js';
import type { Protocol } from './browser.js';
export function loadPackagedProtocol(): Promise<Protocol>;
