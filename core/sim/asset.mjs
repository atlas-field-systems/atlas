// A simulated drone that speaks protocol 0.5 to Core and flies takeoff, move_to and land.
// speed: how much faster than real time it flies (tests use a large value).
import WebSocket from 'ws';
import { VERSION } from '../src/protocol.mjs';

const M_PER_DEG = 111320;

export function startAsset({ url, asset_id = 'A1', key, enrollment_key, home = { latitude: 42.2746, longitude: -71.8063 }, speed = 1, log = () => {} }) {
  const q = new URLSearchParams({ asset_id, key, ...(enrollment_key && { enrollment_key }) });
  const ws = new WebSocket(`${url}/asset?${q}`);
  let seq = 0;
  const pos = { ...home, alt: 0 };
  const queue = []; // Tasks, kept in task_seq order
  let active = null; // { task_id?, kind, target }
  let ground = 0;
  const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify({ type: m.type, time: Date.now(), seq: seq++, asset_id, ...m }));
  const telemetry = () => send({ type: 'report.telemetry', position: { latitude: +pos.latitude.toFixed(6), longitude: +pos.longitude.toFixed(6), altitudes: [{ altitude_m: +pos.alt.toFixed(1), altitude_reference: 'home' }] }, ground_speed_mps: +ground.toFixed(1), heading_deg: 0 });
  const taskState = (task_id, task_state) => task_id && send({ type: 'report.status', kind: 'task', task_id, task_state });
  const reportQueue = () => send({ type: 'report.status', kind: 'queue', task_ids: queue.map((t) => t.task_id) });

  ws.on('open', () => {
    send({ type: 'admin.hello', protocol_version: VERSION, reports: ['status', 'failsafe', 'telemetry', 'battery', 'settings'], commands: ['takeoff', 'move_to', 'land'] });
  });
  ws.on('message', (data) => {
    const m = JSON.parse(data);
    if (m.type === 'admin.hello_reply') {
      if (m.hello_result !== 'accepted') return ws.close();
      send({ type: 'report.settings', run_state: 'running', lights: 'off', landing_gear: 'down', link_loss_response: 'return_to_home' });
      send({ type: 'report.status', kind: 'asset', condition: 'healthy' });
      telemetry();
      send({ type: 'report.battery', battery_percent: 100 });
      return;
    }
    if (m.type !== 'control.command') return log(`sim ignores ${m.type}`);
    if (!m.task_id) { // runs now and cancels the queue
      for (const t of queue.splice(0)) taskState(t.task_id, 'cancelled');
      if (active) taskState(active.task_id, 'cancelled');
      active = m; reportQueue(); return;
    }
    if (queue.some((t) => t.task_id === m.task_id) || active?.task_id === m.task_id) return;
    queue.push(m); queue.sort((a, b) => a.task_seq - b.task_seq); reportQueue();
  });

  // One step of flight. Climb 3 m/s, cruise 8 m/s, descend 2 m/s (times speed).
  const dt = 0.1;
  let ticks = 0;
  const tick = setInterval(() => {
    if (!active && queue.length) { active = queue.shift(); taskState(active.task_id, 'active'); }
    if (!active) { ground = 0; return; }
    const step = dt * speed;
    let done = false;
    const fly = (to, alt) => {
      if (Math.abs(pos.alt - alt) > 0.1) { pos.alt += Math.sign(alt - pos.alt) * Math.min(3 * step, Math.abs(alt - pos.alt)); ground = 0; return false; }
      const dy = (to.latitude - pos.latitude) * M_PER_DEG, dx = (to.longitude - pos.longitude) * M_PER_DEG * Math.cos(pos.latitude * Math.PI / 180);
      const d = Math.hypot(dx, dy), go = Math.min(8 * step, d);
      if (d < 0.5) { ground = 0; return true; }
      pos.latitude += (dy / d) * go / M_PER_DEG; pos.longitude += (dx / d) * go / (M_PER_DEG * Math.cos(pos.latitude * Math.PI / 180)); ground = 8;
      return false;
    };
    if (active.kind === 'takeoff') { const a = active.target_altitude.altitude_m; pos.alt = Math.min(a, pos.alt + 3 * step); done = pos.alt >= a; }
    if (active.kind === 'move_to') done = fly(active.destination, active.destination.altitudes?.[0]?.altitude_m ?? pos.alt);
    if (active.kind === 'land') {
      if (!active.over) active.over = fly(active.landing_position, active.transit_altitude?.altitude_m ?? pos.alt);
      else { pos.alt = Math.max(0, pos.alt - 2 * step); done = pos.alt === 0; }
    }
    if (done || ++ticks % 5 === 0) telemetry();
    if (done) { taskState(active.task_id, 'completed'); active = null; if (!queue.length) send({ type: 'report.battery', battery_percent: 92 }); }
  }, dt * 1000);

  return { ws, close: () => { clearInterval(tick); ws.close(); } };
}
