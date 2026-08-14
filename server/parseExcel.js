const ExcelJS = require('exceljs');

// ---- Workbook layout -------------------------------------------------------

const SHEET_FINAL_RANKING = 'Final_Ranking';
const SHEET_TOP_COMPANIES = '1% Companies';
const SHEET_COMPANY_DETAILS = 'Companies Details';

const FINAL_RANKING_HEADER_ROW = 3;
const FINAL_RANKING_DATA_ROW = 4;

const TOP_COMPANIES_HEADER_ROW = 3;
const TOP_COMPANIES_DATA_ROW = 4;

const COMPANY_DETAILS_HEADER_ROW = 1;
const COMPANY_DETAILS_DATA_ROW = 2;

// ---- helpers ---------------------------------------------------------------

function cellText(cell) {
  if (cell === null || cell === undefined) return null;

  const v = cell.value !== undefined ? cell.value : cell;

  if (v === null || v === undefined) return null;

  // Excel rich-text cells
  if (typeof v === 'object' && v.richText) {
    return v.richText.map((r) => r.text).join('').trim();
  }

  // Excel hyperlink values
  if (typeof v === 'object' && v.text !== undefined) {
    return String(v.text).trim();
  }

  // Formula cells represented by ExcelJS as { formula, result }
  if (typeof v === 'object' && v.result !== undefined) {
    if (v.result === null || v.result === undefined) return null;
    return String(v.result).trim();
  }

  return String(v).trim();
}

function cleanText(cell) {
  const s = cellText(cell);

  if (s === null || s === '' || s === '-') {
    return null;
  }

  return s;
}

// Convert money into USD millions.
//
// Examples:
// $176.191B -> 176191
// $4,434M   -> 4434
// $0.3M     -> 0.3
function moneyToMillions(cell) {
  const s = cellText(cell);

  if (s === null || s === '' || s === '-') {
    return null;
  }

  let cleaned = s
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .trim();

  let negative = false;

  if (/^\(.*\)$/.test(cleaned)) {
    negative = true;
    cleaned = cleaned.slice(1, -1).trim();
  }

  let multiplier = 1;
  let numberPart = cleaned;

  if (/B$/i.test(cleaned)) {
    multiplier = 1000;
    numberPart = cleaned.slice(0, -1);
  } else if (/M$/i.test(cleaned)) {
    multiplier = 1;
    numberPart = cleaned.slice(0, -1);
  }

  const n = parseFloat(numberPart);

  if (Number.isNaN(n)) {
    return null;
  }

  const result =
    n * multiplier * (negative ? -1 : 1);

  return Math.round(result * 1000) / 1000;
}

function num(cell) {
  if (cell === null || cell === undefined) {
    return null;
  }

  let v =
    cell.value !== undefined
      ? cell.value
      : cell;

  if (
    v &&
    typeof v === 'object' &&
    v.result !== undefined
  ) {
    v = v.result;
  }

  if (
    v === null ||
    v === undefined ||
    v === '' ||
    v === '-'
  ) {
    return null;
  }

  const n =
    typeof v === 'number'
      ? v
      : parseFloat(
          String(v)
            .replace(/,/g, '')
            .trim()
        );

  return Number.isNaN(n)
    ? null
    : Math.round(n * 10000) / 10000;
}

// Build:
// {
//   "Company Name": 2,
//   "Revenue 2023": 6,
//   ...
// }
//
// IMPORTANT:
// If the same header exists more than once,
// the LAST occurrence is used.
//
// Your Companies Details sheet has two columns
// named "Comments". We intentionally use the
// second Comments column.
function headerMap(sheet, headerRowIndex) {
  const row = sheet.getRow(headerRowIndex);
  const map = {};

  row.eachCell(
    { includeEmpty: false },
    (cell, colNumber) => {
      const name = cellText(cell);

      if (name) {
        map[name] = colNumber;
      }
    }
  );

  return map;
}

function missingColumns(
  columnMap,
  requiredColumns
) {
  return requiredColumns.filter(
    (name) => !columnMap[name]
  );
}

// ---- main parser -----------------------------------------------------------

/**
 * Expected workbook:
 *
 * Final_Ranking
 * -----------------------
 * Row 1 = category headings
 * Row 2 = sub-headings
 * Row 3 = actual column names
 * Row 4+ = data
 *
 *
 * 1% Companies
 * -----------------------
 * Row 1 = category headings
 * Row 2 = sub-headings
 * Row 3 = actual column names
 * Row 4+ = data
 *
 *
 * Companies Details
 * -----------------------
 * Row 1 = actual column names
 * Row 2+ = data
 */
async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();

  await wb.xlsx.load(buffer);

  // -------------------------------------------------------------------------
  // Get worksheets
  // -------------------------------------------------------------------------

  const finalRankingSheet =
    wb.getWorksheet(
      SHEET_FINAL_RANKING
    );

  const topCompaniesSheet =
    wb.getWorksheet(
      SHEET_TOP_COMPANIES
    );

  const companyDetailsSheet =
    wb.getWorksheet(
      SHEET_COMPANY_DETAILS
    );

  // -------------------------------------------------------------------------
  // Validate worksheet names
  // -------------------------------------------------------------------------

  if (
    !finalRankingSheet ||
    !topCompaniesSheet ||
    !companyDetailsSheet
  ) {
    const missing = [
      !finalRankingSheet &&
        SHEET_FINAL_RANKING,

      !topCompaniesSheet &&
        SHEET_TOP_COMPANIES,

      !companyDetailsSheet &&
        SHEET_COMPANY_DETAILS,
    ].filter(Boolean);

    throw new Error(
      `Workbook is missing required sheet(s): ${missing.join(', ')}. ` +
      `Expected sheets: ${SHEET_FINAL_RANKING}, ` +
      `${SHEET_TOP_COMPANIES}, ` +
      `${SHEET_COMPANY_DETAILS}.`
    );
  }

  // -------------------------------------------------------------------------
  // Read header rows
  // -------------------------------------------------------------------------

  const finalCols =
    headerMap(
      finalRankingSheet,
      FINAL_RANKING_HEADER_ROW
    );

  const topCols =
    headerMap(
      topCompaniesSheet,
      TOP_COMPANIES_HEADER_ROW
    );

  const detailsCols =
    headerMap(
      companyDetailsSheet,
      COMPANY_DETAILS_HEADER_ROW
    );

  // -------------------------------------------------------------------------
  // Required Final_Ranking columns
  // -------------------------------------------------------------------------

  const requiredFinalCols = [
    'Final Rank',
    'Company Name',
    'Final Company Ranking Score',
    'Patent Portfolio Score',
    'Patent_Count',
    'Patent Portfolio Contribution (60%)',
    'Other Parameters Contribution (40%)',
  ];

  // -------------------------------------------------------------------------
  // Required 1% Companies columns
  // -------------------------------------------------------------------------

  const requiredTopCols = [
    'Final Rank',
    'Company Name',
  ];

  // -------------------------------------------------------------------------
  // Required Companies Details columns
  // -------------------------------------------------------------------------

  const requiredDetailsCols = [
    'Company Name',
    'Parent Company',
    'Website',

    'Revenue 2023',
    'Revenue 2024',
    'Revenue 2025',

    'R&D Expenditure 2023',
    'R&D Expenditure 2024',
    'R&D Expenditure 2025',

    'Mergers & Acquisitions (Last 3 Years 2023, 2024 & 2025)',

    'Tech Domain',

    'FDA Clearance Velocity (510(k) - 2023',
    'FDA Clearance Velocity (510(k) - 2024',
    'FDA Clearance Velocity (510(k) - 2025',
  ];

  // -------------------------------------------------------------------------
  // Validate columns
  // -------------------------------------------------------------------------

  const missingFinal =
    missingColumns(
      finalCols,
      requiredFinalCols
    );

  const missingTop =
    missingColumns(
      topCols,
      requiredTopCols
    );

  const missingDetails =
    missingColumns(
      detailsCols,
      requiredDetailsCols
    );

  if (missingFinal.length) {
    throw new Error(
      `"${SHEET_FINAL_RANKING}" sheet is missing expected column(s): ` +
      `${missingFinal.join(', ')}.`
    );
  }

  if (missingTop.length) {
    throw new Error(
      `"${SHEET_TOP_COMPANIES}" sheet is missing expected column(s): ` +
      `${missingTop.join(', ')}.`
    );
  }

  if (missingDetails.length) {
    throw new Error(
      `"${SHEET_COMPANY_DETAILS}" sheet is missing expected column(s): ` +
      `${missingDetails.join(', ')}.`
    );
  }

  // -------------------------------------------------------------------------
  // Helper functions for reading cells
  // -------------------------------------------------------------------------

  const getFinal = (row, name) =>
    finalCols[name]
      ? row.getCell(
          finalCols[name]
        )
      : null;

  const getTop = (row, name) =>
    topCols[name]
      ? row.getCell(
          topCols[name]
        )
      : null;

  const getDetails = (row, name) =>
    detailsCols[name]
      ? row.getCell(
          detailsCols[name]
        )
      : null;

  // -------------------------------------------------------------------------
  // Index Final_Ranking by Company Name
  // -------------------------------------------------------------------------

  const finalByName = {};

  finalRankingSheet.eachRow(
    (row, rowNumber) => {
      if (
        rowNumber <
        FINAL_RANKING_DATA_ROW
      ) {
        return;
      }

      const name =
        cleanText(
          getFinal(
            row,
            'Company Name'
          )
        );

      if (name) {
        finalByName[name] = row;
      }
    }
  );

  // -------------------------------------------------------------------------
  // Index Companies Details by Company Name
  // -------------------------------------------------------------------------

  const detailsByName = {};

  companyDetailsSheet.eachRow(
    (row, rowNumber) => {
      if (
        rowNumber <
        COMPANY_DETAILS_DATA_ROW
      ) {
        return;
      }

      const name =
        cleanText(
          getDetails(
            row,
            'Company Name'
          )
        );

      if (name) {
        detailsByName[name] = row;
      }
    }
  );

  // -------------------------------------------------------------------------
  // Build database records
  //
  // Main company list comes from "1% Companies".
  // -------------------------------------------------------------------------

  const records = [];

  const notFoundInFinal = [];
  const notFoundInDetails = [];

  topCompaniesSheet.eachRow(
    (topRow, rowNumber) => {

      // Headers end at row 3.
      // Actual data starts at row 4.
      if (
        rowNumber <
        TOP_COMPANIES_DATA_ROW
      ) {
        return;
      }

      const name =
        cleanText(
          getTop(
            topRow,
            'Company Name'
          )
        );

      if (!name) {
        return;
      }

      // Find same company in Final_Ranking.
      const finalRow =
        finalByName[name];

      if (!finalRow) {
        notFoundInFinal.push(name);
        return;
      }

      // Find same company in Companies Details.
      const detailsRow =
        detailsByName[name];

      if (!detailsRow) {
        notFoundInDetails.push(name);
      }

      records.push({

        // -------------------------------------------------------------------
        // Ranking
        // -------------------------------------------------------------------

        name,

        // Legacy database field name.
        //
        // rank_us33 now represents the rank
        // inside the "1% Companies" sheet.
        rank_us33:
          num(
            getTop(
              topRow,
              'Final Rank'
            )
          ),

        // Overall rank from Final_Ranking.
        rank_global:
          num(
            getFinal(
              finalRow,
              'Final Rank'
            )
          ),

        final_score:
          num(
            getFinal(
              finalRow,
              'Final Company Ranking Score'
            )
          ),

        // -------------------------------------------------------------------
        // Patent portfolio
        // -------------------------------------------------------------------

        patent_portfolio_score:
          num(
            getFinal(
              finalRow,
              'Patent Portfolio Score'
            )
          ),

        patent_contribution_60:
          num(
            getFinal(
              finalRow,
              'Patent Portfolio Contribution (60%)'
            )
          ),

        patent_count:
          num(
            getFinal(
              finalRow,
              'Patent_Count'
            )
          ),

        sum_patent_score:
          num(
            getFinal(
              finalRow,
              'Sum Patent Score'
            )
          ),

        avg_patent_score:
          num(
            getFinal(
              finalRow,
              'Avg Patent Score'
            )
          ),

        max_patent_score:
          num(
            getFinal(
              finalRow,
              'Max Patent Score'
            )
          ),

        high_value_patent_ratio:
          num(
            getFinal(
              finalRow,
              'High Value Patent Ratio'
            )
          ),

        weighted_sum_patent_score:
          num(
            getFinal(
              finalRow,
              'Weighted Sum Patent Score'
            )
          ),

        weighted_avg_patent_score:
          num(
            getFinal(
              finalRow,
              'Weighted Avg Patent Score'
            )
          ),

        weighted_max_patent_score:
          num(
            getFinal(
              finalRow,
              'Weighted Max Patent Score'
            )
          ),

        weighted_patent_count_score:
          num(
            getFinal(
              finalRow,
              'Weighted Patent Count Score'
            )
          ),

        weighted_high_value_ratio:
          num(
            getFinal(
              finalRow,
              'Weighted High Value Ratio'
            )
          ),

        // -------------------------------------------------------------------
        // Patent quality profile
        // -------------------------------------------------------------------

        forward_citation_score:
          num(
            getFinal(
              finalRow,
              'Forward Citation Score'
            )
          ),

        citation_velocity:
          num(
            getFinal(
              finalRow,
              'Citation Velocity'
            )
          ),

        classification_breadth:
          num(
            getFinal(
              finalRow,
              'Classification Breadth'
            )
          ),

        claim_quality:
          num(
            getFinal(
              finalRow,
              'Claim Quality'
            )
          ),

        prosecution_history:
          num(
            getFinal(
              finalRow,
              'Prosecution History'
            )
          ),

        survival_legal_status:
          num(
            getFinal(
              finalRow,
              'Survival / Legal Status'
            )
          ),

        family_size:
          num(
            getFinal(
              finalRow,
              'Family Size'
            )
          ),

        geographic_coverage:
          num(
            getFinal(
              finalRow,
              'Geographic Coverage'
            )
          ),

        remaining_term:
          num(
            getFinal(
              finalRow,
              'Remaining Term'
            )
          ),

        assignment_activity:
          num(
            getFinal(
              finalRow,
              'Assignment Activity'
            )
          ),

        litigation_activity:
          num(
            getFinal(
              finalRow,
              'Litigation / Challenge Activity'
            )
          ),

        maintenance_activity:
          num(
            getFinal(
              finalRow,
              'Maintenance / Fee Activity'
            )
          ),

        strategic_score_cap:
          num(
            getFinal(
              finalRow,
              'Strategic Score Cap'
            )
          ),

        // -------------------------------------------------------------------
        // Business / commercial scores
        // These scores come from Final_Ranking.
        // -------------------------------------------------------------------

        revenue_growth_score:
          num(
            getFinal(
              finalRow,
              'Final Revenue Growth Score'
            )
          ),

        rd_growth_score:
          num(
            getFinal(
              finalRow,
              'Final R&D Growth Score'
            )
          ),

        rd_intensity_score:
          num(
            getFinal(
              finalRow,
              'Final R&D Intensity Score'
            )
          ),

        fda_score:
          num(
            getFinal(
              finalRow,
              'Final FDA Clearance Score'
            )
          ),

        ma_score:
          num(
            getFinal(
              finalRow,
              'Final M&A Activity Score'
            )
          ),

        other_contribution_40:
          num(
            getFinal(
              finalRow,
              'Other Parameters Contribution (40%)'
            )
          ),

        // -------------------------------------------------------------------
        // Raw revenue data
        //
        // IMPORTANT:
        // These now come from "Companies Details",
        // NOT from "1% Companies".
        // -------------------------------------------------------------------

        revenue_2023:
          detailsRow
            ? moneyToMillions(
                getDetails(
                  detailsRow,
                  'Revenue 2023'
                )
              )
            : null,

        revenue_2024:
          detailsRow
            ? moneyToMillions(
                getDetails(
                  detailsRow,
                  'Revenue 2024'
                )
              )
            : null,

        revenue_2025:
          detailsRow
            ? moneyToMillions(
                getDetails(
                  detailsRow,
                  'Revenue 2025'
                )
              )
            : null,

        // -------------------------------------------------------------------
        // Raw R&D expenditure
        // -------------------------------------------------------------------

        rd_2023:
          detailsRow
            ? moneyToMillions(
                getDetails(
                  detailsRow,
                  'R&D Expenditure 2023'
                )
              )
            : null,

        rd_2024:
          detailsRow
            ? moneyToMillions(
                getDetails(
                  detailsRow,
                  'R&D Expenditure 2024'
                )
              )
            : null,

        rd_2025:
          detailsRow
            ? moneyToMillions(
                getDetails(
                  detailsRow,
                  'R&D Expenditure 2025'
                )
              )
            : null,

        // -------------------------------------------------------------------
        // FDA activity
        // -------------------------------------------------------------------

        fda_2023:
          detailsRow
            ? cleanText(
                getDetails(
                  detailsRow,
                  'FDA Clearance Velocity (510(k) - 2023'
                )
              )
            : null,

        fda_2024:
          detailsRow
            ? cleanText(
                getDetails(
                  detailsRow,
                  'FDA Clearance Velocity (510(k) - 2024'
                )
              )
            : null,

        fda_2025:
          detailsRow
            ? cleanText(
                getDetails(
                  detailsRow,
                  'FDA Clearance Velocity (510(k) - 2025'
                )
              )
            : null,

        // -------------------------------------------------------------------
        // M&A
        // -------------------------------------------------------------------

        ma_activity:
          detailsRow
            ? cleanText(
                getDetails(
                  detailsRow,
                  'Mergers & Acquisitions (Last 3 Years 2023, 2024 & 2025)'
                )
              )
            : null,

        // -------------------------------------------------------------------
        // Technology domain
        // -------------------------------------------------------------------

        tech_domain:
          detailsRow
            ? cleanText(
                getDetails(
                  detailsRow,
                  'Tech Domain'
                )
              )
            : null,

        // -------------------------------------------------------------------
        // Comments
        //
        // Companies Details has TWO headers called "Comments".
        // headerMap() uses the LAST one.
        //
        // This means the second Comments column is stored.
        // -------------------------------------------------------------------

        comments:
          detailsRow
            ? cleanText(
                getDetails(
                  detailsRow,
                  'Comments'
                )
              )
            : null,

        // -------------------------------------------------------------------
        // Website
        // -------------------------------------------------------------------

        website:
          detailsRow
            ? cleanText(
                getDetails(
                  detailsRow,
                  'Website'
                )
              )
            : null,

        // -------------------------------------------------------------------
        // Parent company
        // -------------------------------------------------------------------

        parent_company:
          detailsRow
            ? cleanText(
                getDetails(
                  detailsRow,
                  'Parent Company'
                )
              )
            : null,
      });
    }
  );

  // -------------------------------------------------------------------------
  // Final validation
  // -------------------------------------------------------------------------

  if (records.length === 0) {
    throw new Error(
      `No company rows were found. ` +
      `Check that "${SHEET_TOP_COMPANIES}" has headers on row ` +
      `${TOP_COMPANIES_HEADER_ROW}, data beginning on row ` +
      `${TOP_COMPANIES_DATA_ROW}, and company names matching ` +
      `"${SHEET_FINAL_RANKING}".`
    );
  }

  // -------------------------------------------------------------------------
  // Warnings
  // -------------------------------------------------------------------------

  const warnings = [];

  if (notFoundInFinal.length) {
    warnings.push(
      `Company name(s) in "${SHEET_TOP_COMPANIES}" ` +
      `not found in "${SHEET_FINAL_RANKING}": ` +
      `${notFoundInFinal.join(', ')}`
    );
  }

  if (notFoundInDetails.length) {
    warnings.push(
      `Company name(s) in "${SHEET_TOP_COMPANIES}" ` +
      `not found in "${SHEET_COMPANY_DETAILS}": ` +
      `${notFoundInDetails.join(', ')}`
    );
  }

  return {
    records,
    warnings,
  };
}

module.exports = {
  parseWorkbook,
  moneyToMillions,
  cleanText,
  num,
};
