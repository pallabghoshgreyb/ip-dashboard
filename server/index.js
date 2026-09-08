require('dotenv').config();
const path = require('path');
const express = require('express');
const multer = require('multer');
const { pool } = require('./db');
const { requireAdmin } = require('./auth');
const { parseWorkbook } = require('./parseExcel');

// Last line of defense: log and keep running instead of crashing the whole server
// on an error we didn't anticipate catching somewhere specific.
process.on('unhandledRejection', (err) => console.error('Unhandled promise rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 20MB is generous for this workbook
  fileFilter: (req, file, cb) => {
    const okExt = /\.xlsx$/i.test(file.originalname);
    const okMime = file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (okExt || okMime) return cb(null, true);
    cb(new Error('Only .xlsx files are accepted.'));
  },
});

// The columns we write, in the exact order the INSERT statement below expects.
const COLUMNS = [
  'name', 'rank_us33', 'rank_global', 'final_score',
  'patent_portfolio_score', 'patent_contribution_60', 'patent_count',
  'sum_patent_score', 'avg_patent_score', 'max_patent_score', 'high_value_patent_ratio',
  'weighted_sum_patent_score', 'weighted_avg_patent_score', 'weighted_max_patent_score',
  'weighted_patent_count_score', 'weighted_high_value_ratio',
  'forward_citation_score', 'citation_velocity', 'classification_breadth',
  'claim_quality', 'prosecution_history', 'survival_legal_status',
  'family_size', 'geographic_coverage', 'remaining_term',
  'assignment_activity', 'litigation_activity', 'maintenance_activity', 'strategic_score_cap',
  'revenue_growth_score', 'rd_growth_score', 'rd_intensity_score', 'fda_score', 'ma_score',
  'other_contribution_40',
  'revenue_2023', 'revenue_2024', 'revenue_2025', 'rd_2023', 'rd_2024', 'rd_2025',
  'fda_2023', 'fda_2024', 'fda_2025', 'ma_activity', 'tech_domain', 'comments',
  'website', 'parent_company',
];

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'patindex-api' });
});

app.get('/api/db-check', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        version() AS version,
        current_database() AS database,
        current_user AS username,
        EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app') AS app,
        EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'rankings') AS rankings,
        EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'patents') AS patents
    `);
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/db-check failed:', err.message);
    res.status(503).json({ error: 'Database unavailable.' });
  }
});

app.get('/api/patents/index', async (req, res) => {
  try {
    const versionResult = await pool.query(
      `SELECT id, label, filename, uploaded_at, row_count
       FROM patents.dataset_versions
       WHERE is_current = true
       LIMIT 1`
    );
    const version = versionResult.rows[0];

    if (!version) {
      return res.status(404).json({ error: 'No current patent dataset.' });
    }

    const etag = `"${version.id}"`;
    res.set('ETag', etag);
    if (req.headers['if-none-match']?.split(',').map((value) => value.trim()).includes(etag)) {
      return res.status(304).end();
    }

    const { rows } = await pool.query(
      `SELECT raw - ARRAY[
         'Backward Cited Patents or Backward Citations',
         'Forward Citing Patents or Forward Citations',
         'CPCs',
         'CPCs (2)',
         'IPCs',
         'INPADOC Family Members',
         'Market Region or Geographical Distribution or Geo Graphical Distribution',
         'GAU - Definiations or GAU Definitions'
       ]::text[] AS raw
       FROM patents.records
       WHERE version_id = $1
       ORDER BY id`,
      [version.id]
    );

    res.json({
      rows: rows.map((row) => row.raw),
      version: {
        label: version.label,
        filename: version.filename,
        uploaded_at: version.uploaded_at,
        row_count: version.row_count,
      },
    });
  } catch (err) {
    console.error('GET /api/patents/index failed:', err.message);
    res.status(500).json({ error: 'Could not load patent index.' });
  }
});

app.get('/api/patents/detail/:publicationNumber', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT raw
       FROM patents.records AS r
       JOIN patents.dataset_versions AS v ON v.id = r.version_id
       WHERE v.is_current = true AND r.publication_number = $1
       LIMIT 1`,
      [req.params.publicationNumber]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Patent record not found.' });
    }
    res.json(rows[0].raw);
  } catch (err) {
    console.error('GET /api/patents/detail failed:', err.message);
    res.status(500).json({ error: 'Could not load patent detail.' });
  }
});

app.get('/api/patents/meta', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM patents.dataset_versions
       WHERE is_current = true
       LIMIT 1`
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'No current patent dataset.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/patents/meta failed:', err.message);
    res.status(500).json({ error: 'Could not load patent metadata.' });
  }
});

// ---- Public API: current dataset -------------------------------------------------

app.get('/api/companies', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM companies ORDER BY rank_us33 ASC');
    const meta = await pool.query('SELECT filename, uploaded_at, row_count FROM dataset_meta WHERE id = 1');
    res.json({ companies: rows, meta: meta.rows[0] || null });
  } catch (err) {
    console.error('GET /api/companies failed:', err);
    res.status(500).json({ error: 'Could not load company data.' });
  }
});

// ---- Admin: upload page + handler --------------------------------------------------

app.get('/admin', requireAdmin, (req, res) => {
  res.send(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Upload data — IP Valuation Dashboard</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 520px; margin: 60px auto; color: #16233d; }
  h1 { font-size: 20px; }
  form { border: 1px solid #dfe4ec; border-radius: 10px; padding: 20px; margin-top: 16px; }
  input[type=file] { margin: 12px 0; }
  button { background: #a8762a; color: #fff; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-size: 14px; }
  button:hover { background: #8f6321; }
  #status { margin-top: 14px; font-size: 13.5px; white-space: pre-wrap; }
  .ok { color: #1e9e6b; } .err { color: #c44536; }
</style>
</head>
<body>
  <h1>Upload updated ranking data (.xlsx)</h1>
  <p style="color:#5b6b85; font-size:13.5px;">File must keep the same sheet names as the original template: "US Companies", "33 US Companies", "Companies Websites".</p>
  <form id="f">
    <input type="file" name="file" accept=".xlsx" required />
    <br/>
    <button type="submit">Upload &amp; replace data</button>
  </form>
  <div id="status"></div>
  <script>
    const form = document.getElementById('f');
    const status = document.getElementById('status');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      status.textContent = 'Uploading and parsing...';
      status.className = '';
      const body = new FormData(form);
      try {
        const res = await fetch('/api/upload', { method: 'POST', body });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        status.className = 'ok';
        status.textContent = 'Done — ' + data.rowCount + ' companies loaded.' + (data.warnings && data.warnings.length ? '\\n\\nWarnings:\\n' + data.warnings.join('\\n') : '');
      } catch (err) {
        status.className = 'err';
        status.textContent = 'Error: ' + err.message;
      }
    });
  </script>
</body>
</html>`);
});

app.post('/api/upload', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file was uploaded.' });
  }

  let parsed;
  try {
    parsed = await parseWorkbook(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { records, warnings } = parsed;
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE companies RESTART IDENTITY');

    const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(', ');
    const insertSql = `INSERT INTO companies (${COLUMNS.join(', ')}) VALUES (${placeholders})`;
    for (const rec of records) {
      const values = COLUMNS.map((c) => (rec[c] === undefined ? null : rec[c]));
      await client.query(insertSql, values);
    }

    await client.query(
      `INSERT INTO dataset_meta (id, filename, uploaded_at, row_count)
       VALUES (1, $1, now(), $2)
       ON CONFLICT (id) DO UPDATE SET filename = $1, uploaded_at = now(), row_count = $2`,
      [req.file.originalname, records.length]
    );

    await client.query('COMMIT');
    res.json({ ok: true, rowCount: records.length, warnings });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (rollbackErr) { console.error('Rollback also failed:', rollbackErr); }
    }
    console.error('Upload transaction failed:', err);
    res.status(500).json({ error: 'Could not save data: ' + err.message });
  } finally {
    if (client) client.release();
  }
});

// ---- Serve the built frontend -------------------------------------------------

const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ---- Centralized error handler — never leak stack traces to the client -------------

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const status = err.message && /only \.xlsx/i.test(err.message) ? 400 : (err.status || 500);
  res.status(status).json({ error: err.message || 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`IP Valuation Dashboard listening on port ${PORT}`);
});
