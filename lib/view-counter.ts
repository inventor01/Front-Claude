export const DASHBOARD_VIEW_SCOPE = 'dashboard';

type BoundStatement = {
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};

type ViewDatabase = {
  prepare(sql: string): {
    bind(...values: unknown[]): BoundStatement;
  };
};

export function normalizeViewSessionId(value: unknown) {
  if (typeof value !== 'string') return null;
  const sessionId = value.trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(sessionId)) return null;
  return sessionId;
}

export async function dashboardViewCount(database: ViewDatabase) {
  const row = await database
    .prepare('SELECT COUNT(*) AS count FROM front_page_views WHERE scope=?')
    .bind(DASHBOARD_VIEW_SCOPE)
    .first<{ count?: number | string }>();
  const count = Number(row?.count ?? 0);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

export async function registerDashboardView(
  database: ViewDatabase,
  sessionIdValue: unknown,
  observedAt = Date.now(),
) {
  const sessionId = normalizeViewSessionId(sessionIdValue);
  if (!sessionId) throw new Error('Invalid view session id.');

  const timestamp = Number(observedAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error('Invalid view timestamp.');
  }

  await database
    .prepare(
      'INSERT OR IGNORE INTO front_page_views(scope,session_id,first_seen) VALUES(?,?,?)',
    )
    .bind(DASHBOARD_VIEW_SCOPE, sessionId, Math.trunc(timestamp))
    .run();

  return dashboardViewCount(database);
}
