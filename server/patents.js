const express = require('express');

const HEAVY_COLUMNS = [
  'Backward Cited Patents or Backward Citations',
  'Forward Citing Patents or Forward Citations', 'CPCs', 'CPCs (2)', 'IPCs',
  'INPADOC Family Members',
  'Market Region or Geographical Distribution or Geo Graphical Distribution',
  'GAU - Definiations or GAU Definitions',
];

// Only fixed SQL is composed here; all request values are bound parameters.
const BASE = String.raw`WITH source AS (
  SELECT publication_number, raw,
    COALESCE(raw->>'Domain', NULL) AS domain,
    COALESCE(raw->>'Subdomain', NULL) AS subdomain,
    COALESCE(raw->>'Current Assignees', raw->>'Original Assignees', raw->>'Assignees') AS assignee,
    COALESCE(raw->>'Legal Status', raw->>'Simple Legal Status') AS status,
    COALESCE(raw->>'Patent Type', NULL) AS patent_type,
    COALESCE(raw->>'Entity Type', NULL) AS entity_type,
    COALESCE(raw->>'Country Code or Country', raw->>'Country Code', raw->>'Country') AS country,
    COALESCE(raw->>'Publication Date', NULL) AS pub_date,
    COALESCE(raw->>'Title', NULL) AS title,
    COALESCE(raw->>'Patent Valuation', NULL) AS valuation,
    COALESCE(raw->>'Abstract', NULL) AS abstract,
    COALESCE(raw->>'Application Number.1', raw->>'Application Number') AS application_number,
    raw->>'Inventors' AS inventor,
    COALESCE(raw->>'Independent Claims Count', '0') AS independent_claims,
    COALESCE(raw->>'Dependent Claims Count', '0') AS dependent_claims,
    COALESCE(array_length(string_to_array(
      COALESCE(raw->>'INPADOC Family Members', raw->>'INPADOC Family Members (Beta) - 1'), '|'), 1), 0) AS family_size,
    COALESCE(raw->>'Asking Price USD', raw->>'Patsnap Value', raw->>'Patent Valuation') AS asking_price,
    lower(btrim(COALESCE(raw->>'Litigation Flag', raw->>'Litigation',
      raw->>'Litigation or Litigation Flag', ''))) IN ('yes', 'true', '1') AS litigated,
    COALESCE(raw->>'Count of Forward Citation or Forward Citations Count',
      raw->>'Count of Forward Citation',
      raw->>'Forward Citation Count', raw->>'Forward Citations Count',
      raw->>'Forward Citations', raw->>'Forward Citing Patents Count') AS citations
  FROM patents.patent
), records AS (
  SELECT *,
    CASE WHEN valuation ~ '^[0-9]+(\.[0-9]+)?$' THEN valuation::numeric END AS valuation_number,
    CASE WHEN citations ~ '^[0-9]+(\.[0-9]+)?$' THEN citations::numeric END AS citations_number,
    CASE WHEN independent_claims ~ '^[0-9]+(\.[0-9]+)?$'
      AND dependent_claims ~ '^[0-9]+(\.[0-9]+)?$'
      THEN independent_claims::numeric + dependent_claims::numeric END AS claims,
    CASE WHEN asking_price ~ '^[0-9]+(\.[0-9]+)?$' THEN asking_price::numeric END AS price
  FROM source
)`;

const SEARCH_FIELDS = ['publicationNumber', 'applicationNumber', 'title', 'abstract',
  'inventor', 'assignee', 'domain', 'subdomain'];

function positiveInteger(value, fallback, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) ||
      !Number.isSafeInteger(Number(value)) || Number(value) > maximum) {
    const error = new Error(name + ' must be a positive integer' +
      (maximum < Number.MAX_SAFE_INTEGER ? ' no greater than ' + maximum : '') + '.');
    error.status = 400;
    throw error;
  }
  return Number(value);
}

function createPatentRouter(pool) {
  const router = express.Router();
  let cache = null;
  let generation = 0;
  function clearFacetsCache() { cache = null; generation += 1; }

  router.get('/facets', async (req, res, next) => {
    try {
      if (cache && cache.expires > Date.now()) return res.json(cache.data);
      const startedGeneration = generation;
      const { rows } = await pool.query(BASE + ` SELECT domain, subdomain, assignee, status, patent_type, entity_type, country, pub_date FROM records`);
      const { rows: assignees } = await pool.query(BASE + `
        SELECT btrim(a.name) AS name, count(*)::integer AS count
        FROM records
        CROSS JOIN LATERAL unnest(string_to_array(assignee, '|')) AS a(name)
        WHERE btrim(a.name) <> ''
        GROUP BY btrim(a.name)
        ORDER BY count DESC, name
        LIMIT 500`);
      const { rows: [ranges] } = await pool.query(BASE + `
        SELECT
          jsonb_build_object('min', min(valuation_number), 'max', max(valuation_number)) AS valuation,
          jsonb_build_object('min', min(claims), 'max', max(claims)) AS claims,
          jsonb_build_object('min', min(citations_number), 'max', max(citations_number)) AS citations,
          jsonb_build_object('min', min(family_size), 'max', max(family_size)) AS "familySize",
          jsonb_build_object('min', min(price), 'max', max(price)) AS price
        FROM records`);
      const counts = { legalStatuses: new Map(), patentTypes: new Map(),
        entityTypes: new Map(), jurisdictions: new Map() };
      const domains = new Map();
      let min = null;
      let max = null;
      function increment(map, value) {
        if (value != null && value.trim() !== '') map.set(value, (map.get(value) || 0) + 1);
      }
      for (const row of rows) {
        if (row.domain != null && row.domain.trim() !== '') {
          if (!domains.has(row.domain)) domains.set(row.domain, { count: 0, subdomains: new Map() });
          const domain = domains.get(row.domain);
          domain.count += 1;
          increment(domain.subdomains, row.subdomain);
        }
        for (const [key, field] of [['legalStatuses', 'status'],
          ['patentTypes', 'patent_type'], ['entityTypes', 'entity_type'], ['jurisdictions', 'country']]) {
          increment(counts[key], row[field]);
        }
        const year = row.pub_date && row.pub_date.slice(0, 4);
        if (/^\d{4}$/.test(year)) {
          const number = Number(year);
          min = min === null ? number : Math.min(min, number);
          max = max === null ? number : Math.max(max, number);
        }
      }
      const entries = (map, key) => [...map].map(([value, count]) => ({ [key]: value, count }))
        .sort((a, b) => b.count - a.count || a[key].localeCompare(b[key]));
      const data = { total: rows.length,
        domains: [...domains].map(([domain, value]) => ({ domain, count: value.count,
          subdomains: entries(value.subdomains, 'subdomain') })).sort((a, b) => a.domain.localeCompare(b.domain)),
        assignees,
        legalStatuses: entries(counts.legalStatuses, 'value'),
        patentTypes: entries(counts.patentTypes, 'value'),
        entityTypes: entries(counts.entityTypes, 'value'),
        jurisdictions: entries(counts.jurisdictions, 'value'), yearRange: { min, max }, ...ranges };
      if (generation === startedGeneration) cache = { data, expires: Date.now() + 300000 };
      res.json(data);
    } catch (error) { next(error); }
  });

  router.get('/search', async (req, res, next) => {
    try {
      const page = positiveInteger(req.query.page, 1, 'page');
      const pageSize = positiveInteger(req.query.pageSize, 20, 'pageSize', 100);
      const offset = (page - 1) * pageSize;
      if (!Number.isSafeInteger(offset)) return res.status(400).json({ error: 'page is too large.' });
      const list = (key) => req.query[key] === undefined ? null :
        (Array.isArray(req.query[key]) ? req.query[key] : [req.query[key]]).map(String);
      const terms = (list('q') || []).flatMap(q => q.split(/\s+/)).filter(Boolean);
      const pattern = terms.length ? terms.map(q => '%' + q.replace(/[\\%_]/g, '\\$&') + '%') : null;
      const numericBounds = (key) => {
        const bounds = list(key);
        if (bounds && bounds.some(value => !/^[0-9]+(\.[0-9]+)?$/.test(value) || !Number.isFinite(Number(value)))) {
          const error = new Error(key + ' must be a non-negative number.');
          error.status = 400;
          throw error;
        }
        return bounds;
      };
      const mode = req.query.mode === undefined ? 'and' : req.query.mode;
      if (!['and', 'or'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be and or or.' });
      }
      const fields = list('in') || SEARCH_FIELDS;
      if (fields.some(field => !SEARCH_FIELDS.includes(field))) {
        return res.status(400).json({ error: 'Unknown search field. Allowed values for in: ' + SEARCH_FIELDS.join(', ') + '.' });
      }
      const litigation = req.query.litigation === undefined ? null : req.query.litigation;
      if (litigation !== null && !['include', 'exclude'].includes(litigation)) {
        return res.status(400).json({ error: 'litigation must be include or exclude.' });
      }
      const sort = req.query.sort || 'relevance';
      if (!['relevance', 'newest', 'citations', 'price-low', 'price-high'].includes(sort)) {
        return res.status(400).json({ error: 'sort must be relevance, newest, citations, price-low, or price-high.' });
      }
      const values = [pattern, req.query.pn === '1', list('domain'), list('subdomain'), list('assignee'),
        list('status'), list('type'), list('entityType'), list('jurisdiction'),
        list('yearFrom'), list('yearTo'), sort, HEAVY_COLUMNS, pageSize, offset,
        numericBounds('minValuation'), numericBounds('maxValuation'), numericBounds('minCitations'),
        numericBounds('minClaims'), numericBounds('minFamilySize'), req.query.alive === '1', litigation, mode, fields];
      const { rows } = await pool.query(BASE + String.raw`, filtered AS (
        SELECT * FROM records WHERE
          ($1::text[] IS NULL OR (
            SELECT CASE WHEN $23::text = 'and' THEN bool_and(matched) ELSE bool_or(matched) END
            FROM (
              SELECT EXISTS (
                SELECT 1 FROM unnest(ARRAY[
                  CASE WHEN $2::boolean OR 'publicationNumber' = ANY($24::text[]) THEN publication_number END,
                  CASE WHEN NOT $2 AND 'applicationNumber' = ANY($24) THEN application_number END,
                  CASE WHEN NOT $2 AND 'title' = ANY($24) THEN title END,
                  CASE WHEN NOT $2 AND 'abstract' = ANY($24) THEN abstract END,
                  CASE WHEN NOT $2 AND 'inventor' = ANY($24) THEN inventor END,
                  CASE WHEN NOT $2 AND 'assignee' = ANY($24) THEN assignee END,
                  CASE WHEN NOT $2 AND 'domain' = ANY($24) THEN domain END,
                  CASE WHEN NOT $2 AND 'subdomain' = ANY($24) THEN subdomain END
                ]) AS field(value) WHERE field.value ILIKE term.pattern
              ) AS matched
              FROM unnest($1::text[]) AS term(pattern)
            ) AS matches
          ))
          AND ($3::text[] IS NULL OR domain = ANY($3))
          AND ($4::text[] IS NULL OR subdomain = ANY($4))
          AND ($5::text[] IS NULL OR EXISTS (
            SELECT 1 FROM unnest(string_to_array(assignee, '|')) AS x(name)
            WHERE btrim(x.name) = ANY($5)))
          AND ($6::text[] IS NULL OR status = ANY($6))
          AND ($7::text[] IS NULL OR patent_type = ANY($7))
          AND ($8::text[] IS NULL OR entity_type = ANY($8))
          AND ($9::text[] IS NULL OR country = ANY($9))
          AND ($10::text[] IS NULL OR left(pub_date, 4) >= ANY($10))
          AND ($11::text[] IS NULL OR left(pub_date, 4) <= ANY($11))
          AND ($16::numeric[] IS NULL OR valuation_number >= ALL($16))
          AND ($17::numeric[] IS NULL OR valuation_number <= ALL($17))
          AND ($18::numeric[] IS NULL OR citations_number >= ALL($18))
          AND ($19::numeric[] IS NULL OR claims >= ALL($19))
          AND ($20::numeric[] IS NULL OR family_size >= ALL($20))
          AND (NOT $21::boolean OR (
            COALESCE(raw->>'Legal Status', '') !~* '\y(inactive|dead|expired|lapsed)\y'
            AND COALESCE(raw->>'Simple Legal Status', '') !~* '\y(inactive|dead|expired|lapsed)\y'))
          AND ($22::text IS NULL OR litigated = ($22 = 'include'))
      ), selected AS (
        SELECT raw - $13::text[] AS raw FROM filtered
        ORDER BY
          CASE WHEN $12 = 'newest' THEN NULLIF(pub_date, '') END DESC NULLS LAST,
          CASE WHEN $12 = 'citations' THEN citations_number END DESC NULLS LAST,
          CASE WHEN $12 = 'price-low' THEN price END ASC NULLS LAST,
          CASE WHEN $12 = 'price-high' THEN price END DESC NULLS LAST,
          CASE WHEN $12 = 'relevance' AND $1::text[] IS NOT NULL THEN
            CASE WHEN publication_number ILIKE ANY($1) THEN 3 WHEN title ILIKE ANY($1) THEN 2 ELSE 1 END
          END DESC NULLS LAST,
          publication_number
        LIMIT $14 OFFSET $15
      ) SELECT (SELECT count(*)::integer FROM filtered) AS total,
        COALESCE((SELECT jsonb_agg(raw) FROM selected), '[]'::jsonb) AS rows`, values);
      res.json({ ...rows[0], page, pageSize });
    } catch (error) { next(error); }
  });

  router.get('/related/:publicationNumber', async (req, res, next) => {
    try {
      const limit = positiveInteger(req.query.limit, 3, 'limit');
      const { rows } = await pool.query(BASE + `, target AS (
        SELECT * FROM records WHERE lower(publication_number) = lower($1) LIMIT 1
      ) SELECT candidate.raw - $2::text[] AS raw
      FROM records candidate CROSS JOIN target
      WHERE lower(candidate.publication_number) <> lower(target.publication_number)
        AND ((NULLIF(btrim(target.subdomain), '') IS NOT NULL AND candidate.subdomain = target.subdomain)
          OR (NULLIF(btrim(target.domain), '') IS NOT NULL AND candidate.domain = target.domain))
      ORDER BY CASE WHEN candidate.subdomain = target.subdomain THEN 0 ELSE 1 END,
        candidate.publication_number
      LIMIT $3`, [req.params.publicationNumber, HEAVY_COLUMNS, limit]);
      res.json(rows.map(row => row.raw));
    } catch (error) { next(error); }
  });

  return { router, clearFacetsCache };
}

module.exports = { createPatentRouter, positiveInteger, HEAVY_COLUMNS };
