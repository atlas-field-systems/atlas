import type { ComponentsFailsafeCondition, ComponentsPosition } from "@atlas/protocol/types";

type Boundary = Extract<ComponentsFailsafeCondition, { kind: "outside_area" }>;

export function outsideBoundary(position: ComponentsPosition, condition: Boundary) {
  const rad = Math.PI / 180;
  const scale = 6371000 * rad;
  let longitude = position.longitude;
  const points = condition.area.map(p => {
    longitude += ((p.longitude - longitude + 180) % 360 + 360) % 360 - 180;
    return {
      x: (longitude - position.longitude) * scale * Math.cos(position.latitude * rad),
      y: (p.latitude - position.latitude) * scale,
    };
  });
  let inside = false;
  let nearest = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    if ((a.y > 0) !== (b.y > 0) && 0 < a.x + (b.x - a.x) * -a.y / (b.y - a.y)) inside = !inside;
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSquared));
    nearest = Math.min(nearest, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  const margin = condition.margin_m ?? 0;
  if (!inside && nearest > margin) return true;
  for (const [limit, direction] of [[condition.max_altitude, 1], [condition.min_altitude, -1]] as const) {
    if (!limit) continue;
    const height = position.altitudes?.find(a => a.altitude_reference === limit.altitude_reference);
    if (height && direction * (height.altitude_m - limit.altitude_m) > margin) return true;
  }
  return false;
}
