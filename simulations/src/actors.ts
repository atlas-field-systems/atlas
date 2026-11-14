import { startAsset, runAsset, startPlugin, type AssetLink, type AssetEvent, type Report } from "@atlas/sdk";
import type { ProtocolTypes as P } from "@atlas/protocol/types";
import { type World, value } from "./world.ts";
export const description: P["requests.asset"] = { entity_type:"ground_vehicle", commands:["hold","return_to_home"], reports:["status","settings"], settings:["lights"] };
export async function ipAsset(w: World, name = "asset") {
  const issued = value(await w.complete(w.admin.call<"createAssetKey", { key_id:string; key:string }>("createAssetKey")));
  const client = w.client(name,{kind:"asset",key:issued.key});
  const starts: number[] = [], stops: number[] = [];
  const result = await w.complete(startAsset(client,{ clock:w.clock,description,settings:() => ({}),queue:{ runNow:t => starts.push(t.task_id),stop:id => stops.push(id),update(){} } }));
  if (!result.ok) throw new Error(result.explanation);
  const session = result.value;
  w.onClose(() => session.stop());
  return { client, session, starts, stops };
}
export async function radioAsset(w: World) {
  const issued = value(await w.complete(w.admin.call<"provisionGateway", { gateway_id:string; key:string }>("provisionGateway")));
  const client = w.client("gateway",{kind:"gateway",key:issued.key});
  value(await w.complete(client.connect()));
  const radio = value(await w.complete(client.call<"registerRadio", { asset_id:string; as_of:number }>("registerRadio",{body:{definitions_hash:w.protocol.hash}})));
  const asset_id = radio.asset_id;
  value(await w.complete(client.call("describeAsset",{params:{asset_id},body:{...description,time:w.clock.now(),asset_id}})));
  value(await w.complete(client.call("putContact",{params:{asset_id},body:{time:w.clock.now(),asset_id,contact:"online"}})));
  const pending: AssetEvent[] = [], reports: Report[] = [], starts: number[] = [];
  let wake: (() => void) | undefined, closed = false;
  const link: AssetLink = {
    async *events() { while (!closed) { if (pending.length) yield pending.shift()!; else await new Promise<void>(resolve => { wake = resolve; }); } },
    async sendReports(batch) {
      reports.push(...batch);
      let result = await client.call("sendReports",{params:{asset_id},body:{reports:batch}});
      while (!result.ok && result.retry) result = await result.retry();
      return result.ok ? {ok:true} : {ok:false,error:"refused",explanation:result.explanation};
    },
    onContact: () => () => {}, capacity:() => 1200,
    storeFile: async () => ({ok:false,error:"unsupported",explanation:"This simulated radio cannot carry files"}),
  };
  const session = runAsset(link,{asset_id,after:radio.as_of,last_task_id:0},{clock:w.clock,settings:() => ({}),queue:{runNow:t => starts.push(t.task_id),stop(){},update(){}}});
  w.onClose(() => { closed = true; wake?.(); session.stop(); });
  return { client, asset_id, session, reports, starts,
    deliver(event: AssetEvent) { pending.push(structuredClone(event)); wake?.(); },
    close() { closed = true; wake?.(); session.stop(); },
  };
}
export async function plugin(w: World, onCall: Parameters<typeof startPlugin>[1]["onCall"]) {
  const issued = value(await w.complete(w.admin.call<"provisionPlugin", {plugin_id:string;key:string}>("provisionPlugin")));
  const client = w.client("plugin",{kind:"plugin",key:issued.key,plugin_id:issued.plugin_id});
  const description: P["plugin.description"] = { type:"plugin.description", time:w.clock.now(), plugin_id:issued.plugin_id, name:"Survey", actions:[{action:"scan",label:"Scan",inputs:[]}] };
  const session = startPlugin(client,{description,onCall});
  w.onClose(() => session.stop());
  await w.settle();
  return {client,session,plugin_id:issued.plugin_id};
}
