'use strict';
const {EventEmitter} = require('node:events');
// Intercept one reserved fixture host, never send credentials or content outside.
module.exports = function wordpressProviderFixture() {
  const https = require('node:https'), original = https.request, calls = [];
  const state = {calls, status:201, restore:() => { https.request = original; }};
  https.request = function (options, callback) {
    if (options.hostname !== 'wordpress.example.test') return original.apply(this, arguments);
    const req = new EventEmitter(); let body = '';
    req.setTimeout = () => req;
    req.write = chunk => { body += chunk; };
    req.end = () => {
      calls.push({path:options.path, method:options.method, body:JSON.parse(body)});
      queueMicrotask(() => {
        const res = new EventEmitter(); res.statusCode = state.status;
        callback(res);
        res.emit('data', JSON.stringify({id:41,link:'https://wordpress.example.test/post/41'}));
        res.emit('end');
      });
    };
    return req;
  };
  return state;
};
