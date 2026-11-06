// A simulated drone that speaks the protocol to Core and flies takeoff, move_to and land,
// with the link-loss and low-battery failsafes.
// speed: how much faster than real time it flies (tests use a large value).
import WebSocket from 'ws';
import { VERSION } from '../src/version.mjs';

const M_PER_DEG = 111320;
const LOW_BATTERY = 20;

export function startAsset({ url, asset_id = 'A1', key, enrollment_key, home = { latitude: 42.2746, longitude: -71.8063 }, speed = 1, log = () => {} }) {
  let ws, linked = false, wanted = true, seq = 0, retry;
  const pos = { ...home, alt: 0 };
  const settings = { run_state: 'running', lights: 'off', landing_gear: 'down', link_loss_response: 'return_to_home', low_battery_response: 'land', telemetry_every_s: 0.5 };
  let battery = 100, lowBattery = false;
  const queue = []; // Tasks, kept in task_seq order
  let active = null; // a command, or a failsafe move { kind, failsafe: true }
  let ground = 0;
  const outbox = []; // reports kept while the link is down, sent once it is back
  const send = (m) => {
    const out = { type: m.type, time: Date.now(), seq: seq++, asset_id, ...m };
    if (linked && ws.readyState === 1) ws.send(JSON.stringify(out));
    else if (m.type !== 'report.telemetry') outbox.push(out);
  };
  const telemetry = () => send({ type: 'report.telemetry', position: { latitude: +pos.latitude.toFixed(6), longitude: +pos.longitude.toFixed(6), altitudes: [{ altitude_m: +pos.alt.toFixed(1), altitude_reference: 'home' }] }, ground_speed_mps: +ground.toFixed(1), heading_deg: 0 });
  const taskState = (task_id, task_state, explanation) => task_id && send({ type: 'report.status', kind: 'task', task_id, task_state, ...(explanation && { explanation }) });
  const reportQueue = () => send({ type: 'report.status', kind: 'queue', task_ids: queue.map((t) => t.task_id) });

  // A failsafe stops the queue and acts by itself (law 19).
  function failsafe(kind, response, explanation) {
    send({ type: 'report.failsafe', kind, response, explanation });
    if (response === 'continue') return;
    if (active && !active.failsafe) taskState(active.task_id, 'failed', explanation);
    for (const t of queue.splice(0)) taskState(t.task_id, 'cancelled');
    reportQueue();
    const at = response === 'return_to_home' ? home : response === 'land_at' ? settings.land_at_position : pos;
    active = response === 'hold' ? null : { kind: 'land', failsafe: true, landing_position: { latitude: at.latitude, longitude: at.longitude } };
  }

  function connect() {
    ws = new WebSocket(`${url}/asset`);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'admin.hello', time: Date.now(), seq: seq++, asset_id, protocol_version: VERSION, key, ...(enrollment_key && { enrollment_key }), reports: ['status', 'failsafe', 'telemetry', 'battery', 'settings'], commands: ['takeoff', 'move_to', 'land'] })));
    ws.on('error', () => {});
    ws.on('close', () => {
      const was = linked; linked = false;
      if (was && pos.alt > 0) failsafe('link_loss', settings.link_loss_response, 'Link to Core lost');
      if (wanted) retry = setTimeout(connect, 500);
    });
    ws.on('message', (data) => {
      const m = JSON.parse(data);
      if (m.type === 'admin.hello_reply') {
        if (m.hello_result !== 'accepted') { wanted = false; return ws.close(); }
        enrollment_key = undefined; linked = true;
        send({ type: 'report.settings', ...settings });
        send({ type: 'report.status', kind: 'asset', condition: 'healthy' });
        telemetry();
        send({ type: 'report.battery', battery_percent: battery });
        for (const o of outbox.splice(0)) ws.send(JSON.stringify(o));
        return reportQueue();
      }
      if (m.type === 'control.settings' && !m.task_id) {
        const { type, time, seq: s, asset_id: a, ...change } = m;
        Object.assign(settings, change);
        return send({ type: 'report.settings', reply_to: m.seq, ...settings });
      }
      if (m.type !== 'control.command') return log(`sim ignores ${m.type}`);
      if (!m.task_id) { // runs now and cancels the queue
        for (const t of queue.splice(0)) taskState(t.task_id, 'cancelled');
        if (active?.task_id) taskState(active.task_id, 'cancelled');
        active = m; reportQueue(); return;
      }
      if (queue.some((t) => t.task_id === m.task_id) || active?.task_id === m.task_id) return;
      queue.push(m); queue.sort((a, b) => a.task_seq - b.task_seq); reportQueue();
    });
  }
  connect();

  // One step of flight. Climb 3 m/s, cruise 8 m/s, descend 2 m/s (times speed).
  const dt = 0.1;
  let sinceTelemetry = 0;
  const tick = setInterval(() => {
    if (battery < LOW_BATTERY && !lowBattery && pos.alt > 0) { lowBattery = true; failsafe('low_battery', settings.low_battery_response, `Battery at ${battery}%`); }
    if (!active && queue.length && !lowBattery) { active = queue.shift(); taskState(active.task_id, 'active'); }
    const step = dt * speed;
    let done = false;
    // Telemetry every telemetry_every_s of sim time, on the ground too, and when a move ends.
    const beat = () => { if ((sinceTelemetry += step) >= settings.telemetry_every_s || done) { sinceTelemetry = 0; telemetry(); } };
    if (!active) { ground = 0; return beat(); }
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
    beat();
    if (done) {
      taskState(active.task_id, 'completed'); active = null;
      if (!queue.length) { battery = Math.max(0, battery - 8); send({ type: 'report.battery', battery_percent: battery }); }
    }
  }, dt * 1000);

  return {
    get ws() { return ws; },
    get position() { return { ...pos }; },
    // Test hooks: drop the link (it comes back after `ms`), or set the battery.
    cutLink(ms = 1000) { wanted = false; ws.terminate(); setTimeout(() => { wanted = true; connect(); }, ms); },
    setBattery(p) { battery = p; send({ type: 'report.battery', battery_percent: p }); },
    close: () => { wanted = false; clearInterval(tick); clearTimeout(retry); ws.close(); },
  };
}
