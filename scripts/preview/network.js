'use strict';
// Preloaded in the isolated preview and every Next compiler/server child.
// Deny before socket creation: real providers cannot receive preview requests.
const net = require('node:net');
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
function allowed(host, port, socketPath) {
  return !socketPath && LOOPBACK.has(host || 'localhost') && [5000, 8000, 5432].includes(Number(port));
}
function install() {
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const raw = Array.isArray(args[0]) ? args[0] : args, first = raw[0];
    const opts = first && typeof first === 'object' ? first : typeof first === 'string'
      ? {path:first} : {port:first,host:typeof raw[1] === 'string' ? raw[1] : 'localhost'};
    if (!allowed(opts.host, opts.port, opts.path)) throw new Error('External connections are disabled in this preview.');
    return original.apply(this,args);
  };
  const originalFetch = global.fetch;
  global.fetch = (input, ...args) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!['http:', 'https:'].includes(url.protocol) || !allowed(url.hostname,url.port || (url.protocol === 'https:' ? 443 : 80))) {
      return Promise.reject(new Error('External connections are disabled in this preview.'));
    }
    return originalFetch(input,...args);
  };
}
if (process.env.INFOGENIE_PREVIEW_WORKSPACE === '1') install();
module.exports = {allowed};
