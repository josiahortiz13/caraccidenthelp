// Postgres access. Connection string: DATABASE_URL, or Database_DATABASE_URL (the name Vercel gave the
// production Neon database, which is attached to Production only). Preview has only DATABASE_URL.
const dbUrl = () => process.env.DATABASE_URL || process.env.Database_DATABASE_URL || '';
// Same URL without sslmode / uselibpqcompat (TLS is configured on the Pool instead).
function connectionString() {
  const raw = dbUrl();
  try {
    const u = new URL(raw);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('uselibpqcompat');
    return u.toString();
  } catch {
    return raw;
  }
}
// Tests: PGLITE=1 runs an in-process Postgres (WASM) so the same SQL is exercised.
const fs = require('fs');
const path = require('path');

let impl = null;
let migrated = null;

async function getImpl() {
  if (impl) return impl;
  if (process.env.PGLITE === '1') {
    const { PGlite } = await import('@electric-sql/pglite');
    const pg = global.__crashhelpPglite || (global.__crashhelpPglite = new PGlite());
    impl = {
      query: async (text, params) => { const r = await pg.query(text, params || []); return { rows: r.rows }; },
      exec: (sql) => pg.exec(sql),
    };
  } else {
    if (!dbUrl()) throw new Error('DATABASE_URL is not set');
    const { Pool } = require('pg');
    // TLS is set here, not in the URL: an sslmode= parameter makes pg print a SECURITY WARNING on every cold start.
    // { rejectUnauthorized: true } is what sslmode=require already meant in pg 8 (full certificate check), so
    // the connection is exactly as secure as before.
    const local = /localhost|127\.0\.0\.1/.test(dbUrl());
    const pool = global.__crashhelpPool || (global.__crashhelpPool = new Pool({
      connectionString: connectionString(),
      max: 3,
      ssl: local ? false : { rejectUnauthorized: true },
    }));
    impl = {
      query: (text, params) => pool.query(text, params || []),
      exec: (sql) => pool.query(sql),
    };
  }
  return impl;
}

async function migrate() {
  if (!migrated) {
    migrated = (async () => {
      const i = await getImpl();
      await i.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    })().catch((e) => { migrated = null; throw e; });
  }
  return migrated;
}

async function query(text, params) {
  // Tests only: simulate a database outage (never honored outside PGlite).
  if (process.env.PGLITE === '1' && global.__crashhelpDbFail && (typeof global.__crashhelpDbFail !== 'function' || global.__crashhelpDbFail(text))) throw new Error('Simulated database outage');
  await migrate();
  const i = await getImpl();
  return i.query(text, params);
}

async function one(text, params) {
  const r = await query(text, params);
  return r.rows[0] || null;
}

module.exports = { configured: () => !!dbUrl() || process.env.PGLITE === '1', query, one, migrate };
