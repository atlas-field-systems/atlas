import type { ComponentsPosition } from "@atlas/protocol/types";
export type Measurement<T> = {
  value: T;
  source: string | null;
  time: number | null;
};
export interface Measurements {
  position?: Measurement<ComponentsPosition>;
  battery?: Measurement<number>;
  armed?: Measurement<boolean>;
  airborne?: Measurement<boolean>;
  mode?: Measurement<number>;
  speed?: Measurement<number>;
}
export type { VehicleCommand } from "./commands.ts";
import type { VehicleCommand } from "./commands.ts";
export interface Vehicle {
  start(observe: (measurements: Measurements) => void): void;
  heartbeat(): void;
  command(command: VehicleCommand): Promise<void>;
  stop(): void;
}
export function fresh<T>(
  m: Measurement<T> | undefined,
  now: number,
  age: number,
): T | undefined {
  return m?.time !== null && m?.time !== undefined && now - m.time <= age * 1000
    ? m.value
    : undefined;
}
export function distance(a: ComponentsPosition, b: ComponentsPosition) {
  const rad = Math.PI / 180;
  return (
    6371000 *
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin(((a.latitude - b.latitude) * rad) / 2) ** 2 +
            Math.cos(a.latitude * rad) *
              Math.cos(b.latitude * rad) *
              Math.sin(((a.longitude - b.longitude) * rad) / 2) ** 2,
        ),
      ),
    )
  );
}
