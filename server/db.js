const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Most managed Postgres providers require SSL; toggle via env if yours does not.
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // Idle client errors shouldn't crash the whole server.
  console.error('Unexpected Postgres pool error:', err);
});

module.exports = { pool };
