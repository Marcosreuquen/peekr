// lib/intercept-template.mjs
// This file is a template. __PROXY_PORT__ is replaced before writing to /tmp.
export const INTERCEPT_TEMPLATE = `
import http from 'node:http';
import https from 'node:https';

const PROXY_PORT = __PROXY_PORT__;
const PROXY_HOST = '127.0.0.1';

// Guard against double-patching (e.g. when NODE_OPTIONS causes reload in same process)
if (http.request.__peekr_patched__) {
  // Already intercepted — skip to prevent proxy loop from chained patches
  process.exit && void 0; // no-op; just let the guard short-circuit below
} else {

// Save originals before any patching
const _httpRequest = http.request.bind(http);

function patchModule(mod, proto) {
  mod.request = function patchedRequest(options, callback) {
    // Normalize options to object form
    if (typeof options === 'string' || options instanceof URL) {
      const u = new URL(options.toString());
      options = {
        hostname: u.hostname,
        host: u.host,
        port: u.port || (proto === 'https' ? 443 : 80),
        path: u.pathname + u.search,
        protocol: u.protocol,
      };
    } else {
      options = Object.assign({}, options);
    }

    const destHost = options.hostname || options.host || 'localhost';
    const destPort = options.port || (proto === 'https' ? 443 : 80);
    const destPath = options.path || '/';

    // Redirect to local peekr proxy
    options.hostname = PROXY_HOST;
    options.host = PROXY_HOST;
    options.port = PROXY_PORT;
    options.protocol = 'http:';
    // Encode original destination in custom headers
    options.headers = options.headers || {};
    options.headers['x-peekr-dest'] = destHost;
    options.headers['x-peekr-dest-port'] = String(destPort);
    options.headers['x-peekr-dest-proto'] = proto;

    // Always use plain http to reach the local proxy (use saved original to avoid recursion)
    return _httpRequest(options, callback);
  };

}

patchModule(http, 'http');
patchModule(https, 'https');
http.request.__peekr_patched__ = true;

} // end double-patch guard
`;

export const INTERCEPT_TEMPLATE_CJS = `
const http = require('node:http');
const https = require('node:https');

const PROXY_PORT = __PROXY_PORT__;
const PROXY_HOST = '127.0.0.1';

// Guard against double-patching (e.g. when NODE_OPTIONS causes reload in same process)
if (http.request.__peekr_patched__) {
  // Already intercepted — skip to prevent proxy loop from chained patches
  process.exit && void 0; // no-op; just let the guard short-circuit below
} else {

// Save originals before any patching
const _httpRequest = http.request.bind(http);

function patchModule(mod, proto) {
  mod.request = function patchedRequest(options, callback) {
    // Normalize options to object form
    if (typeof options === 'string' || options instanceof URL) {
      const u = new URL(options.toString());
      options = {
        hostname: u.hostname,
        host: u.host,
        port: u.port || (proto === 'https' ? 443 : 80),
        path: u.pathname + u.search,
        protocol: u.protocol,
      };
    } else {
      options = Object.assign({}, options);
    }

    const destHost = options.hostname || options.host || 'localhost';
    const destPort = options.port || (proto === 'https' ? 443 : 80);

    // Redirect to local peekr proxy
    options.hostname = PROXY_HOST;
    options.host = PROXY_HOST;
    options.port = PROXY_PORT;
    options.protocol = 'http:';
    // Encode original destination in custom headers
    options.headers = options.headers || {};
    options.headers['x-peekr-dest'] = destHost;
    options.headers['x-peekr-dest-port'] = String(destPort);
    options.headers['x-peekr-dest-proto'] = proto;

    // Always use plain http to reach the local proxy (use saved original to avoid recursion)
    return _httpRequest(options, callback);
  };

}

patchModule(http, 'http');
patchModule(https, 'https');
http.request.__peekr_patched__ = true;

} // end double-patch guard
`;
