import http from 'node:http';

http.createServer((req, res) => {
  if (req.url === '/health') { res.end('ok'); return; }
  if (req.url !== '/catalog') { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ service: 'external-catalog-simulated', currency: 'USD' }));
}).listen(Number(process.env.APP_PORT), '127.0.0.1');
