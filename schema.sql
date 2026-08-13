-- IP Valuation Dashboard — schema
-- Single-table design: every upload TRUNCATEs and re-inserts (overwrite mode, no history).

CREATE TABLE IF NOT EXISTS companies (
  id                          SERIAL PRIMARY KEY,
  name                        TEXT NOT NULL,
  rank_us33                   INTEGER NOT NULL,
  rank_global                 INTEGER NOT NULL,
  final_score                 NUMERIC NOT NULL,

  -- Patent portfolio score & its five build-blocks (Section 6.1)
  patent_portfolio_score      NUMERIC NOT NULL,
  patent_contribution_60      NUMERIC NOT NULL,
  patent_count                INTEGER NOT NULL,
  sum_patent_score            NUMERIC,
  avg_patent_score            NUMERIC,
  max_patent_score            NUMERIC,
  high_value_patent_ratio     NUMERIC,
  weighted_sum_patent_score   NUMERIC,
  weighted_avg_patent_score   NUMERIC,
  weighted_max_patent_score   NUMERIC,
  weighted_patent_count_score NUMERIC,
  weighted_high_value_ratio   NUMERIC,

  -- Patent-level quality profile: average per-patent sub-scores (Section 4)
  forward_citation_score      NUMERIC,
  citation_velocity           NUMERIC,
  classification_breadth      NUMERIC,
  claim_quality                NUMERIC,
  prosecution_history         NUMERIC,
  survival_legal_status       NUMERIC,
  family_size                 NUMERIC,
  geographic_coverage         NUMERIC,
  remaining_term               NUMERIC,
  assignment_activity         NUMERIC,
  litigation_activity         NUMERIC,
  maintenance_activity        NUMERIC,
  strategic_score_cap         NUMERIC,

  -- Business / commercial layer, raw 0-100 (Section 7)
  revenue_growth_score        NUMERIC,
  rd_growth_score             NUMERIC,
  rd_intensity_score          NUMERIC,
  fda_score                   NUMERIC,
  ma_score                    NUMERIC,
  other_contribution_40       NUMERIC,

  -- Raw business figures, all in $ millions
  revenue_2023                NUMERIC,
  revenue_2024                NUMERIC,
  revenue_2025                NUMERIC,
  rd_2023                     NUMERIC,
  rd_2024                     NUMERIC,
  rd_2025                     NUMERIC,

  fda_2023                    TEXT,
  fda_2024                    TEXT,
  fda_2025                    TEXT,
  ma_activity                 TEXT,
  tech_domain                 TEXT,
  comments                    TEXT,
  website                     TEXT,
  parent_company              TEXT,

  uploaded_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_rank_us33 ON companies (rank_us33);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies (name);

-- Tracks metadata about the current dataset (single row, always id=1)
CREATE TABLE IF NOT EXISTS dataset_meta (
  id            INTEGER PRIMARY KEY DEFAULT 1,
  filename      TEXT,
  uploaded_at   TIMESTAMPTZ,
  row_count     INTEGER,
  CONSTRAINT single_row CHECK (id = 1)
);
