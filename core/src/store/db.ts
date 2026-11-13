import { DatabaseSync } from "node:sqlite";
import { appendEvent } from "./events.ts";
import { refuse } from "../api/errors.ts";
import type { Env } from "../core.ts";
import type { EventKind, EventExtra, RecordOf } from "./events.ts";

export type Sync<T> = T extends PromiseLike<unknown> ? never : T;

export type SqlValue = null | number | bigint | string | Uint8Array;

export interface ReadTx {
  readonly env: Env;
  readonly runId: number;
  readonly now: number;
  all<R>(sql: string, ...params: SqlValue[]): R[];
  get<R>(sql: string, ...params: SqlValue[]): R | undefined;
  asOf(): number;
}

export interface Tx extends ReadTx {
  run(sql: string, ...params: SqlValue[]): { changes: number };
  append<K extends EventKind>(
    kind: K,
    record: RecordOf<K>,
    extra?: EventExtra,
  ): number;
}

export interface Store {
  read<T>(fn: (tx: ReadTx) => Sync<T>): T;
  write<T>(fn: (tx: Tx) => Sync<T>): T;
  onCommit(listener: (lastEventId: number) => void): () => void;
  setRun(runId: number): void;
  close(): void;
}

export type Owner =
  | "shared"
  | "entities"
  | "tasks"
  | "objects"
  | "administration"
  | "fusion";
export interface TableDef {
  owner: Owner;
  name: string;
  ddl: string;
  runScoped: boolean;
}

export function openStore(env: Env, tables: readonly TableDef[]): Store {
  const db = new DatabaseSync(env.paths.database);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
  );
  const names = new Set<string>();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const table of tables) {
      if (names.has(table.name))
        throw new Error(`duplicate table ${table.name}`);
      names.add(table.name);
      db.exec(table.ddl);
    }
    db.exec("PRAGMA user_version=1; COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    db.close();
    throw e;
  }
  let runId = 0;
  const listeners = new Set<(id: number) => void>();
  const statements = new Map<string, ReturnType<typeof db.prepare>>();
  const stmt = (sql: string) => {
    let s = statements.get(sql);
    if (!s) {
      s = db.prepare(sql);
      statements.set(sql, s);
    }
    return s;
  };
  const handle = (): Tx => ({
    env,
    runId,
    now: env.clock.now(),
    all: <R>(sql: string, ...params: SqlValue[]) =>
      stmt(sql).all(...params) as R[],
    get: <R>(sql: string, ...params: SqlValue[]) =>
      stmt(sql).get(...params) as R | undefined,
    run: (sql, ...params) => ({
      changes: Number(stmt(sql).run(...params).changes),
    }),
    asOf: () =>
      Number(
        stmt("SELECT seq FROM sqlite_sequence WHERE name='events'").get()
          ?.seq ?? 0,
      ),
    append(kind, record, extra) {
      return appendEvent(this, kind, record, extra);
    },
  });
  return {
    read(fn) {
      db.exec("BEGIN");
      try {
        const value = fn(handle());
        db.exec("COMMIT");
        return value;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    write(fn) {
      let began = false;
      try {
        db.exec("BEGIN IMMEDIATE");
        began = true;
        const tx = handle();
        const value = fn(tx);
        if (value instanceof Promise) throw new Error("async transaction");
        db.exec("COMMIT");
        setImmediate(() => {
          for (const listener of listeners) listener(tx.asOf());
        });
        return value;
      } catch (e) {
        if (began) db.exec("ROLLBACK");
        if (
          e instanceof Error &&
          ([10, 13].includes(Number(Reflect.get(e, "errcode")) & 255) ||
            /SQLITE_(FULL|IOERR)/.test(
              String(Reflect.get(e, "code")) + " " + e.message,
            ))
        )
          refuse("storage_full", "Core could not store the change");
        throw e;
      }
    },
    onCommit(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setRun(id) {
      runId = id;
    },
    close() {
      listeners.clear();
      db.close();
    },
  };
}
