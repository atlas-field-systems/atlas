// Plain tables (protocol docs/storage.md): assets, tasks, telemetry, history, plus newest reports.
import { DatabaseSync } from 'node:sqlite';

export function openStore(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (asset_id TEXT PRIMARY KEY, key_hash TEXT NOT NULL, hello TEXT, last_heard INTEGER);
    CREATE TABLE IF NOT EXISTS latest (asset_id TEXT, slot TEXT, message TEXT, PRIMARY KEY (asset_id, slot));
    CREATE TABLE IF NOT EXISTS tasks (asset_id TEXT, task_id TEXT, message TEXT, task_state TEXT, explanation TEXT, PRIMARY KEY (asset_id, task_id));
    CREATE TABLE IF NOT EXISTS telemetry (asset_id TEXT, time INTEGER, message TEXT);
    CREATE TABLE IF NOT EXISTS history (asset_id TEXT, time INTEGER, type TEXT, kind TEXT, message TEXT);
  `);
  const q = (sql) => db.prepare(sql);
  const s = {
    asset: q('SELECT * FROM assets WHERE asset_id = ?'),
    addAsset: q('INSERT INTO assets (asset_id, key_hash) VALUES (?, ?)'),
    hello: q('UPDATE assets SET hello = ?, last_heard = ? WHERE asset_id = ?'),
    heard: q('UPDATE assets SET last_heard = ? WHERE asset_id = ?'),
    hellos: q('SELECT hello FROM assets WHERE hello IS NOT NULL ORDER BY asset_id'),
    setLatest: q('INSERT OR REPLACE INTO latest VALUES (?, ?, ?)'),
    latest: q('SELECT message FROM latest WHERE asset_id = ? ORDER BY slot'),
    latestOne: q('SELECT message FROM latest WHERE asset_id = ? AND slot = ?'),
    addTask: q('INSERT OR IGNORE INTO tasks (asset_id, task_id, message) VALUES (?, ?, ?)'),
    taskState: q('UPDATE tasks SET task_state = ?, explanation = ? WHERE asset_id = ? AND task_id = ?'),
    task: q('SELECT * FROM tasks WHERE asset_id = ? AND task_id = ?'),
    openTasks: q("SELECT message FROM tasks WHERE asset_id = ? AND coalesce(task_state, 'queued') IN ('queued', 'active')"),
    telemetry: q('INSERT INTO telemetry VALUES (?, ?, ?)'),
    history: q('INSERT INTO history VALUES (?, ?, ?, ?, ?)'),
    path: q('SELECT message FROM telemetry WHERE asset_id = ? AND time >= ? AND time <= ? ORDER BY time'),
    past: q('SELECT message FROM history WHERE asset_id = ? AND type = ? AND time >= ? AND time <= ? ORDER BY time'),
  };
  const rows = (st, ...a) => st.all(...a).map((r) => JSON.parse(r.message ?? r.hello));
  return {
    close: () => db.close(),
    asset: (id) => s.asset.get(id),
    addAsset: (id, hash) => s.addAsset.run(id, hash),
    saveHello: (m, now) => s.hello.run(JSON.stringify(m), now, m.asset_id),
    heard: (id, now) => s.heard.run(now, id),
    hellos: () => rows(s.hellos),
    latest: (id) => rows(s.latest, id),
    latestReport(id, report) {
      const slot = `report.${report}`;
      const r = s.latestOne.get(id, slot) ?? s.latestOne.get(id, `${slot}.asset`);
      return r && JSON.parse(r.message);
    },
    addTask: (m) => s.addTask.run(m.asset_id, m.task_id, JSON.stringify(m)),
    task: (id, t) => s.task.get(id, t),
    openTasks: (id) => rows(s.openTasks, id),
    // Every report from an Asset: telemetry is its own time series; the rest goes to history.
    report(m) {
      const slot = m.kind && m.kind !== 'task' ? `${m.type}.${m.kind}` : m.type;
      if (m.kind !== 'task') s.setLatest.run(m.asset_id, slot, JSON.stringify(m));
      if (m.type === 'report.telemetry') return s.telemetry.run(m.asset_id, m.time, JSON.stringify(m));
      s.history.run(m.asset_id, m.time, m.type, m.kind ?? null, JSON.stringify(m));
      if (m.kind === 'task') s.taskState.run(m.task_state, m.explanation ?? null, m.asset_id, m.task_id);
    },
    history(id, report = 'telemetry', since = 0, until = Number.MAX_SAFE_INTEGER) {
      return report === 'telemetry' ? rows(s.path, id, since, until) : rows(s.past, id, `report.${report}`, since, until);
    },
  };
}
