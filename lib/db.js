// Postgres access. Connection string: DATABASE_URL, or Database_DATABASE_URL (the name Vercel gave the
// production Neon database, which is attached to Production only). Preview has only DATABASE_URL.
const dbUrl = () => process.env.DATABASE_URL || process.env.Database_DATABASE_URL || '';
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
    const pool = global.__crashhelpPool || (global.__crashhelpPool = new Pool({
      connectionString: dbUrl(),
      max: 3,
      ssl: dbUrl().includes('localhost') ? false : { rejectUnauthorized: false },
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
