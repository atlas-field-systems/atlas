import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { assetApp, type AssetAppOptions } from "./asset-app.ts";
import type { World } from "./world.ts";

/** World-owned TCP equipment using the app's production acquisition interface. */
export async function reportingPeripheral(w: World, options: AssetAppOptions = {}) {
  const sockets = new Set<Socket>();
  let connected: Socket | undefined;
  const server = createServer(socket => {
    sockets.add(socket);
    connected = socket;
    socket.on("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  w.onClose(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No peripheral port");
  const app = await assetApp(w, { ...options, config: {
    description: { commands: [], reports: ["telemetry"] }, initial_settings: {},
    ...options.config,
    equipment: { kind: "peripheral", host: "127.0.0.1", port: address.port, max_message_bytes: 65536, reconnect_s: 1 },
  } });
  await w.until(() => connected !== undefined);
  return { app, send(input: unknown) {
    if (!connected) throw new Error("Peripheral is disconnected");
    connected.write(JSON.stringify(input) + "\n");
  } };
}
