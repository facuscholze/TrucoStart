/**
 * Emite los EXPLAIN ANALYZE de las consultas críticas (lobby, login,
 * historial, estadísticas) sobre una base PostgreSQL sembrada para
 * documentar el plan de ejecución en docs/PERF.md.
 *
 * Uso en CI: DATABASE_URL=postgres://... node scripts/perf/explain-critical.mjs
 */
import { Client } from 'pg';

async function main() {
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();
  const queries = [
    {
      name: 'Lobby público (listado con filtros)',
      sql: `EXPLAIN (ANALYZE, BUFFERS)
        SELECT t.* FROM tables t
        WHERE t.visibility = 'PUBLIC' AND t.status IN ('WAITING','IN_GAME')
        ORDER BY t.created_at DESC LIMIT 25;`,
    },
    {
      name: 'Login por email',
      sql: `EXPLAIN (ANALYZE, BUFFERS)
        SELECT * FROM users WHERE email = 'juan@example.com' LIMIT 1;`,
    },
    {
      name: 'Login por nickname',
      sql: `EXPLAIN (ANALYZE, BUFFERS)
        SELECT * FROM users WHERE nickname_lower = 'juan' LIMIT 1;`,
    },
    {
      name: 'Historial de un usuario (paginado)',
      sql: `EXPLAIN (ANALYZE, BUFFERS)
        SELECT m.id, m.mode, m.started_at, m.ended_at, mp.seat, mp.team, mp.score, mp.outcome
        FROM match_players mp
        INNER JOIN matches m ON mp.match_id = m.id
        WHERE mp.user_id = (SELECT id FROM users LIMIT 1)
        ORDER BY mp.match_id DESC LIMIT 20;`,
    },
    {
      name: 'Estadísticas de un usuario (agg simple)',
      sql: `EXPLAIN (ANALYZE, BUFFERS)
        SELECT outcome, count(*) FROM match_players
        WHERE user_id = (SELECT id FROM users LIMIT 1)
        GROUP BY outcome;`,
    },
    {
      name: 'Barrido de salas expiradas',
      sql: `EXPLAIN (ANALYZE, BUFFERS)
        SELECT id FROM tables
        WHERE (status = 'WAITING' AND expires_at <= now())
           OR (status = 'IN_GAME' AND updated_at <= now() - interval '30 minutes')
        FOR UPDATE;`,
    },
    {
      name: 'Asientos activos para snapshot de lobby',
      sql: `EXPLAIN (ANALYZE, BUFFERS)
        SELECT * FROM table_seats WHERE is_active = true AND table_id IN (
          SELECT id FROM tables WHERE visibility='PUBLIC' AND status IN ('WAITING','IN_GAME')
          ORDER BY created_at DESC LIMIT 25
        ) ORDER BY table_id, seat;`,
    },
    {
      name: 'Reportes abiertos (cola moderación)',
      sql: `EXPLAIN (ANALYZE, BUFFERS)
        SELECT * FROM reports WHERE status IN ('OPEN','IN_REVIEW')
        ORDER BY created_at DESC LIMIT 50;`,
    },
  ];

  const out = [];
  for (const q of queries) {
    const result = await db.query(q.sql);
    out.push(
      `\n### ${q.name}\n\n\`\`\`\n${result.rows.map((r) => Object.values(r)[0]).join('\n')}\n\`\`\`\n`,
    );
  }
  console.log(out.join('\n'));
  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
