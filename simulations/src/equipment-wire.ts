import { Socket } from "node:net";
import { mock } from "node:test";
import { MavLinkPacketParser, MavLinkPacketSplitter, type MavLinkPacket } from "node-mavlink";

export function equipmentWire(port: number, observe: (direction: "received" | "sent", packet: MavLinkPacket) => void) {
  const received = new MavLinkPacketSplitter();
  const sent = new MavLinkPacketSplitter();
  for (const [direction, splitter] of [["received", received], ["sent", sent]] as const) {
    splitter.pipe(new MavLinkPacketParser()).on("data", (packet: MavLinkPacket) => observe(direction, packet));
  }
  const emit = Socket.prototype.emit;
  const write = Socket.prototype.write;
  const emission = mock.method(Socket.prototype, "emit", function (this: Socket, event: string | symbol, ...args: unknown[]) {
    if (this.remotePort === port && event === "data" && Buffer.isBuffer(args[0])) received.write(args[0]);
    return Reflect.apply(emit, this, [event, ...args]);
  });
  const writing = mock.method(Socket.prototype, "write", function (this: Socket, ...args: unknown[]) {
    if (this.remotePort === port && Buffer.isBuffer(args[0])) sent.write(args[0]);
    return Reflect.apply(write, this, args);
  });
  return () => { emission.mock.restore(); writing.mock.restore(); };
}
