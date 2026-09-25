'use strict';
// Intercept only the provider transport; the generator, safety gate and API run.
const { EventEmitter } = require('node:events');
module.exports = function briefProvider(next) {
  const https = require('node:https'), original = https.request, fetch = global.fetch;
  // The merged route also asks Decision Engine for priorities through the SDK.
  global.fetch = async function (input, ...args) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname === 'api.openai.com' && url.pathname === '/v1/chat/completions') {
      return new Response(JSON.stringify({choices:[{message:{content:'{"recommendations":[]}'}}]}),
        {status:200,headers:{'Content-Type':'application/json'}});
    }
    return fetch.call(this,input,...args);
  };
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'synthetic-marketing-brief-provider';
  https.request = function (options, callback) {
    if (options.hostname !== 'api.openai.com' || options.path !== '/v1/chat/completions')
      return original.apply(this, arguments);
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.write = () => {};
    request.destroy = () => {};
    request.end = () => { void Promise.resolve().then(next).then(body => {
      const response = new EventEmitter(); response.statusCode = 200;
      callback(response);
      response.emit('data', JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }));
      response.emit('end');
    }).catch(e => request.emit('error', e)); };
    return request;
  };
  return () => {
    https.request = original;
    global.fetch = fetch;
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  };
};
