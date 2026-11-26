export const MAX_EVENT_FRAME_BYTES = 16 * 1024 * 1024;

export function eventFrame(event: { event_id: number; kind: string }) {
  return `id: ${event.event_id}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}
