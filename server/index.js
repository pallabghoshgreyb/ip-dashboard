require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const ExcelJS = require('exceljs');
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

function normalizeCellValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return normalizeCellValue(value.result);
    if (Object.prototype.hasOwnProperty.call(value, 'richText')) {
      return (value.richText || []).map((part) => (part && part.text !== undefined ? part.text : '')).join('');
    }
    if (Object.prototype.hasOwnProperty.call(value, 'text')) return value.text;
    if (Object.prototype.hasOwnProperty.call(value, 'error')) return null;
  }
  return value;
}

const patentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
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

app.post('/api/patents/upload', requireAdmin, patentUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file was uploaded.' });
  }

  let workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: 'Could not read Excel workbook: ' + err.message });
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return res.status(400).json({ error: 'The workbook has no sheets.' });
  }

  const headerRow = worksheet.getRow(1);
  const headers = headerRow.values.slice(1);
  if (!headers.length) {
    return res.status(400).json({ error: 'The workbook is missing a header row.' });
  }

  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicateHeaders.length) {
    const uniqueDuplicates = [...new Set(duplicateHeaders)];
    return res.status(400).json({ error: `Duplicate column headings detected: ${uniqueDuplicates.map((h) => `"${String(h)}"`).join(', ')}` });
  }

  const publicationNumberIndex = headers.indexOf('Publication Number');
  if (publicationNumberIndex === -1) {
    return res.status(400).json({ error: 'Missing required "Publication Number" column.' });
  }

  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const record = {};
    let hasAnyValue = false;

    headers.forEach((header, index) => {
      const cellValue = normalizeCellValue(row.getCell(index + 1).value);
      record[header] = cellValue;
      if (cellValue !== null && cellValue !== undefined && !(typeof cellValue === 'string' && cellValue === '')) {
        hasAnyValue = true;
      }
    });

    if (!hasAnyValue) continue;

    const publicationNumberValue = record['Publication Number'];
    if (publicationNumberValue === null || publicationNumberValue === undefined || String(publicationNumberValue).trim() === '') {
      return res.status(400).json({ error: `Row ${rowNumber} is missing a Publication Number value.` });
    }

    rows.push(record);
  }

  if (rows.length === 0) {
    return res.status(400).json({ error: 'No data rows found in the workbook.' });
  }

  const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const versionIdResult = await client.query("SELECT nextval(pg_get_serial_sequence('patents.dataset_versions','id')) AS id");
    const versionId = versionIdResult.rows[0].id;
    const versionLabel = `v${versionId}`;

    await client.query(
      `INSERT INTO patents.dataset_versions (
        id, label, filename, file_sha256, row_count, column_count, columns, uploaded_at, is_current, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now(), false, NULL)`,
      [versionId, versionLabel, req.file.originalname, fileHash, rows.length, headers.length, JSON.stringify(headers)]
    );

    const insertRecordSql = `
      INSERT INTO patents.records (version_id, publication_number, raw)
      VALUES ($1, $2, $3)
    `;

    for (const record of rows) {
      await client.query(insertRecordSql, [versionId, record['Publication Number'], JSON.stringify(record)]);
    }

    const deleteResult = await client.query('DELETE FROM patents.records WHERE version_id <> $1', [versionId]);
    await client.query('UPDATE patents.dataset_versions SET is_current = false');
    await client.query('UPDATE patents.dataset_versions SET is_current = true WHERE id = $1', [versionId]);

    await client.query('COMMIT');

    res.json({
      ok: true,
      version: { id: versionId, label: versionLabel },
      rowCount: rows.length,
      columnCount: headers.length,
      replacedRows: deleteResult.rowCount,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/patents/upload failed:', err.message);
    res.status(500).json({ error: 'Could not import patent workbook: ' + err.message });
  } finally {
    client.release();
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
  body { font-family: -apple-system, sans-serif; max-width: 760px; margin: 60px auto; color: #16233d; }
  h1 { font-size: 20px; }
  h2 { font-size: 18px; margin-top: 24px; }
  .panel { border: 1px solid #dfe4ec; border-radius: 10px; padding: 20px; margin-top: 16px; }
  .panel p { margin: 6px 0; color: #5b6b85; font-size: 13.5px; }
  form { margin-top: 12px; }
  input[type=file] { margin: 12px 0; }
  button { background: #a8762a; color: #fff; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-size: 14px; }
  button:hover { background: #8f6321; }
  .status { margin-top: 14px; font-size: 13.5px; white-space: pre-wrap; }
  .ok { color: #1e9e6b; } .err { color: #c44536; }
</style>
</head>
<body>
  <h1>Upload data</h1>
  <div class="panel">
    <h2>Company ranking data</h2>
    <p>This upload replaces the current company ranking dataset.</p>
    <p>Warning: this replaces the current data with no undo.</p>
    <form id="company-form">
      <input type="file" name="file" accept=".xlsx" required />
      <br/>
      <button type="submit">Upload &amp; replace company data</button>
    </form>
    <div id="company-status" class="status"></div>
  </div>

  <div class="panel">
    <h2>Patent data</h2>
    <p>This upload replaces the current patent dataset.</p>
    <p>Warning: this replaces the current data with no undo.</p>
    <form id="patent-form">
      <input type="file" name="file" accept=".xlsx" required />
      <br/>
      <button type="submit">Upload &amp; replace patent data</button>
    </form>
    <div id="patent-status" class="status"></div>
  </div>

  <script>
    function setStatus(node, message, isError) {
      node.className = 'status' + (isError ? ' err' : ' ok');
      node.textContent = message;
    }

    const companyForm = document.getElementById('company-form');
    const companyStatus = document.getElementById('company-status');
    companyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!confirm('This will replace the current company ranking data with no undo. Continue?')) {
        return;
      }
      companyStatus.textContent = 'Uploading and parsing...';
      companyStatus.className = 'status';
      const body = new FormData(companyForm);
      try {
        const res = await fetch('/api/upload', { method: 'POST', body });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        setStatus(companyStatus, 'Done - ' + data.rowCount + ' companies loaded.' + (data.warnings && data.warnings.length ? '\\n\\nWarnings:\\n' + data.warnings.join('\\n') : ''), false);
      } catch (err) {
        setStatus(companyStatus, 'Error: ' + err.message, true);
      }
    });

    const patentForm = document.getElementById('patent-form');
    const patentStatus = document.getElementById('patent-status');
    patentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!confirm('This will replace the current patent data with no undo. Continue?')) {
        return;
      }
      patentStatus.textContent = 'Uploading and parsing...';
      patentStatus.className = 'status';
      const body = new FormData(patentForm);
      try {
        const res = await fetch('/api/patents/upload', { method: 'POST', body });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        setStatus(
          patentStatus,
          'Version ' + data.version.label + ' loaded: ' + data.rowCount + ' rows, ' + data.columnCount + ' columns, ' + data.replacedRows + ' old rows replaced.',
          false
        );
      } catch (err) {
        setStatus(patentStatus, err.message, true);
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
