export function createDb(env) {
  const d1 = env.DB;

  async function one(sql, ...params) {
    const stmt = d1.prepare(sql).bind(...params);
    return stmt.first();
  }

  async function many(sql, ...params) {
    const stmt = d1.prepare(sql).bind(...params);
    const { results } = await stmt.all();
    return results;
  }

  async function exec(sql, ...params) {
    const stmt = d1.prepare(sql).bind(...params);
    const res = await stmt.run();
    return {
      lastRowId: res.meta?.last_row_id ?? res.meta?.lastRowId ?? null,
      changes: res.meta?.changes ?? 0,
    };
  }

  async function batch(statements) {
    if (!statements.length) return { results: [], success: true };
    const res = await d1.batch(statements);
    return { results: res, success: res.every((r) => r.success) };
  }

  return { one, many, exec, batch, raw: d1 };
}