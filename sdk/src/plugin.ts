import { internal } from "./internal.ts";
import type { ProtocolTypes as P } from "@atlas/protocol/types";
import type { Client, Result } from "./client.ts";
import { follow, type FollowEnd } from "./stream.ts";
export interface Reply {
  createGeofeature(
    body: P["requests.geofeature"],
  ): Promise<Result<{ geofeature: P["geofeature"]; event_id: number }>>;
  uploadObject(
    bytes: Uint8Array,
    contentType: string,
    name: string,
  ): Promise<Result<{ object_id: string; event_id: number }>>;
  answer(
    body:
      | Omit<P["plugin.result"], "request_id">
      | Omit<P["plugin.failure"], "request_id">,
  ): Promise<Result<unknown>>;
}
export function startPlugin(
  client: Client<{ kind: "plugin"; key: string; plugin_id: string }>,
  options: {
    description: P["plugin.description"];
    onCall(
      call: P["plugin.call"],
      reply: Reply,
      event_id: number,
    ): void | Promise<void>;
  },
) {
  let stopped = false,
    stream: ReturnType<typeof follow> | undefined,
    contact: ReturnType<typeof client.holdContact> | undefined;
  const credential = internal(client).options.credential;
  if (credential.kind !== "plugin") throw new Error("Expected Plugin credential");
  const plugin_id = credential.plugin_id;
  const done = (async (): Promise<FollowEnd> => {
    while (!stopped) {
      const connected = await client.connect();
      if (!connected.ok)
        return {
          reason:
            connected.error === "definitions_mismatch"
              ? "definitions_mismatch"
              : "closed",
        };
      const described = await client.call("describePlugin", { params: { plugin_id }, body: options.description });
      if (!described.ok)
        return {
          reason:
            described.error === "unauthenticated"
              ? "unauthenticated"
              : "closed",
        };
      contact = client.holdContact();
      stream = follow(
        client as Client,
        { after: described.value.event_id },
        async (e) => {
          if (e.kind !== "plugin.called") return;
          let answered = false;
          const request_id = e.event_id;
          const reply: Reply = {
            createGeofeature: (body) =>
              client.call("createGeofeature", { body, query: { request_id } }),
            uploadObject: (bytes, contentType, name) =>
              client.uploadObject(bytes, contentType, { name, request_id }),
            answer(body) {
              if (answered)
                throw new Error("A Plugin call has only one answer");
              answered = true;
              return client.call("answerPlugin", {
                params: { plugin_id },
                body: { ...body, request_id } as
                  | P["plugin.result"]
                  | P["plugin.failure"],
              });
            },
          };
          await options.onCall(e.record, reply, e.event_id);
        },
      );
      const end = await stream.done;
      contact.stop();
      if (end.reason !== "run_ended") return end;
    }
    return { reason: "stopped" };
  })();
  return {
    done,
    stop() {
      stopped = true;
      stream?.stop();
      contact?.stop();
    },
  };
}
