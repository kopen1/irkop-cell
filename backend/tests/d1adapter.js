import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function makeD1(sqliteDb) {
  return {
    prepare(sql) {
      const stmt = sqliteDb.prepare(sql);
      const bound = (...norm) => ({
        async first(col) {
          const row = stmt.get(...norm);
          if (col && row) return row[col];
          return row ?? null;
        },
        async all(col) {
          const rows = stmt.all(...norm);
          if (col && rows.length) return rows[0][col];
          return { results: rows };
        },
        async run() {
          const r = stmt.run(...norm);
          const lastRowId = Number(r.lastInsertRowid);
          return {
            success: true,
            meta: { changes: r.changes, last_row_id: lastRowId, lastRowId },
          };
        },
      });
      return {
        bind(...args) {
          return bound(...args.map((a) => (a === undefined ? null : a)));
        },
        first(col) {
          return bound([]).first(col);
        },
        all(col) {
          return bound([]).all(col);
        },
        run() {
          return bound([]).run();
        },
      };
    },
    async batch(statements) {
      sqliteDb.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) {
          out.push(await s.run());
        }
        sqliteDb.exec('COMMIT');
        return out;
      } catch (e) {
        sqliteDb.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

export function createMemoryDb(migrationsDir = join(__dirname, '../migrations')) {
  const sqliteDb = new DatabaseSync(':memory:');
  sqliteDb.exec('PRAGMA foreign_keys = ON');
  const names = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const name of names) {
    const sql = readFileSync(join(migrationsDir, name), 'utf8');
    sqliteDb.exec(sql);
  }
  return { sqliteDb, d1: makeD1(sqliteDb) };
}