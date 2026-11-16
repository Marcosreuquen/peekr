import http from 'node:http';
import tls from 'node:tls';
import { createProxyServer } from './proxy-core.mjs';

export async function createWorkspaceProxy({ ca, onRequest, service }) {
  const core = await createProxyServer({ port: 0, host: '127.0.0.1', onRequest, service });
  function forward(req, res, destination) {
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    headers['x-peekr-dest'] = destination.hostname;
    headers['x-peekr-dest-port'] = destination.port || (destination.protocol === 'https:' ? '443' : '80');
    headers['x-peekr-dest-proto'] = destination.protocol.slice(0, -1);
    const upstream = http.request({ hostname: '127.0.0.1', port: core.port, path: destination.pathname + destination.search, method: req.method, headers }, upstreamRes => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    upstream.on('error', err => { if (!res.headersSent) res.writeHead(502); res.end(`Proxy error: ${err.message}`); });
    req.pipe(upstream);
  }
  const server = http.createServer((req, res) => {
    try {
      const destination = new URL(req.url);
      if (destination.protocol !== 'http:') throw new Error('Expected HTTP URL');
      forward(req, res, destination);
    } catch { res.writeHead(400); res.end('Invalid proxy request'); }
  });
  server.on('connect', (req, socket, head) => {
    try {
      const destination = new URL(`https://${req.url}`);
      const host = destination.hostname.replace(/^\[|\]$/g, '');
      const secure = tls.createServer(ca.certificate(host), tlsSocket => {
        const parser = http.createServer((innerReq, innerRes) => {
          try {
            const url = new URL(innerReq.url, destination);
            if (url.origin !== destination.origin) throw new Error('Invalid tunnel destination');
            forward(innerReq, innerRes, url);
          } catch { innerRes.writeHead(400); innerRes.end('Invalid tunnel request'); }
        });
        parser.emit('connection', tlsSocket);
      });
      secure.on('tlsClientError', () => socket.destroy());
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) socket.unshift(head);
      secure.emit('connection', socket);
    } catch { socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); }
  });
  server.on('close', () => core.server.close());
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
  catch (err) { core.server.close(); throw err; }
  return { server, port: server.address().port };
}
