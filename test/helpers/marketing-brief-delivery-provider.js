'use strict';
// Intercept the existing webhook transport only. No real delivery is permitted.
const { EventEmitter } = require('node:events');
module.exports = function deliveryProvider(next) {
  const https = require('node:https'), original = https.request;
  const previous = process.env.SLACK_WEBHOOK_URL;
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/synthetic-delivery';
  https.request = function(options, callback) {
    if (!['hooks.slack.com','discord.com','discordapp.com'].includes(options.hostname))
      return original.apply(this, arguments);
    const request = new EventEmitter(); let body = '';
    request.setTimeout = () => request;
    request.write = chunk => { body += chunk; };
    request.destroy = error => request.emit('error', error);
    request.end = () => { void Promise.resolve().then(() => next(JSON.parse(body), options)).then(status => {
      const response = new EventEmitter(); response.statusCode = status;
      callback(response); response.emit('end');
    }).catch(error => request.emit('error', error)); };
    return request;
  };
  return () => {
    https.request = original;
    if (previous === undefined) delete process.env.SLACK_WEBHOOK_URL;
    else process.env.SLACK_WEBHOOK_URL = previous;
  };
};
