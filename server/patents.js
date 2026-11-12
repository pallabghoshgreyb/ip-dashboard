const express = require('express');

const HEAVY_COLUMNS = [
  'Backward Cited Patents or Backward Citations',
  'Forward Citing Patents or Forward Citations', 'CPCs', 'CPCs (2)', 'IPCs',
  'INPADOC Family Members',
  'Market Region or Geographical Distribution or Geo Graphical Distribution',
  'GAU - Definiations or GAU Definitions',
];

// Only fixed SQL is composed here; all request values are bound parameters.
const BASE = `WITH records AS (
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
    COALESCE(raw->>'Count of Forward Citation or Forward Citations Count',
      raw->>'Count of Forward Citation',
      raw->>'Forward Citation Count', raw->>'Forward Citations Count',
      raw->>'Forward Citations', raw->>'Forward Citing Patents Count') AS citations
  FROM patents.patent
)`;

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
        jurisdictions: entries(counts.jurisdictions, 'value'), yearRange: { min, max } };
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
      const terms = (list('q') || []).filter(Boolean);
      const pattern = terms.length ? terms.map(q => '%' + q.replace(/[\\%_]/g, '\\$&') + '%') : null;
      const sort = req.query.sort || 'relevance';
      if (!['relevance', 'newest', 'citations'].includes(sort)) {
        return res.status(400).json({ error: 'sort must be relevance, newest, or citations.' });
      }
      const values = [pattern, req.query.pn === '1', list('domain'), list('subdomain'), list('assignee'),
        list('status'), list('type'), list('entityType'), list('jurisdiction'),
        list('yearFrom'), list('yearTo'), sort, HEAVY_COLUMNS, pageSize, offset];
      const { rows } = await pool.query(BASE + `, filtered AS (
        SELECT * FROM records WHERE
          ($1::text[] IS NULL OR publication_number ILIKE ANY($1) OR
            (NOT $2::boolean AND (title ILIKE ANY($1) OR abstract ILIKE ANY($1))))
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
      ), selected AS (
        SELECT raw - $13::text[] AS raw FROM filtered
        ORDER BY
          CASE WHEN $12 = 'newest' THEN NULLIF(pub_date, '') END DESC NULLS LAST,
          CASE WHEN $12 = 'citations' AND citations ~ '^[0-9]+$' THEN citations::numeric END DESC NULLS LAST,
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
