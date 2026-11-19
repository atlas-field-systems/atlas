import { isFinal } from './protocol.ts';
import type { Task, Rule, Condition, Command } from './protocol.ts';

export class FlightController {
  armed = false;
  mode = 'ground';
  heartbeat: number | null = null;
  attempts: string[] = [];
  execute(command: Command) { this.mode = command.kind; this.attempts.push(command.kind); if (command.kind === 'takeoff') this.armed = true; }
  tick(now: number) { if (this.armed && this.heartbeat !== null && now - this.heartbeat > 5000) this.mode = 'return_to_home'; }
}
export class Asset {
  alive = true;
  failsafe = false;
  paused = false;
  clear_count = 0;
  battery = 100;
  contact = true;
  priority = -1;
  response: Command | null = null;
  override: string | null = null;
  active: Task | null = null;
  tasks = new Map<number, Task>();
  states = new Map<number, string>();
  rearmed = new Map<string, boolean>();
  reports: { task_id: number; task_state: string }[] = [];
  policy: Rule[]; fc: FlightController;
  constructor(policy: Rule[], fc = new FlightController()) { this.policy = policy; this.fc = fc; }
  state(task: Task, value: string) { this.states.set(task.task_id, value); this.reports.push({ task_id: task.task_id, task_state: value }); }
  clear() { for (const t of this.tasks.values()) if (!isFinal(this.states.get(t.task_id) ?? 'queued')) this.state(t, 'cancelled'); this.active = null; this.clear_count++; }
  receive(task: Task) {
    if (!this.alive) return;
    if (isFinal(this.states.get(task.task_id) ?? 'queued')) return;
    if (this.tasks.has(task.task_id)) { if (JSON.stringify(this.tasks.get(task.task_id)) === JSON.stringify(task)) return; this.tasks.set(task.task_id, task); if (this.active?.task_id === task.task_id) { this.active = task; this.fc.execute(task); } return; }
    this.tasks.set(task.task_id, task);
    if (this.failsafe && !(task.now && ['hold', 'land', 'return_to_home'].includes(task.kind))) { this.state(task, 'failed'); return; }
    if (task.now) {
      for (const old of this.tasks.values()) if (old.task_id < task.task_id && !isFinal(this.states.get(old.task_id) ?? 'queued')) this.state(old, 'cancelled');
      this.active = null;
      if (task.kind === 'failsafe') { this.fireCommand(); this.state(task, 'completed'); return; }
      if (this.failsafe) this.setOverride(task.kind);
      this.start(task); this.evaluate(); return;
    }
    if (task.clear_count !== this.clear_count) { this.state(task, 'cancelled'); return; }
    this.state(task, 'queued'); this.advance();
  }
  advance() {
    if (this.active || this.paused || this.failsafe || !this.alive) return;
    const task = [...this.tasks.values()].sort((a,b) => a.task_id - b.task_id).find(t => this.states.get(t.task_id) === 'queued');
    if (!task) return;
    for (let id = 1; id < task.task_id; id++) if (!isFinal(this.states.get(id) ?? 'missing')) return;
    for (let id = task.task_id; id <= task.send_last; id++) if (!this.tasks.has(id)) return;
    this.start(task);
  }
  start(task: Task) { this.active = task; this.state(task, 'active'); this.fc.execute(task); }
  observeCompletion(success = true) {
    if (!this.active) return;
    this.state(this.active, success ? 'completed' : 'failed'); this.active = null;
    if (!success) this.clear(); else this.advance();
  }
  matches(c: Condition, commanded = false) {
    switch (c.kind) {
      case 'battery_below': return this.battery < c.battery_percent!;
      case 'contact_lost': return !this.contact;
      case 'airborne': return this.fc.armed;
      case 'commanded': return commanded;
      default: return false; // Unsupported equipment conditions are explicit shortcuts.
    }
  }
  fireCommand() {
    const rule = [...this.policy].sort((a,b) => b.priority - a.priority).find(r => r.conditions.some(c => c.kind === 'commanded') && r.conditions.every(c => this.matches(c, true)));
    this.activate(rule?.response ?? { kind: 'land' }, rule?.priority ?? -1);
  }
  activate(command: Command, priority: number) {
    this.clear(); this.failsafe = true; this.paused = false; this.override = null;
    this.priority = Math.max(this.priority, priority); this.response = command; this.fc.execute(command);
  }
  setOverride(kind: string) {
    this.override = kind;
    if (kind === 'hold' || kind === 'pause') for (const r of this.policy) if (r.conditions.some(c => ['contact_lost', 'battery_below'].includes(c.kind))) this.rearmed.set(r.rule_id, !r.conditions.every(c => this.matches(c)));
  }
  pause() { this.paused = true; if (this.failsafe) this.setOverride('pause'); this.fc.mode = 'hold'; this.evaluate(); }
  evaluate() {
    if (!this.alive) return;
    for (const rule of [...this.policy].sort((a,b) => b.priority - a.priority)) {
      const match = rule.conditions.every(c => this.matches(c));
      if (!match && this.rearmed.has(rule.rule_id)) this.rearmed.set(rule.rule_id, true);
      if (!match) continue;
      const critical = rule.conditions.some(c => c.critical);
      const criticalOverride = critical && ['hold', 'pause'].includes(this.override ?? '');
      if (this.override === 'land' || this.override === 'return_to_home') continue;
      if (!this.failsafe || rule.priority > this.priority || this.rearmed.get(rule.rule_id) || criticalOverride || (critical && this.response !== rule.response)) {
        this.rearmed.delete(rule.rule_id); this.activate(rule.response, rule.priority); return;
      }
    }
  }
  tick(now: number) { if (this.alive) { this.fc.heartbeat = now; this.evaluate(); } this.fc.tick(now); }
  crash() { this.alive = false; }
  restartOnGround() {
    if (this.fc.armed) throw new Error('inspect vehicle before ground restart');
    this.clear(); this.alive = true; this.failsafe = false; this.priority = -1;
  }
}
