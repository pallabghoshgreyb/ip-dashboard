const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createPatentRouter, HEAVY_COLUMNS } = require('./patents');

test('patent routes bind filters, validate pagination, and invalidate facets', async () => {
  const calls = [];
  const pool = { query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('AS total,')) return { rows: [{ rows: [], total: 4 }] };
    if (sql.includes('CROSS JOIN target')) return { rows: [{ raw: { Title: 'Related' } }] };
    return { rows: [
      { domain: 'Battery', subdomain: 'Cells', assignee: 'A', status: 'Active', pub_date: '2020-01-01' },
      { domain: 'Battery', subdomain: '', assignee: 'A', pub_date: '2024-01-01' },
      { domain: null, assignee: ' ', pub_date: null },
    ] };
  } };
  const { router, clearFacetsCache } = createPatentRouter(pool);
  const app = express();
  app.use('/api/patents', router);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port + '/api/patents';
  try {
    for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=1&page=2',
      'pageSize=0', 'pageSize=101', 'pageSize=abc', 'page=9007199254740991']) {
      const response = await fetch(base + '/search?' + query);
      assert.equal(response.status, 400, query);
      assert.match((await response.json()).error, /page/);
    }
    assert.equal(calls.length, 0);
    const response = await fetch(base + '/search?domain=A&domain=B&assignee=O%27Reilly&q=50%25&page=2&pageSize=10');
    assert.deepEqual(await response.json(), { rows: [], total: 4, page: 2, pageSize: 10 });
    assert.deepEqual(calls[0].values[2], ['A', 'B']);
    assert.deepEqual(calls[0].values[4], ["O'Reilly"]);
    assert.deepEqual(calls[0].values[0], ['%50\\%%']);
    assert.equal(calls[0].values[14], 10);
    assert.ok(!calls[0].sql.includes("O'Reilly"));
    assert.deepEqual(calls[0].values[12], HEAVY_COLUMNS);
    const facets = await (await fetch(base + '/facets')).json();
    assert.deepEqual(facets.yearRange, { min: 2020, max: 2024 });
    assert.deepEqual(facets.domains, [{ domain: 'Battery', count: 2, subdomains: [{ subdomain: 'Cells', count: 1 }] }]);
    assert.deepEqual(facets.assignees, [{ name: 'A', count: 2 }]);
    await fetch(base + '/facets');
    assert.equal(calls.length, 2);
    clearFacetsCache();
    await fetch(base + '/facets');
    assert.equal(calls.length, 3);
    assert.deepEqual(await (await fetch(base + '/related/US123?limit=2')).json(), [{ Title: 'Related' }]);
    assert.deepEqual(calls[3].values, ['US123', HEAVY_COLUMNS, 2]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
