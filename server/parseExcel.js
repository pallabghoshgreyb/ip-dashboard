const ExcelJS = require('exceljs');

// ---- helpers -------------------------------------------------------------

function cellText(cell) {
  if (cell === null || cell === undefined) return null;
  const v = cell.value !== undefined ? cell.value : cell;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && v.richText) return v.richText.map((r) => r.text).join('');
  if (typeof v === 'object' && v.text) return v.text;
  return String(v).trim();
}

function cleanText(cell) {
  const s = cellText(cell);
  if (s === null || s === '' || s === '-') return null;
  return s;
}

function moneyToMillions(cell) {
  const s = cellText(cell);
  if (s === null || s === '-' || s === '') return null;
  const cleaned = s.replace(/\$/g, '').replace(/,/g, '').trim();
  let mult = 1;
  let numPart = cleaned;
  if (/B$/i.test(cleaned)) { mult = 1000; numPart = cleaned.slice(0, -1); }
  else if (/M$/i.test(cleaned)) { mult = 1; numPart = cleaned.slice(0, -1); }
  const n = parseFloat(numPart);
  if (Number.isNaN(n)) return null;
  return Math.round(n * mult * 1000) / 1000;
}

function num(cell) {
  const v = cell && cell.value !== undefined ? cell.value : cell;
  if (v === null || v === undefined || v === '-' || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isNaN(n) ? null : Math.round(n * 10000) / 10000;
}

// Build a {headerName: columnIndex} map from a given header row of a worksheet.
function headerMap(sheet, headerRowIndex) {
  const row = sheet.getRow(headerRowIndex);
  const map = {};
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const name = cellText(cell);
    if (name) map[name] = colNumber;
  });
  return map;
}

// ---- main parse ------------------------------------------------------------

/**
 * Parses the GreyB EV Battery ranking workbook into an array of company records
 * matching the `companies` table schema. Expects the same sheet names/columns
 * as the original workbook: "US Companies", "33 US Companies", "Companies Websites".
 */
async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const usSheet = wb.getWorksheet('US Companies');
  const us33Sheet = wb.getWorksheet('33 US Companies');
  const webSheet = wb.getWorksheet('Companies Websites');

  if (!usSheet || !us33Sheet || !webSheet) {
    const missing = [
      !usSheet && 'US Companies',
      !us33Sheet && '33 US Companies',
      !webSheet && 'Companies Websites',
    ].filter(Boolean);
    throw new Error(`Workbook is missing required sheet(s): ${missing.join(', ')}. Expected the same tabs as the original template.`);
  }

  // "US Companies" has a 3-row header; the real column names are on row 3.
  const usCols = headerMap(usSheet, 3);
  const requiredUsCols = [
    'Final Rank', 'Company Name', 'Final Company Ranking Score', 'Patent Portfolio Score',
    'Patent_Count', 'Patent Portfolio Contribution (60%)', 'Other Parameters Contribution (40%)',
  ];
  const missingUsCols = requiredUsCols.filter((c) => !usCols[c]);
  if (missingUsCols.length) {
    throw new Error(`"US Companies" sheet is missing expected column(s): ${missingUsCols.join(', ')}.`);
  }

  // "33 US Companies" and "Companies Websites" have a normal single-row header (row 1).
  const us33Cols = headerMap(us33Sheet, 1);
  const webCols = headerMap(webSheet, 1);

  const getUs = (row, name) => (usCols[name] ? row.getCell(usCols[name]) : null);
  const getUs33 = (row, name) => (us33Cols[name] ? row.getCell(us33Cols[name]) : null);
  const getWeb = (row, name) => (webCols[name] ? row.getCell(webCols[name]) : null);

  // Index "US Companies" data rows (start at row 4) by company name for lookup.
  const usByName = {};
  usSheet.eachRow((row, rowNumber) => {
    if (rowNumber < 4) return;
    const name = cleanText(getUs(row, 'Company Name'));
    if (name) usByName[name] = row;
  });

  // Index "Companies Websites" rows by name.
  const webByName = {};
  webSheet.eachRow((row, rowNumber) => {
    if (rowNumber < 2) return;
    const name = cleanText(getWeb(row, 'Company Name'));
    if (name) webByName[name] = row;
  });

  const records = [];
  const notFound = [];

  us33Sheet.eachRow((row33, rowNumber) => {
    if (rowNumber < 2) return;
    const name = cleanText(getUs33(row33, 'Company Name'));
    if (!name) return;

    const uRow = usByName[name];
    if (!uRow) { notFound.push(name); return; }
    const wRow = webByName[name];

    records.push({
      name,
      rank_us33: num(getUs33(row33, 'Final Rank')),
      rank_global: num(getUs(uRow, 'Final Rank')),
      final_score: num(getUs(uRow, 'Final Company Ranking Score')),

      patent_portfolio_score: num(getUs(uRow, 'Patent Portfolio Score')),
      patent_contribution_60: num(getUs(uRow, 'Patent Portfolio Contribution (60%)')),
      patent_count: num(getUs(uRow, 'Patent_Count')),
      sum_patent_score: num(getUs(uRow, 'Sum Patent Score')),
      avg_patent_score: num(getUs(uRow, 'Avg Patent Score')),
      max_patent_score: num(getUs(uRow, 'Max Patent Score')),
      high_value_patent_ratio: num(getUs(uRow, 'High Value Patent Ratio')),
      weighted_sum_patent_score: num(getUs(uRow, 'Weighted Sum Patent Score')),
      weighted_avg_patent_score: num(getUs(uRow, 'Weighted Avg Patent Score')),
      weighted_max_patent_score: num(getUs(uRow, 'Weighted Max Patent Score')),
      weighted_patent_count_score: num(getUs(uRow, 'Weighted Patent Count Score')),
      weighted_high_value_ratio: num(getUs(uRow, 'Weighted High Value Ratio')),

      forward_citation_score: num(getUs(uRow, 'Forward Citation Score')),
      citation_velocity: num(getUs(uRow, 'Citation Velocity')),
      classification_breadth: num(getUs(uRow, 'Classification Breadth')),
      claim_quality: num(getUs(uRow, 'Claim Quality')),
      prosecution_history: num(getUs(uRow, 'Prosecution History')),
      survival_legal_status: num(getUs(uRow, 'Survival / Legal Status')),
      family_size: num(getUs(uRow, 'Family Size')),
      geographic_coverage: num(getUs(uRow, 'Geographic Coverage')),
      remaining_term: num(getUs(uRow, 'Remaining Term')),
      assignment_activity: num(getUs(uRow, 'Assignment Activity')),
      litigation_activity: num(getUs(uRow, 'Litigation / Challenge Activity')),
      maintenance_activity: num(getUs(uRow, 'Maintenance / Fee Activity')),
      strategic_score_cap: num(getUs(uRow, 'Strategic Score Cap')),

      revenue_growth_score: num(getUs(uRow, 'Final Revenue Growth Score')),
      rd_growth_score: num(getUs(uRow, 'Final R&D Growth Score')),
      rd_intensity_score: num(getUs(uRow, 'Final R&D Intensity Score')),
      fda_score: num(getUs(uRow, 'Final FDA Clearance Score')),
      ma_score: num(getUs(uRow, 'Final M&A Activity Score')),
      other_contribution_40: num(getUs(uRow, 'Other Parameters Contribution (40%)')),

      revenue_2023: moneyToMillions(getUs33(row33, 'Revenue 2023')),
      revenue_2024: moneyToMillions(getUs33(row33, 'Revenue 2024')),
      revenue_2025: moneyToMillions(getUs33(row33, 'Revenue 2025')),
      rd_2023: moneyToMillions(getUs33(row33, 'R&D Expenditure 2023')),
      rd_2024: moneyToMillions(getUs33(row33, 'R&D Expenditure 2024')),
      rd_2025: moneyToMillions(getUs33(row33, 'R&D Expenditure 2025')),

      fda_2023: cleanText(getUs33(row33, "FDA Clearance Velocity (510(k) - 2023")),
      fda_2024: cleanText(getUs33(row33, "FDA Clearance Velocity (510(k) - 2024")),
      fda_2025: cleanText(getUs33(row33, "FDA Clearance Velocity (510(k) - 2025")),
      ma_activity: cleanText(getUs33(row33, 'Mergers & Acquisitions (Last 3 Years 2023, 2024 & 2025)')),
      tech_domain: cleanText(getUs33(row33, 'Tech Domain')),
      comments: cleanText(getUs33(row33, 'Comments')),
      website: wRow ? cleanText(getWeb(wRow, 'Website')) : null,
      parent_company: wRow ? cleanText(getWeb(wRow, 'Parent Company')) : null,
    });
  });

  if (records.length === 0) {
    throw new Error('No company rows were found. Check that "33 US Companies" has data starting on row 2.');
  }

  return { records, warnings: notFound.length ? [`Company name(s) in "33 US Companies" not found in "US Companies": ${notFound.join(', ')}`] : [] };
}

module.exports = { parseWorkbook, moneyToMillions, cleanText, num };
