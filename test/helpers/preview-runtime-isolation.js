'use strict';
// Test-only preload: observe the actual launcher without adding an HTTP endpoint
// or changing its jobs, timers, network policy, authentication or child environment.
const assert = require('node:assert/strict');
const path = require('node:path');
const net = require('node:net');
const ROOT = path.resolve(__dirname, '../..');
const BLOCKED = /External connections are disabled in this preview\./;

function installObserver() {
  const Module = require('node:module');
  const load = Module._load;
  let registering = false, serverLoads = 0, schedulerStarts = 0;
  const timers = [], listeners = [], wrapped = new WeakSet();
  for (const name of ['setTimeout', 'setInterval']) {
    const original = global[name];
    global[name] = function (...args) {
      const caller = new Error().stack.split('\n')[2] || '';
      if ((registering || name === 'setInterval') && (caller.includes(ROOT + '/server.js:') || caller.includes(ROOT + '/services/'))) {
        timers.push(name + ':' + caller.slice(caller.indexOf(ROOT) + ROOT.length));
      }
      return original.apply(this, args);
    };
  }
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    if (registering) listeners.push('register-time listener');
    return listen.apply(this, args);
  };
  Module._load = function (request, parent, isMain) {
    const filename = Module._resolveFilename(request, parent, isMain);
    const isServer = filename === path.join(ROOT, 'server.js');
    if (isServer) { registering = true; serverLoads++; }
    let result;
    try { result = load.apply(this, arguments); }
    finally { if (isServer) registering = false; }
    if (filename === path.join(ROOT, 'services/jobs/scheduler.js') && !wrapped.has(result)) {
      wrapped.add(result);
      const start = result.startJobs;
      result.startJobs = function (...args) { schedulerStarts++; return start.apply(this, args); };
    }
    return result;
  };
  process.on('message', async message => {
    if (message?.type !== 'preview-isolation-probe') return;
    try {
      assert.equal(process.env.INFOGENIE_PREVIEW_WORKSPACE, '1');
      assert.equal(process.env.INFOGENIE_JOBS, '0');
      assert.equal(require('../../services/runtime_flags').backgroundEnabled(), false);
      assert.equal(serverLoads, 1, 'the real server was observed during registration');
      assert.deepEqual(timers, [], 'no application register-time background timers');
      assert.deepEqual(listeners, [], 'no register-time listeners');
      assert.equal(schedulerStarts, 0, 'shared scheduler was never started');
      assert.ok(Number.isInteger(message.port) && message.port > 1024 && ![5000,8000,5432].includes(message.port));
      // A real local sentinel detects attempts without contacting a live provider.
      assert.throws(() => net.connect(message.port, '127.0.0.1'), BLOCKED);
      await assert.rejects(fetch('http://127.0.0.1:' + message.port), BLOCKED);
      assert.throws(() => net.connect(443, 'provider.invalid'), BLOCKED);
      await assert.rejects(fetch('https://provider.invalid'), BLOCKED);
      // The installed boundary must still permit the actual app's internal port.
      const socket = net.connect(8000, '127.0.0.1');
      await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
      socket.destroy();
      process.send({type:'preview-isolation-result', ok:true, pid:process.pid});
    } catch (error) {
      process.send({type:'preview-isolation-result', ok:false, error:error.message});
    }
  });
}
if (process.env.INFOGENIE_REQUIRE_PREVIEW_TEST === '1' && typeof process.send === 'function') installObserver();

module.exports = async function verifyRuntimeIsolation(child) {
  let connections = 0;
  const sentinel = net.createServer(socket => { connections++; socket.destroy(); });
  await new Promise((resolve, reject) => { sentinel.once('error', reject); sentinel.listen(0, '127.0.0.1', resolve); });
  try {
    const result = await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timeout); child.off('message', onMessage); child.off('exit', onExit); };
      const onExit = () => { cleanup(); reject(new Error('Preview exited during isolation probe')); };
      const onMessage = value => { if (value?.type === 'preview-isolation-result') { cleanup(); resolve(value); } };
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Preview isolation probe did not respond')); }, 10000);
      child.on('message', onMessage); child.once('exit', onExit);
      child.send({type:'preview-isolation-probe', port:sentinel.address().port}, error => { if (error) { cleanup(); reject(error); } });
    });
    assert.deepEqual(result, {type:'preview-isolation-result', ok:true, pid:child.pid});
    assert.equal(connections, 0, 'no prohibited connection reached the sentinel');
  } finally { await new Promise(resolve => sentinel.close(resolve)); }
};
