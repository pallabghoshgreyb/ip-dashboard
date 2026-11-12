const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createPatentRouter, HEAVY_COLUMNS } = require('./patents');

async function withApi(query, run) {
  const { router, clearFacetsCache } = createPatentRouter({ query });
  const app = express();
  app.use('/api/patents', router);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port + '/api/patents';
  try { await run(base, clearFacetsCache); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('invalid search options return 400 before querying the database', async () => {
  await withApi(async () => assert.fail('invalid options must not query the database'), async base => {
    const invalid = ['page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=1&page=2',
      'pageSize=0', 'pageSize=101', 'pageSize=abc', 'page=9007199254740991',
      'mode=x', 'in=unknown', 'pn=1&in=unknown', 'litigation=x', 'sort=x'];
    for (const name of ['minValuation', 'maxValuation', 'minCitations', 'minClaims', 'minFamilySize']) {
      for (const value of ['', 'abc', 'NaN', 'Infinity', '-1', '1e3', '0x10', '1.2x']) {
        invalid.push(name + '=' + encodeURIComponent(value));
      }
      invalid.push(name + '=1&' + name + '=abc');
    }
    for (const query of invalid) {
      const response = await fetch(base + '/search?' + query);
      assert.equal(response.status, 400, query);
      assert.ok((await response.json()).error, query);
    }
  });
});

test('search binds numeric bounds, flags, terms, fields and all supported sorts', async () => {
  const calls = [];
  await withApi(async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [{ rows: [], total: 4 }] };
  }, async base => {
    const query = new URLSearchParams({ q: "battery O'Reilly 50%", page: '2', pageSize: '10',
      minValuation: '0', maxValuation: '123.45', minCitations: '5', minClaims: '2.5',
      minFamilySize: '1', alive: '1', litigation: 'include', mode: 'or', sort: 'price-high' });
    query.append('domain', 'A'); query.append('domain', 'B');
    query.append('assignee', "O'Reilly");
    query.append('in', 'title'); query.append('in', 'inventor');
    query.append('minClaims', '4');
    const response = await fetch(base + '/search?' + query);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { rows: [], total: 4, page: 2, pageSize: 10 });
    const { sql, values } = calls[0];
    assert.deepEqual(values[0], ['%battery%', "%O'Reilly%", '%50\\%%']);
    assert.deepEqual(values[2], ['A', 'B']);
    assert.deepEqual(values[4], ["O'Reilly"]);
    assert.equal(values[11], 'price-high');
    assert.deepEqual(values[12], HEAVY_COLUMNS);
    assert.deepEqual(values.slice(13, 15), [10, 10]);
    assert.deepEqual(values.slice(15, 20), [['0'], ['123.45'], ['5'], ['2.5', '4'], ['1']]);
    assert.deepEqual(values.slice(20), [true, 'include', 'or', ['title', 'inventor']]);
    assert.ok(!sql.includes("O'Reilly"));
    assert.ok(!sql.includes('123.45'));

    await fetch(base + '/search?q=alpha%20beta&q=gamma');
    assert.deepEqual(calls[1].values[0], ['%alpha%', '%beta%', '%gamma%']);
    assert.equal(calls[1].values[22], 'and');
    assert.deepEqual(new Set(calls[1].values[23]), new Set(['publicationNumber', 'applicationNumber',
      'title', 'abstract', 'inventor', 'assignee', 'domain', 'subdomain']));
    assert.deepEqual(calls[1].values.slice(15, 20), [null, null, null, null, null]);
    for (const sort of ['relevance', 'newest', 'citations', 'price-low', 'price-high']) {
      assert.equal((await fetch(base + '/search?sort=' + sort)).status, 200, sort);
      assert.equal(calls.at(-1).values[11], sort);
    }
    await fetch(base + '/search?pn=1&in=title&litigation=exclude');
    assert.equal(calls.at(-1).values[1], true);
    assert.equal(calls.at(-1).values[21], 'exclude');
  });
});

test('facets expose numeric bounds and keep cached results until invalidated', async () => {
  const calls = [];
  const bounds = { valuation: { min: 0, max: 123.45 }, claims: { min: 0, max: 30 },
    citations: { min: 0, max: 100 }, familySize: { min: 0, max: 10 }, price: { min: null, max: null } };
  await withApi(async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('CROSS JOIN target')) return { rows: [{ raw: { Title: 'Related' } }] };
    if (sql.includes('LIMIT 500')) return { rows: [{ name: 'A', count: 2 }, { name: 'B', count: 1 }] };
    if (sql.includes('jsonb_build_object')) return { rows: [bounds] };
    return { rows: [
      { domain: 'Battery', subdomain: 'Cells', assignee: 'A | B', status: 'Active', pub_date: '2020-01-01' },
      { domain: 'Battery', subdomain: '', assignee: 'A', pub_date: '2024-01-01' },
      { domain: null, assignee: ' ', pub_date: null },
    ] };
  }, async (base, clearFacetsCache) => {
    const facets = await (await fetch(base + '/facets')).json();
    assert.equal(facets.total, 3);
    assert.deepEqual(facets.yearRange, { min: 2020, max: 2024 });
    assert.deepEqual(facets.domains, [{ domain: 'Battery', count: 2, subdomains: [{ subdomain: 'Cells', count: 1 }] }]);
    assert.deepEqual(facets.assignees, [{ name: 'A', count: 2 }, { name: 'B', count: 1 }]);
    for (const [name, range] of Object.entries(bounds)) assert.deepEqual(facets[name], range, name);
    assert.equal(calls.length, 3);
    assert.deepEqual(await (await fetch(base + '/facets')).json(), facets);
    assert.equal(calls.length, 3);
    clearFacetsCache();
    await fetch(base + '/facets');
    assert.equal(calls.length, 6);
    assert.deepEqual(await (await fetch(base + '/related/US123?limit=2')).json(), [{ Title: 'Related' }]);
    assert.deepEqual(calls.at(-1).values, ['US123', HEAVY_COLUMNS, 2]);
  });
});
