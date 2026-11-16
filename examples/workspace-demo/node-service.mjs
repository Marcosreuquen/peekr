import http from 'node:http';

const { SERVICE_NAME, APP_PORT, NEXT_URL, GATEWAY_URL, INVENTORY_URL, EXTERNAL_URL, http_proxy: proxyUrl } = process.env;

function callNext(url) {
  return new Promise((resolve, reject) => {
    const proxy = new URL(proxyUrl);
    const target = new URL(url);
    const req = http.get({ hostname: proxy.hostname, port: proxy.port, path: target.href, headers: { host: target.host } }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`upstream returned ${res.statusCode}: ${body}`));
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') { res.end('ok'); return; }
  const requestUrl = new URL(req.url, 'http://localhost');
  if (requestUrl.pathname !== '/flow') { res.writeHead(404); res.end('Not found'); return; }
  try {
    const step = requestUrl.searchParams.get('step');
    let next;
    let external;
    if (step === 'circular' && SERVICE_NAME === 'gateway-node') {
      next = await callNext(`${NEXT_URL}?step=callback`);
    } else if (step === 'callback' && SERVICE_NAME === 'orders-node') {
      next = await callNext(`${GATEWAY_URL}?step=finish`);
    } else if (step === 'finish' && SERVICE_NAME === 'gateway-node') {
      next = await callNext(INVENTORY_URL);
      external = await callNext(EXTERNAL_URL);
    } else {
      next = await callNext(NEXT_URL);
    }
    const body = JSON.stringify({ service: SERVICE_NAME, next, ...(external ? { external } : {}) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ service: SERVICE_NAME, error: err.message }));
  }
});
server.listen(Number(APP_PORT), '127.0.0.1', () => console.log(`${SERVICE_NAME} listening on ${APP_PORT}`));
