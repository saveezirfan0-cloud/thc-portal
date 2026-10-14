// Stand-in for Supabase's Kong on :54321 — /rest/v1 → PostgREST, /auth/v1 → GoTrue.
import http from 'node:http';
const routes = [
  ['/rest/v1', 54330],
  ['/auth/v1', 9999],
];
http
  .createServer((req, res) => {
    const cors = {
      'access-control-allow-origin': req.headers.origin || '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': req.headers['access-control-request-headers'] || '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-expose-headers': 'content-range, x-supabase-api-version',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    const hit = routes.find(([p]) => req.url.startsWith(p));
    if (!hit) {
      res.writeHead(req.url.startsWith('/storage/v1/object/list') ? 200 : 404, {
        ...cors,
        'content-type': 'application/json',
      });
      return res.end(
        req.url.startsWith('/storage/v1/object/list')
          ? '[]'
          : JSON.stringify({ error: 'not running locally', path: req.url }),
      );
    }
    const up = http.request(
      {
        host: '127.0.0.1',
        port: hit[1],
        path: req.url.slice(hit[0].length) || '/',
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${hit[1]}` },
      },
      (r) => {
        res.writeHead(r.statusCode, { ...r.headers, ...cors });
        r.pipe(res);
      },
    );
    up.on('error', (e) => {
      res.writeHead(502, cors);
      res.end(String(e));
    });
    req.pipe(up);
  })
  .listen(54321, '127.0.0.1', () => console.warn('gateway :54321'));
