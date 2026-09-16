'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Bridge, command, prompt, readState, signState, REPO } = require('../scripts/cursor-automation/bridge');
const { client, ApiError } = require('../scripts/cursor-automation/client');
const SECRET = 'unit-test-placeholder';
const ROOT = `/repos/${REPO}`;

function fixture() {
  const calls = []; const comments = new Map(); const issues = new Map(); const agents = new Map();
  let seq = 10; let runSeq = 0; let loseCreate = false; let loseFollowup = false; let rejectCreate = 0; let rejectFollowup = 0;
  async function github(method, path, body) {
    calls.push(['github', method, path, body]);
    if (path === `${ROOT}/pulls/999`) return {head: {sha: 'a'.repeat(40)}};
    if (path.endsWith('/check-runs?per_page=100')) return {total_count: 1, check_runs: [{status: 'completed', conclusion: 'success'}]};
    if (path.endsWith('/status')) return {state: 'pending', statuses: []};
    if (path === ROOT && method === 'GET') return { default_branch: 'main' };
    if (path === `${ROOT}/labels`) return {};
    if (path.startsWith(`${ROOT}/issues?`)) return [...issues.values()].filter((i) => i.labels?.includes('cursor-automation'));
    if (path === `${ROOT}/issues` && method === 'POST') {
      const row = { ...body, number: ++seq, state: 'open' }; issues.set(seq, row); return row;
    }
    let m = new RegExp(`^${ROOT}/issues/(\\d+)/comments`).exec(path);
    if (m) {
      const id = Number(m[1]);
      if (method === 'GET') return comments.get(id) || [];
      const row = { id: ++seq, body: body.body, user: { login: 'github-actions[bot]' } };
      comments.set(id, [...(comments.get(id) || []), row]); return row;
    }
    m = new RegExp(`^${ROOT}/issues/comments/(\\d+)$`).exec(path);
    if (m) {
      const row = [...comments.values()].flat().find((c) => c.id === Number(m[1]));
      assert.ok(row); row.body = body.body; return row;
    }
    m = new RegExp(`^${ROOT}/issues/(\\d+)(/labels)?$`).exec(path);
    if (m) {
      const row = issues.get(Number(m[1])); assert.ok(row, path);
      if (m[2]) row.labels = body.labels;
      return row;
    }
    throw new Error(`Unexpected GitHub call ${method} ${path}`);
  }
  function newRun(agent) {
    agent.latestRunId = `run-${++runSeq}`;
    agent.run = { id: agent.latestRunId, status: 'CREATING', git: { branches: [] } };
    agent.status = 'ACTIVE';
    return { run: agent.run };
  }
  async function cursor(method, path, body) {
    calls.push(['cursor', method, path, body]);
    if (path === '/v1/me') return { id: 'test-user' };
    if (path.startsWith('/v1/agents?')) return { items: [...agents.values()] };
    if (path === '/v1/agents' && method === 'POST') {
      if (rejectCreate) throw new ApiError('Cursor', rejectCreate);
      assert.equal(body.workOnCurrentBranch, false);
      assert.equal(body.autoCreatePR, false);
      assert.deepEqual(body.repos, [{ url: `https://github.com/${REPO}`, startingRef: 'main' }]);
      const agent = { id: body.agentId, repos: body.repos, workOnCurrentBranch: false };
      agents.set(agent.id, agent); const result = { agent, ...newRun(agent) };
      if (loseCreate) throw new ApiError('Cursor', 0);
      return result;
    }
    const m = /^\/v1\/agents\/([^/]+)(?:\/runs(?:\/([^/]+)(\/cancel)?)?)?$/.exec(path);
    assert.ok(m, path); const agent = agents.get(m[1]);
    if (!agent) throw new ApiError('Cursor', 404);
    if (m[3]) { agent.run.status = 'CANCELLED'; agent.status = 'IDLE'; return {}; }
    if (m[2]) return agent.run;
    if (method === 'POST') {
      if (rejectFollowup) throw new ApiError('Cursor', rejectFollowup);
      const result = newRun(agent);
      if (loseFollowup) throw new ApiError('Cursor', 0);
      return result;
    }
    return agent;
  }
  const bridge = new Bridge({ github, cursor, secret: SECRET, enabled: true });
  const event = (inputs, run = '1', sender = 'paulventer01') => ({
    repository: { full_name: REPO }, sender: { login: sender }, inputs, _runId: run,
  });
  const start = () => bridge.run('workflow_dispatch', event({ action: 'start', prompt: 'Add a focused test.' }));
  const issueId = () => [...issues.keys()][0];
  const finish = () => { for (const a of agents.values()) { a.status = 'IDLE'; a.run.status = 'FINISHED'; } };
  return { bridge, event, start, finish, calls, comments, issues, agents, issueId,
    rejectCreate: (status) => { rejectCreate = status; }, rejectFollowup: (status) => { rejectFollowup = status; },
    loseCreate: () => { loseCreate = true; }, loseFollowup: () => { loseFollowup = true; } };
}

test('untrusted actors and foreign repositories cannot call either service', async () => {
  const f = fixture();
  await assert.rejects(f.bridge.run('workflow_dispatch', f.event({ action: 'start', prompt: 'task' }, '1', 'outsider')), /not authorised/);
  await assert.rejects(f.bridge.run('schedule', { repository: { full_name: 'other/repo' } }), /not allowed/);
  assert.equal(f.calls.length, 0);
});

test('disabled automation cannot launch; verify only uses GETs', async () => {
  const f = fixture(); f.bridge.enabled = false;
  assert.match(await f.start(), /disabled/); assert.equal(f.calls.length, 0);
  await f.bridge.run('workflow_dispatch', f.event({ action: 'verify' }));
  assert.ok(f.calls.every((c) => c[1] === 'GET'));
});

test('commands must be explicit; PR comments and edited comments do not execute', () => {
  assert.equal(command('issue_comment', { action: 'created', issue: { pull_request: {} }, comment: { body: '/cursor cancel' } }), null);
  assert.equal(command('issue_comment', { action: 'edited', issue: {}, comment: { body: '/cursor cancel' } }), null);
  assert.equal(command('issues', { action: 'opened', issue: { body: 'please /cursor start\ncode' } }), null);
  assert.equal(command('issues', { action: 'opened', issue: { number: 2, id: 5, body: '/cursor start\nDo this' } }).text, 'Do this');
  assert.throws(() => prompt(' '.repeat(3)), /Task must/);
  assert.throws(() => prompt('x'.repeat(12001)), /Task must/);
});

test('state signatures detect editing and credential changes', () => {
  const state = { agentId: 'bc-123', issue: 4, repo: REPO };
  const signed = signState(state, SECRET);
  assert.deepEqual(readState(signed, SECRET), state);
  assert.throws(() => readState(signed, 'rotated-key'), /signature mismatch/);
  assert.throws(() => readState(signed.replace('state:', 'state:Z'), SECRET), /signature mismatch/);
});

test('start persists intent before Cursor POST and cannot be replayed after completion', async () => {
  const f = fixture(); await f.start();
  const post = f.calls.findIndex((c) => c[0] === 'cursor' && c[1] === 'POST');
  assert.ok(f.calls.slice(0, post).some((c) => c[1] === 'POST' && c[2].endsWith('/comments')));
  f.finish(); await f.bridge.refresh(await f.bridge.state(f.issueId()));
  assert.match(await f.start(), /already processed/);
  assert.equal(f.calls.filter((c) => c[0] === 'cursor' && c[1] === 'POST').length, 1);
});

test('uncertain start is recovered by GET and never starts a second agent', async () => {
  const f = fixture(); f.loseCreate(); await assert.rejects(f.start(), /network/);
  assert.equal((await f.bridge.state(f.issueId())).phase, 'UNCERTAIN');
  assert.match(await f.start(), /already processed/);
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  assert.equal((await f.bridge.state(f.issueId())).phase, 'CREATING');
  assert.equal(f.agents.size, 1);
});

test('active work blocks a second task and an overlapping follow-up', async () => {
  const f = fixture(); await f.start();
  await assert.rejects(f.bridge.run('workflow_dispatch', f.event({ action: 'start', prompt: 'Other task' }, '2')), /active|reconciliation/);
  await assert.rejects(f.bridge.followup(await f.bridge.state(f.issueId()), { text: 'Fix it', key: 'comment:1' }), /active run/);
  assert.equal(f.agents.size, 1);
});

test('follow-up reuses the agent, has a durable replay guard and a three-run cap', async () => {
  const f = fixture(); await f.start();
  for (let n = 1; n <= 3; n++) {
    f.finish(); const cmd = { text: 'Fix the bounded issue', key: `comment:${n}` };
    await f.bridge.followup(await f.bridge.state(f.issueId()), cmd);
    assert.match(await f.bridge.followup(await f.bridge.state(f.issueId()), cmd), /already processed/);
  }
  f.finish();
  await assert.rejects(f.bridge.followup(await f.bridge.state(f.issueId()), { text: 'Fourth', key: 'comment:4' }), /limit/);
  assert.equal(f.agents.size, 1);
});

test('follow-up response loss recovers the newly accepted run without replay', async () => {
  const f = fixture(); await f.start(); f.finish(); f.loseFollowup();
  const cmd = { text: 'Fix', key: 'comment:1' };
  await assert.rejects(f.bridge.followup(await f.bridge.state(f.issueId()), cmd), /network/);
  assert.equal((await f.bridge.state(f.issueId())).phase, 'FOLLOWUP_PENDING');
  assert.match(await f.bridge.followup(await f.bridge.state(f.issueId()), cmd), /already processed/);
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  assert.equal((await f.bridge.state(f.issueId())).runId, 'run-2');
});

test('agent repository and branch configuration are revalidated before control', async () => {
  const f = fixture(); await f.start();
  [...f.agents.values()][0].workOnCurrentBranch = true;
  await assert.rejects(f.bridge.cancel(await f.bridge.state(f.issueId())), /outside the permitted/);
  assert.ok(!f.calls.some((c) => c[2].endsWith('/cancel')));
});

test('cancel confirms terminal state; scheduled monitoring never launches work', async () => {
  const f = fixture(); await f.start();
  await f.bridge.cancel(await f.bridge.state(f.issueId()));
  assert.equal((await f.bridge.state(f.issueId())).phase, 'CANCELLED');
  const before = f.calls.filter((c) => c[0] === 'cursor' && c[1] === 'POST').length;
  await f.bridge.run('schedule', f.event({}));
  assert.equal(f.calls.filter((c) => c[0] === 'cursor' && c[1] === 'POST').length, before);
});

test('HTTP client uses fixed destination, timeout, no redirects/retries, and sanitised errors', async () => {
  const requests = [];
  const api = client('https://api.cursor.com', SECRET, 'Cursor', async (url, opts) => {
    requests.push({ url, opts }); return { ok: false, status: 401, json: async () => ({ secret: SECRET }) };
  });
  await assert.rejects(api('POST', '/v1/agents', { prompt: { text: 'test' } }), (e) => !e.message.includes(SECRET) && e.status === 401);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.cursor.com/v1/agents');
  assert.equal(requests[0].opts.redirect, 'error');
  assert.ok(requests[0].opts.signal);
  await assert.rejects(api('GET', '//evil.example'), /Invalid API path/);
  assert.equal(requests.length, 1);
});

 test('definite start rejection permits a new authorised task after correction', async () => {
  const f = fixture(); f.rejectCreate(403);
  await assert.rejects(f.start(), /403/);
  assert.equal((await f.bridge.state(f.issueId())).phase, 'REJECTED');
  assert.equal(f.agents.size, 0);
  f.rejectCreate(0);
  await f.bridge.run('workflow_dispatch', f.event({action: 'start', prompt: 'Retry corrected configuration'}, '2'));
  assert.equal(f.agents.size, 1);
 });
 test('definite follow-up rejection restores state but never replays the rejected command', async () => {
  const f = fixture(); await f.start(); f.finish(); f.rejectFollowup(429);
  const cmd = {text: 'Fix', key: 'comment:reject'};
  await assert.rejects(f.bridge.followup(await f.bridge.state(f.issueId()), cmd), /429/);
  const state = await f.bridge.state(f.issueId());
  assert.equal(state.phase, 'FINISHED'); assert.equal(state.followups, 0);
  assert.match(await f.bridge.followup(state, cmd), /already processed/);
  f.rejectFollowup(0);
  await f.bridge.followup(await f.bridge.state(f.issueId()), {text: 'Retry', key: 'comment:new'});
  assert.equal((await f.bridge.state(f.issueId())).runId, 'run-2');
 });
 test('GitHub persistence failure after accepted launch remains uncertain', async () => {
  const f = fixture(); const github = f.bridge.github; let failed = false;
  f.bridge.github = async (method, path, body) => {
    if (!failed && method === 'PATCH' && f.agents.size) { failed = true; throw new ApiError('GitHub', 403); }
    return github(method, path, body);
  };
  await assert.rejects(f.start(), /403/);
  assert.equal((await f.bridge.state(f.issueId())).phase, 'UNCERTAIN');
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  assert.equal((await f.bridge.state(f.issueId())).phase, 'CREATING');
  assert.equal(f.agents.size, 1);
 });

test('completed checks without legacy commit statuses are reported accurately', async () => {
  const f = fixture(); await f.start(); f.finish();
  [...f.agents.values()][0].run.git.branches = [{prUrl: `https://github.com/${REPO}/pull/999`}];
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  assert.match((await f.bridge.state(f.issueId())).ci[0], /reported checks passed/);
});
