'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Bridge, command, prompt, readState, signState, REPO, LABEL, NOTIFY_MARKER, MONITOR_EVENTS } = require('../scripts/cursor-automation/bridge');
const { client, ApiError } = require('../scripts/cursor-automation/client');
const fs = require('node:fs');
const path = require('node:path');
const SECRET = 'unit-test-placeholder';
const ROOT = `/repos/${REPO}`;
const REPO_URL = `https://github.com/${REPO}`;

function fixture() {
  const calls = []; const comments = new Map(); const issues = new Map(); const agents = new Map();
  const pulls = new Map(); const branches = new Map();
  let seq = 10; let runSeq = 0; let loseCreate = false; let loseFollowup = false; let losePrCreate = false;
  let loseCancel = false; let rejectCreate = 0; let rejectFollowup = 0; let rejectPrCreate = 0;
  let protectionStatus = 403; let protectionBody = null; let branchRules = []; let rulesStatus = 0;
  let checks = [
    {
      id: 1, name: 'fixture-check', status: 'completed', conclusion: 'success',
      started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T00:01:00Z',
      html_url: `https://github.com/${REPO}/runs/1`, app: { id: 15368, slug: 'github-actions' },
    },
  ];
  let statuses = [
    {
      id: 1, context: 'buildkite/infogenie', state: 'success',
      updated_at: '2026-01-01T00:00:00Z',
      target_url: 'https://buildkite.com/paulventer01/infogenie/builds/1',
    },
  ];
  pulls.set(999, {
    number: 999, state: 'open', draft: true, merged: false,
    head: { sha: 'a'.repeat(40), ref: 'cursor/legacy', repo: { full_name: REPO } },
    base: { ref: 'main', repo: { full_name: REPO } },
  });
  async function github(method, path, body) {
    calls.push(['github', method, path, body]);
    if (method === 'PUT' && /\/merge$/.test(path)) throw new Error('merge is forbidden');
    if (method === 'PATCH' && path.startsWith(`${ROOT}/pulls/`) && body?.draft === false) {
      throw new Error('mark-ready is forbidden');
    }
    if (path === ROOT && method === 'GET') return { default_branch: 'main' };
    const checkMatch = new RegExp(`^${ROOT}/commits/([a-f0-9]{40})/check-runs`).exec(path);
    if (checkMatch) {
      const page = Number(new URLSearchParams(path.split('?')[1] || '').get('page') || 1);
      const slice = checks.slice((page - 1) * 100, page * 100);
      return { total_count: checks.length, check_runs: slice };
    }
    const statusMatch = new RegExp(`^${ROOT}/commits/([a-f0-9]{40})/statuses`).exec(path);
    if (statusMatch) {
      const page = Number(new URLSearchParams(path.split('?')[1] || '').get('page') || 1);
      return statuses.slice((page - 1) * 100, page * 100);
    }
    if (path.includes('/protection/required_status_checks')) {
      if (protectionStatus) throw new ApiError('GitHub', protectionStatus);
      return protectionBody || { checks: [], contexts: [] };
    }
    if (path.includes('/rules/branches/')) {
      if (rulesStatus) throw new ApiError('GitHub', rulesStatus);
      return branchRules;
    }
    if (path.endsWith('/status')) return {state: 'pending', statuses: []};
    if (path === `${ROOT}/labels`) return {};
    if (path.startsWith(`${ROOT}/issues?`)) return [...issues.values()].filter((i) => i.labels?.includes(LABEL));
    if (path === `${ROOT}/issues` && method === 'POST') {
      const row = { ...body, number: ++seq, state: 'open' }; issues.set(seq, row); return row;
    }
    if (path.startsWith(`${ROOT}/pulls?`)) {
      const head = new URLSearchParams(path.split('?')[1] || '').get('head') || '';
      const branch = head.startsWith(`${'paulventer01'}:`) ? head.slice('paulventer01:'.length) : null;
      return [...pulls.values()].filter((p) => !branch || p.head?.ref === branch);
    }
    if (path === `${ROOT}/pulls` && method === 'POST') {
      if (rejectPrCreate) throw new ApiError('GitHub', rejectPrCreate);
      assert.equal(body.draft, true);
      assert.notEqual(body.head, 'main');
      const sha = branches.get(body.head)?.commit?.sha || 'd'.repeat(40);
      const row = {
        number: ++seq, draft: true, merged: false, state: 'open',
        head: { sha, ref: body.head, repo: { full_name: REPO } },
        base: { ref: body.base || 'main', repo: { full_name: REPO } },
      };
      pulls.set(row.number, row);
      if (losePrCreate) throw new ApiError('GitHub', 0);
      return row;
    }
    let pm = new RegExp(`^${ROOT}/pulls/(\\d+)$`).exec(path);
    if (pm) {
      const row = pulls.get(Number(pm[1]));
      if (!row) throw new ApiError('GitHub', 404);
      return row;
    }
    let bm = new RegExp(`^${ROOT}/branches/(.+)$`).exec(path);
    if (bm) {
      const row = branches.get(decodeURIComponent(bm[1]));
      if (!row) throw new ApiError('GitHub', 404);
      return row;
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
      assert.deepEqual(body.repos, [{ url: REPO_URL, startingRef: 'main' }]);
      const agent = { id: body.agentId, repos: body.repos, workOnCurrentBranch: false };
      agents.set(agent.id, agent); const result = { agent, ...newRun(agent) };
      if (loseCreate) throw new ApiError('Cursor', 0);
      return result;
    }
    const m = /^\/v1\/agents\/([^/]+)(?:\/runs(?:\/([^/]+)(\/cancel)?)?)?$/.exec(path);
    assert.ok(m, path); const agent = agents.get(m[1]);
    if (!agent) throw new ApiError('Cursor', 404);
    if (agent.failGet) throw new ApiError('Cursor', 500);
    if (m[3]) {
      if (loseCancel) throw new ApiError('Cursor', 0);
      agent.cancelled = agent.cancelled || [];
      agent.cancelled.push(m[2]);
      if (agent.run?.id === m[2]) { agent.run.status = 'CANCELLED'; agent.status = 'IDLE'; }
      return {};
    }
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
  const start = (prompt = 'Add a focused test.') => bridge.run('workflow_dispatch', event({ action: 'start', prompt }));
  const issueId = () => [...issues.keys()][0];
  const finish = () => { for (const a of agents.values()) { a.status = 'IDLE'; a.run.status = 'FINISHED'; } };
  const prPosts = () => calls.filter((c) => c[0] === 'github' && c[1] === 'POST' && c[2] === `${ROOT}/pulls`).length;
  const notices = () => [...comments.values()].flat().filter((c) => c.body?.includes(NOTIFY_MARKER));
  const cancelPosts = () => calls.filter((c) => c[0] === 'cursor' && c[1] === 'POST' && String(c[2] || '').endsWith('/cancel'));
  const runGets = () => calls.filter((c) => c[0] === 'cursor' && c[1] === 'GET' && /\/runs\//.test(c[2] || '')).length;
  const runPosts = () => calls.filter((c) => c[0] === 'cursor' && c[1] === 'POST' && /\/runs$/.test(c[2] || ''));
  return { bridge, event, start, finish, calls, comments, issues, agents, pulls, branches, issueId, prPosts, notices,
    cancelPosts, runGets, runPosts, checks, statuses,
    setChecks: (rows) => { checks = rows; },
    setStatuses: (rows) => { statuses = rows; },
    setProtection: (status, body) => { protectionStatus = status; protectionBody = body; },
    setRules: (rows, status = 0) => { branchRules = rows; rulesStatus = status; },
    rejectCreate: (status) => { rejectCreate = status; }, rejectFollowup: (status) => { rejectFollowup = status; },
    rejectPrCreate: (status) => { rejectPrCreate = status; },
    loseCreate: () => { loseCreate = true; }, loseFollowup: () => { loseFollowup = true; },
    losePrCreate: () => { losePrCreate = true; }, loseCancel: () => { loseCancel = true; } };
}

function seedTask(f, { issue, agentId, phase = 'RUNNING', failGet = false } = {}) {
  f.issues.set(issue, { number: issue, state: 'open', labels: [LABEL] });
  const runId = `run-seed-${issue}`;
  f.agents.set(agentId, {
    id: agentId, repos: [{ url: REPO_URL, startingRef: 'main' }], workOnCurrentBranch: false,
    latestRunId: runId, run: { id: runId, status: phase, git: { branches: [] } },
    status: phase === 'FINISHED' ? 'IDLE' : 'ACTIVE', failGet,
  });
  const body = `Cursor automation: **${phase}**\n\n` + signState({
    repo: REPO, issue, agentId, runId, phase, followups: 0, handled: [],
  }, SECRET);
  f.comments.set(issue, [{ id: 1000 + issue, body, user: { login: 'github-actions[bot]' } }]);
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
  assert.equal(command('check_suite', { action: 'completed' }).action, 'monitor');
  assert.equal(command('pull_request', { action: 'opened' }), null);
  assert.equal(MONITOR_EVENTS.has('pull_request'), false);
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

test('completed checks without legacy commit statuses still require trusted policy checks', async () => {
  const f = fixture(); readablePolicy(f); f.setStatuses([]);
  await f.start(); f.finish();
  [...f.agents.values()][0].run.git.branches = [{prUrl: `https://github.com/${REPO}/pull/999`}];
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  const state = await f.bridge.state(f.issueId());
  assert.equal(state.ciEval.verdict, 'missing');
  assert.match(state.ci[0], /missing required/);
  assert.match(state.ci[0], /buildkite\/infogenie/);
  assert.doesNotMatch(state.ci[0], /CI passed/);
});

test('finished run without prUrl adopts the existing PR for that exact branch', async () => {
  const f = fixture(); const branch = 'cursor/task-a';
  f.pulls.set(42, {
    number: 42, state: 'closed', draft: false, merged: true, merged_at: '2026-09-01T00:00:00Z',
    head: { sha: 'b'.repeat(40), ref: branch, repo: { full_name: REPO } },
    base: { ref: 'main', repo: { full_name: REPO } },
  });
  await f.start(); f.finish();
  [...f.agents.values()][0].run.git.branches = [{ branch }];
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  const state = await f.bridge.state(f.issueId());
  assert.equal(state.branch, branch);
  assert.equal(state.pr.number, 42);
  assert.equal(state.pr.state, 'merged');
  assert.equal(state.pr.merged, true);
  assert.equal(state.sha, 'b'.repeat(40));
  assert.equal(f.prPosts(), 0);
});

test('a PR from a different branch is never adopted', async () => {
  const f = fixture();
  f.pulls.set(7, {
    number: 7, state: 'open', draft: true, merged: false,
    head: { sha: 'e'.repeat(40), ref: 'cursor/other', repo: { full_name: REPO } },
    base: { ref: 'main', repo: { full_name: REPO } },
  });
  await f.start(); f.finish();
  [...f.agents.values()][0].run.git.branches = [{ branch: 'cursor/task-a' }];
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  const state = await f.bridge.state(f.issueId());
  assert.notEqual(state.pr?.number, 7);
  assert.match(state.prBlocker || '', /not on GitHub/);
  assert.equal(f.prPosts(), 0);
});

test('draft PR creation persists intent and reconciles after an uncertain response', async () => {
  const f = fixture(); const branch = 'cursor/task-b';
  f.branches.set(branch, { name: branch, commit: { sha: 'c'.repeat(40) } });
  await f.start(); f.finish();
  [...f.agents.values()][0].run.git.branches = [{ branch }];
  f.losePrCreate();
  await assert.rejects(f.bridge.refresh(await f.bridge.state(f.issueId())), /network/);
  assert.equal((await f.bridge.state(f.issueId())).prIntent.status, 'uncertain');
  assert.equal(f.prPosts(), 1);
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  const state = await f.bridge.state(f.issueId());
  assert.equal(f.prPosts(), 1);
  assert.equal(state.prIntent.status, 'created');
  assert.ok(state.pr.number);
  assert.equal(state.sha, 'c'.repeat(40));
  assert.equal(state.pr.draft, true);
  assert.ok(!f.calls.some((c) => c[1] === 'PUT' && /\/merge$/.test(c[2] || '')));
  assert.ok(!f.calls.some((c) => c[1] === 'PATCH' && c[3]?.draft === false));
});

test('GitHub 403 while opening a draft PR is a stored blocker and is not retried', async () => {
  const f = fixture(); const branch = 'cursor/task-c';
  f.branches.set(branch, { name: branch, commit: { sha: 'f'.repeat(40) } });
  f.rejectPrCreate(403);
  await f.start(); f.finish();
  [...f.agents.values()][0].run.git.branches = [{ branch }];
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  const state = await f.bridge.state(f.issueId());
  assert.equal(state.prIntent.status, 'blocked');
  assert.match(state.prBlocker, /Allow GitHub Actions/);
  assert.equal(f.prPosts(), 1);
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  assert.equal(f.prPosts(), 1);
});

test('completion notifications are deduplicated across retries', async () => {
  const f = fixture(); await f.start(); f.finish();
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  assert.equal(f.notices().length, 1);
  assert.match(f.notices()[0].body, /does not wake a ChatGPT conversation/);
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  assert.equal(f.notices().length, 1);
  const branch = 'cursor/task-d';
  f.pulls.set(55, {
    number: 55, state: 'open', draft: true, merged: false,
    head: { sha: '1'.repeat(40), ref: branch, repo: { full_name: REPO } },
    base: { ref: 'main', repo: { full_name: REPO } },
  });
  [...f.agents.values()][0].run.git.branches = [{ branch }];
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  assert.equal(f.notices().length, 2);
  assert.match(f.notices()[1].body, /pull\/55/);
  assert.match(f.notices()[1].body, new RegExp('1'.repeat(40)));
});

test('monitor isolates per-task failures including invalid signatures', async () => {
  const f = fixture();
  seedTask(f, { issue: 21, agentId: 'bc-fail1', failGet: true });
  seedTask(f, { issue: 22, agentId: 'bc-ok22', phase: 'RUNNING' });
  seedTask(f, { issue: 23, agentId: 'bc-bad23' });
  f.comments.get(23)[0].body = f.comments.get(23)[0].body.replace(/[a-f0-9]{64} -->/, `${'b'.repeat(64)} -->`);
  const result = await f.bridge.run('schedule', f.event({}));
  assert.match(result, /Task #21: Cursor request failed \(500\)/);
  assert.match(result, /Task #22: RUNNING/);
  assert.match(result, /Task #23: Automation state signature mismatch/);
  assert.equal((await f.bridge.state(22)).lastRunId, 'run-seed-22');
});

test('monitor ignores untrusted comments and reconciles a coalesced authorised follow-up', async () => {
  const f = fixture(); await f.start(); f.finish();
  const issue = f.issueId();
  f.comments.get(issue).push({ id: 500, body: '/cursor cancel', user: { login: 'outsider' } });
  const before = f.cancelPosts().length;
  await f.bridge.run('schedule', f.event({}));
  assert.equal(f.cancelPosts().length, before);
  f.comments.get(issue).push({
    id: 501, body: '/cursor follow-up\nFix the bounded issue.', user: { login: 'paulventer01' },
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  });
  await f.bridge.run('schedule', f.event({}));
  assert.equal((await f.bridge.state(issue)).runId, 'run-2');
  assert.ok((await f.bridge.state(issue)).handled.includes('comment:501'));
});

function workflowOnBlock(text) {
  const start = text.search(/^on:\s*$/m);
  if (start < 0) throw new Error('missing on:');
  const rest = text.slice(start);
  const end = rest.search(/\n(?:permissions:|concurrency:|jobs:)/);
  return end < 0 ? rest : rest.slice(0, end);
}

function assertTrustedAutomationWorkflow(text) {
  if (!text.includes('CURSOR_API_KEY')) throw new Error('expected CURSOR_API_KEY');
  const events = [...workflowOnBlock(text).matchAll(/^  ([A-Za-z_]+):/gm)].map((m) => m[1]);
  if (events.includes('pull_request') || events.includes('pull_request_target')) {
    throw new Error('PR-controlled workflow definition is not allowed for CURSOR_API_KEY jobs');
  }
  if (/\bpull_request_target\b/.test(workflowOnBlock(text).split('\n').filter((l) => !l.trim().startsWith('#')).join('\n'))) {
    throw new Error('pull_request_target is not allowed');
  }
  if (!events.includes('schedule') || !events.includes('check_suite') || !events.includes('status')) {
    throw new Error('expected default-branch CI wakeup events');
  }
  if (!/ref:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/.test(text)) {
    throw new Error('must check out the default branch');
  }
  if (!/persist-credentials:\s*false/.test(text)) throw new Error('must disable persisted git credentials');
  if (/github\.event\.pull_request\.head/.test(text)) throw new Error('must not checkout PR head with automation secrets');
}

test('status and cancel persist handled on event delivery and missed-event replay', async () => {
  const f = fixture(); await f.start();
  const issue = f.issueId();
  await f.bridge.run('issue_comment', {
    repository: { full_name: REPO }, sender: { login: 'paulventer01' }, action: 'created',
    issue: { number: issue }, comment: { id: 77, body: '/cursor status' },
  });
  assert.ok((await f.bridge.state(issue)).handled.includes('comment:77'));
  const afterStatus = f.runGets();
  f.comments.get(issue).push({
    id: 77, body: '/cursor status', user: { login: 'paulventer01' },
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  });
  await f.bridge.run('schedule', f.event({}));
  await f.bridge.run('schedule', f.event({}));
  assert.equal(f.runGets(), afterStatus + 2);
  await f.bridge.run('issue_comment', {
    repository: { full_name: REPO }, sender: { login: 'paulventer01' }, action: 'created',
    issue: { number: issue }, comment: { id: 78, body: '/cursor cancel' },
  });
  assert.ok((await f.bridge.state(issue)).handled.includes('comment:78'));
  assert.deepEqual([...f.agents.values()][0].cancelled, ['run-1']);
  const cancels = f.cancelPosts().length;
  f.comments.get(issue).push({
    id: 78, body: '/cursor cancel', user: { login: 'paulventer01' },
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  });
  await f.bridge.run('schedule', f.event({}));
  await f.bridge.run('schedule', f.event({}));
  assert.equal(f.cancelPosts().length, cancels);
});

test('historic cancel of run A is not retargeted after follow-up B', async () => {
  const f = fixture(); await f.start();
  const issue = f.issueId();
  f.comments.get(issue).push({
    id: 80, body: '/cursor cancel', user: { login: 'paulventer01' },
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  });
  await f.bridge.run('schedule', f.event({}));
  assert.equal((await f.bridge.state(issue)).phase, 'CANCELLED');
  assert.equal((await f.bridge.state(issue)).cancelIntent.runId, 'run-1');
  f.finish();
  f.comments.get(issue).push({
    id: 81, body: '/cursor follow-up\nContinue the bounded task.', user: { login: 'paulventer01' },
    created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
  });
  await f.bridge.run('schedule', f.event({}));
  assert.equal((await f.bridge.state(issue)).runId, 'run-2');
  assert.deepEqual([...f.agents.values()][0].cancelled, ['run-1']);
  await f.bridge.run('schedule', f.event({}));
  assert.deepEqual([...f.agents.values()][0].cancelled, ['run-1']);
  assert.equal((await f.bridge.state(issue)).phase, 'CREATING');
});

test('uncertain cancel is bound to the accepted run and never retried against a later run', async () => {
  const f = fixture(); await f.start();
  const issue = f.issueId();
  f.loseCancel();
  await assert.rejects(f.bridge.cancel(await f.bridge.state(issue), { key: 'comment:90' }), /network/);
  const state = await f.bridge.state(issue);
  assert.equal(state.cancelIntent.status, 'uncertain');
  assert.equal(state.cancelIntent.runId, 'run-1');
  assert.ok(state.handled.includes('comment:90'));
  assert.equal(f.cancelPosts().length, 1);
  [...f.agents.values()][0].run.status = 'FINISHED';
  [...f.agents.values()][0].status = 'IDLE';
  await f.bridge.followup(await f.bridge.state(issue), { text: 'Continue', key: 'comment:91' });
  assert.equal((await f.bridge.state(issue)).runId, 'run-2');
  f.comments.get(issue).push({
    id: 90, body: '/cursor cancel', user: { login: 'paulventer01' },
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  });
  await f.bridge.run('schedule', f.event({}));
  assert.deepEqual([...f.agents.values()][0].cancelled || [], []);
  assert.equal((await f.bridge.state(issue)).runId, 'run-2');
  assert.equal(f.cancelPosts().length, 1);
});

test('edited historic command text is not executed as a new authorised command', async () => {
  const f = fixture(); await f.start(); f.finish();
  const issue = f.issueId();
  f.comments.get(issue).push({
    id: 95, body: '/cursor follow-up\nHacked instruction.', user: { login: 'paulventer01' },
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
  });
  await f.bridge.run('schedule', f.event({}));
  assert.equal((await f.bridge.state(issue)).runId, 'run-1');
  assert.equal(f.calls.filter((c) => c[0] === 'cursor' && c[1] === 'POST' && /\/runs$/.test(c[2] || '')).length, 0);
});

test('secret-bearing workflow definition stays on default-branch events', () => {
  const live = fs.readFileSync(path.join(__dirname, '../.github/workflows/cursor-automation.yml'), 'utf8');
  assertTrustedAutomationWorkflow(live);
  const malicious = live.replace(/^on:\n/m, 'on:\n  pull_request:\n    types: [opened]\n');
  assert.throws(() => assertTrustedAutomationWorkflow(malicious), /PR-controlled workflow definition/);
  const target = live.replace(/^on:\n/m, 'on:\n  pull_request_target:\n    types: [opened]\n');
  assert.throws(() => assertTrustedAutomationWorkflow(target), /PR-controlled|pull_request_target/);
});

test('status key is persisted in steady state and kept if refresh later fails', async () => {
  const f = fixture(); await f.start();
  const issue = f.issueId();
  await f.bridge.refresh(await f.bridge.state(issue));
  await f.bridge.status(await f.bridge.state(issue), { key: 'comment:88' });
  assert.ok((await f.bridge.state(issue)).handled.includes('comment:88'));
  f.comments.get(issue).push({
    id: 88, body: '/cursor status', user: { login: 'paulventer01' },
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  });
  const gets = f.runGets();
  await f.bridge.run('schedule', f.event({}));
  await f.bridge.run('schedule', f.event({}));
  assert.equal(f.runGets(), gets + 2);
  [...f.agents.values()][0].failGet = true;
  await assert.rejects(f.bridge.status(await f.bridge.state(issue), { key: 'comment:89' }), /500/);
  assert.ok((await f.bridge.state(issue)).handled.includes('comment:89'));
});

const CORRECTION_START = 'ci-correction: authorized\nci-correction-window: 24h\nFix the bounded CI failure.';
const { parseCiCorrectionAuth, latestChecks, liveRequiredFromProtection, liveRequiredFromRules } = require('../scripts/cursor-automation/ci');

function readablePolicy(f) {
  f.setProtection(0, { checks: [{ context: 'buildkite/infogenie' }] });
}

function checkRow(over = {}) {
  return {
    id: over.id || 1, name: over.name || 'fixture-check',
    status: over.status || 'completed',
    conclusion: over.conclusion === undefined ? 'success' : over.conclusion,
    started_at: over.started_at || '2026-01-01T00:00:00Z',
    completed_at: over.completed_at || '2026-01-01T00:01:00Z',
    html_url: over.html_url || `https://github.com/${REPO}/runs/${over.id || 1}`,
    app: over.app || { id: 15368, slug: 'github-actions' },
  };
}

function attachPr(f, { number = 42, branch = 'cursor/task-ci', sha = 'b'.repeat(40), state = 'open', merged = false, base = 'main' } = {}) {
  f.pulls.set(number, {
    number, state, draft: true, merged, merged_at: merged ? '2026-09-01T00:00:00Z' : null,
    head: { sha, ref: branch, repo: { full_name: REPO } },
    base: { ref: base, repo: { full_name: REPO } },
  });
  return { number, branch, sha, base };
}

async function finishBoundPr(f, prOpts = {}) {
  const pr = attachPr(f, prOpts);
  f.finish();
  [...f.agents.values()][0].run.git.branches = [{ branch: pr.branch, prUrl: `https://github.com/${REPO}/pull/${pr.number}` }];
  await f.bridge.refresh(await f.bridge.state(f.issueId()), { allowCorrection: true });
  return pr;
}

test('paginated checks include a failure on a later page and do not treat truncation as green', async () => {
  const f = fixture(); readablePolicy(f);
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push(checkRow({ id: i + 1, name: `ok-${i}` }));
  rows.push(checkRow({ id: 101, name: 'later-fail', conclusion: 'failure' }));
  f.setChecks(rows);
  await f.start();
  await finishBoundPr(f);
  const state = await f.bridge.state(f.issueId());
  assert.equal(state.ciEval.verdict, 'failed');
  assert.ok(state.ciEval.failures.some((row) => row.name === 'later-fail'));
  assert.ok(f.calls.some((c) => c[0] === 'github' && /check-runs\?per_page=100&page=2/.test(c[2])));
  const big = [];
  for (let i = 0; i < 2000; i++) big.push(checkRow({ id: i + 1, name: `bulk-${i}` }));
  f.setChecks(big);
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  const truncated = await f.bridge.state(f.issueId());
  assert.equal(truncated.ciEval.verdict, 'incomplete');
  assert.equal(truncated.ciEval.truncated, true);
  assert.doesNotMatch(truncated.ci[0], /CI passed/);
});

test('paginated commit statuses include a later-page failure', async () => {
  const f = fixture(); readablePolicy(f);
  const rows = [];
  for (let i = 0; i < 100; i++) {
    rows.push({
      id: i + 1, context: `ctx-${i}`, state: 'success', updated_at: '2026-01-01T00:00:00Z',
      target_url: 'https://buildkite.com/paulventer01/infogenie/builds/1',
    });
  }
  rows.push({
    id: 101, context: 'buildkite/infogenie', state: 'failure', updated_at: '2026-01-02T00:00:00Z',
    target_url: 'https://buildkite.com/paulventer01/infogenie/builds/9',
  });
  f.setStatuses(rows);
  await f.start();
  await finishBoundPr(f);
  const state = await f.bridge.state(f.issueId());
  assert.equal(state.ciEval.verdict, 'failed');
  assert.ok(f.calls.some((c) => c[0] === 'github' && /statuses\?per_page=100&page=2/.test(c[2])));
});

test('missing, skipped, and unknown required checks are never green', async () => {
  const f = fixture();
  f.setProtection(0, { checks: [{ context: 'required-qa', app_id: 15368 }] });
  await f.start();
  await finishBoundPr(f);
  assert.equal((await f.bridge.state(f.issueId())).ciEval.verdict, 'missing');
  f.setChecks([checkRow({ name: 'required-qa', conclusion: 'skipped' })]);
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  assert.equal((await f.bridge.state(f.issueId())).ciEval.verdict, 'neutral');
  f.setChecks([checkRow({ name: 'required-qa', conclusion: 'potato' })]);
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  assert.equal((await f.bridge.state(f.issueId())).ciEval.verdict, 'unknown');
  assert.doesNotMatch((await f.bridge.state(f.issueId())).ci[0], /CI passed/);
});

test('reruns keep the latest check attempt', async () => {
  const f = fixture(); readablePolicy(f);
  f.setChecks([
    checkRow({ id: 1, name: 'bridge-tests', conclusion: 'failure', started_at: '2026-01-01T00:00:00Z' }),
    checkRow({ id: 2, name: 'bridge-tests', conclusion: 'success', started_at: '2026-01-01T02:00:00Z' }),
  ]);
  await f.start();
  await finishBoundPr(f);
  const state = await f.bridge.state(f.issueId());
  assert.equal(state.ciEval.verdict, 'passed');
  assert.match(state.ci[0], /independent review still required/);
  assert.match(state.ci[0], /not READY_FOR_HUMAN_MERGE/);
  assert.equal(state.ciPhase, 'ci-passed-awaiting-independent-review');
  assert.equal(state.phase, 'FINISHED');
});

test('PR head movement during evaluation invalidates evidence', async () => {
  const f = fixture();
  await f.start();
  attachPr(f, { number: 77, branch: 'cursor/move', sha: '1'.repeat(40) });
  f.finish();
  [...f.agents.values()][0].run.git.branches = [{ branch: 'cursor/move', prUrl: `https://github.com/${REPO}/pull/77` }];
  let pullGets = 0;
  const inner = f.bridge.github;
  f.bridge.github = async (method, path, body) => {
    if (method === 'GET' && path === `${ROOT}/pulls/77`) {
      pullGets += 1;
      if (pullGets >= 3) f.pulls.get(77).head.sha = '2'.repeat(40);
    }
    return inner(method, path, body);
  };
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  const state = await f.bridge.state(f.issueId());
  assert.equal(state.ciEval.verdict, 'stale');
  assert.match(state.ci[0], /head moved/);
  assert.equal(f.runPosts().length, 0);
});

test('old tasks without opt-in stay manual when CI fails', async () => {
  const f = fixture(); readablePolicy(f);
  f.setChecks([checkRow({ name: 'bridge-tests', conclusion: 'failure' })]);
  await f.start();
  await finishBoundPr(f);
  const state = await f.bridge.state(f.issueId());
  assert.equal(state.ciEval.verdict, 'failed');
  assert.equal(state.ciCorrectionAuth?.enabled, false);
  assert.equal(f.runPosts().length, 0);
});

test('authorized CI correction persists intent before POST and does not replay duplicates', async () => {
  const f = fixture(); readablePolicy(f);
  f.setChecks([checkRow({
    name: 'bridge-tests', conclusion: 'failure',
    html_url: 'https://github.com/paulventer01/infogenie/runs/9',
  })]);
  await f.start(CORRECTION_START);
  await finishBoundPr(f);
  const state = await f.bridge.state(f.issueId());
  assert.equal(state.ciCorrectionAuth.enabled, true);
  assert.equal(state.ciCorrectionIntent.status, 'accepted');
  assert.equal(state.followups, 1);
  assert.equal(f.runPosts().length, 1);
  const postIdx = f.calls.findIndex((c) => c[0] === 'cursor' && c[1] === 'POST' && /\/runs$/.test(c[2]));
  const intentIdx = f.calls.findIndex((c) => c[0] === 'github' && c[1] === 'PATCH' && String(c[3]?.body || '').includes('correction intent'));
  assert.ok(intentIdx >= 0 && intentIdx < postIdx);
  const promptText = f.runPosts()[0][3].prompt.text;
  assert.match(promptText, /untrusted CI evidence/);
  assert.doesNotMatch(promptText, /CURSOR_API_KEY|BEGIN [A-Z]+ PRIVATE KEY/i);
  await f.bridge.run('schedule', f.event({}));
  await f.bridge.run('check_suite', { repository: { full_name: REPO } });
  assert.equal(f.runPosts().length, 1);
  assert.doesNotMatch(promptText, /READY_FOR_HUMAN_MERGE/);
  assert.ok(!f.calls.some((c) => c[1] === 'PUT' && /\/merge$/.test(c[2] || '')));
});

test('lost automatic correction response is reconciled and never blindly retried', async () => {
  const f = fixture(); readablePolicy(f);
  f.setChecks([checkRow({ name: 'bridge-tests', conclusion: 'failure' })]);
  await f.start(CORRECTION_START); f.loseFollowup();
  await assert.rejects(finishBoundPr(f), /network/);
  const state = await f.bridge.state(f.issueId());
  assert.equal(state.phase, 'FOLLOWUP_PENDING');
  assert.equal(state.ciCorrectionIntent.status, 'uncertain');
  assert.equal(f.runPosts().length, 1);
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  assert.equal((await f.bridge.state(f.issueId())).runId, 'run-2');
  assert.equal((await f.bridge.state(f.issueId())).ciCorrectionIntent.status, 'accepted');
  f.finish();
  await f.bridge.refresh(await f.bridge.state(f.issueId()), { allowCorrection: true });
  assert.notEqual((await f.bridge.state(f.issueId())).ciPhase, 'correction-running');
  assert.equal(f.runPosts().length, 1);
});

test('correction budget is shared with manual follow-ups and respects the deadline', async () => {
  const f = fixture(); readablePolicy(f);
  f.setChecks([checkRow({ name: 'bridge-tests', conclusion: 'failure' })]);
  await f.start(CORRECTION_START);
  const issue = f.issueId();
  f.finish();
  await f.bridge.followup(await f.bridge.state(issue), { text: 'Manual one', key: 'comment:m1' });
  f.finish();
  await f.bridge.followup(await f.bridge.state(issue), { text: 'Manual two', key: 'comment:m2' });
  f.finish();
  attachPr(f, { number: 88, branch: 'cursor/budget' });
  [...f.agents.values()][0].run.git.branches = [{ branch: 'cursor/budget', prUrl: `https://github.com/${REPO}/pull/88` }];
  await f.bridge.refresh(await f.bridge.state(issue), { allowCorrection: true });
  assert.equal((await f.bridge.state(issue)).followups, 3);
  assert.equal(f.runPosts().length, 3);
  f.finish();
  await f.bridge.refresh(await f.bridge.state(issue), { allowCorrection: true });
  assert.equal(f.runPosts().length, 3);
  await assert.rejects(f.bridge.followup(await f.bridge.state(issue), { text: 'Manual four', key: 'comment:m4' }), /limit/);
  assert.equal((await f.bridge.state(issue)).ciPhase, 'exhausted');

  const late = fixture(); readablePolicy(late);
  late.setChecks([checkRow({ name: 'bridge-tests', conclusion: 'failure' })]);
  const origin = Date.now();
  late.bridge.now = () => origin;
  await late.start(CORRECTION_START);
  late.bridge.now = () => origin + 25 * 3_600_000;
  await finishBoundPr(late, { number: 89, branch: 'cursor/late' });
  assert.equal(late.runPosts().length, 0);
  assert.equal((await late.bridge.state(late.issueId())).ciPhase, 'exhausted');
});

test('cancellation, closed, and merged PRs do not start automatic CI correction', async () => {
  const f = fixture(); readablePolicy(f);
  f.setChecks([checkRow({ name: 'bridge-tests', conclusion: 'failure' })]);
  await f.start(CORRECTION_START);
  await f.bridge.cancel(await f.bridge.state(f.issueId()));
  attachPr(f, { number: 90, branch: 'cursor/cancel' });
  [...f.agents.values()][0].run.git.branches = [{ branch: 'cursor/cancel', prUrl: `https://github.com/${REPO}/pull/90` }];
  await f.bridge.refresh(await f.bridge.state(f.issueId()));
  assert.equal((await f.bridge.state(f.issueId())).phase, 'CANCELLED');
  assert.equal(f.runPosts().length, 0);

  const closed = fixture(); readablePolicy(closed);
  closed.setChecks([checkRow({ name: 'bridge-tests', conclusion: 'failure' })]);
  await closed.start(CORRECTION_START);
  await finishBoundPr(closed, { number: 91, branch: 'cursor/closed', state: 'closed' });
  assert.equal(closed.runPosts().length, 0);

  const merged = fixture(); readablePolicy(merged);
  merged.setChecks([checkRow({ name: 'bridge-tests', conclusion: 'failure' })]);
  await merged.start(CORRECTION_START);
  await finishBoundPr(merged, { number: 92, branch: 'cursor/merged', merged: true, state: 'closed' });
  assert.equal(merged.runPosts().length, 0);
});

test('other active Cursor work blocks automatic CI correction without a POST', async () => {
  const f = fixture(); readablePolicy(f);
  f.setChecks([checkRow({ name: 'bridge-tests', conclusion: 'failure' })]);
  await f.start(CORRECTION_START);
  const pr = attachPr(f, { number: 94, branch: 'cursor/other' });
  f.finish();
  f.agents.set('bc-other', {
    id: 'bc-other', repos: [{ url: REPO_URL, startingRef: 'main' }], workOnCurrentBranch: false,
    status: 'ACTIVE', latestRunId: 'run-other', run: { id: 'run-other', status: 'RUNNING', git: { branches: [] } },
  });
  [...f.agents.values()][0].run.git.branches = [{ branch: pr.branch, prUrl: `https://github.com/${REPO}/pull/${pr.number}` }];
  await f.bridge.refresh(await f.bridge.state(f.issueId()), { allowCorrection: true });
  assert.equal(f.runPosts().length, 0);
  assert.match((await f.bridge.state(f.issueId())).ciBlocker || '', /active/);
});

test('GitHub check-run API failure is a blocker rather than green or a correction spin', async () => {
  const f = fixture();
  await f.start(CORRECTION_START);
  attachPr(f, { number: 93, branch: 'cursor/api' });
  f.finish();
  [...f.agents.values()][0].run.git.branches = [{ branch: 'cursor/api', prUrl: `https://github.com/${REPO}/pull/93` }];
  const inner = f.bridge.github;
  f.bridge.github = async (method, path, body) => {
    if (/\/check-runs/.test(path)) throw new ApiError('GitHub', 500);
    return inner(method, path, body);
  };
  await assert.rejects(f.bridge.refresh(await f.bridge.state(f.issueId()), { allowCorrection: true }), /500/);
  assert.equal(f.runPosts().length, 0);
  const blocked = await f.bridge.state(f.issueId());
  assert.equal(blocked.ciEval.verdict, 'blocked');
  assert.match(blocked.ci[0], /invalidated|blocked/i);
  assert.equal(blocked.ciPhase, 'blocked');
});

test('unreadable policy with a successful floor cannot pass when other required checks are undiscovered', async () => {
  const f = fixture();
  f.setRules([], 403);
  f.setChecks([checkRow({ name: 'Secret scan', conclusion: 'success' })]);
  await f.start();
  await finishBoundPr(f);
  const state = await f.bridge.state(f.issueId());
  assert.equal(state.ciEval.verdict, 'blocked');
  assert.equal(state.ciEval.policyComplete, false);
  assert.equal(state.ciEval.policySources.protection, 'forbidden');
  assert.doesNotMatch(state.ci[0], /CI passed/);
  assert.equal(state.ciPhase, 'blocked');
});

test('malformed required-check policy is blocked', async () => {
  const f = fixture();
  f.setProtection(0, { checks: 'not-a-list' });
  await f.start();
  await finishBoundPr(f);
  const state = await f.bridge.state(f.issueId());
  assert.equal(state.ciEval.verdict, 'blocked');
  assert.equal(state.ciEval.policySources.protection, 'malformed');
  assert.doesNotMatch(state.ci[0], /CI passed/);
});

test('API failure after a passed evaluation invalidates persisted green evidence', async () => {
  const f = fixture(); readablePolicy(f);
  await f.start();
  await finishBoundPr(f, { number: 95, branch: 'cursor/green-then-fail' });
  assert.equal((await f.bridge.state(f.issueId())).ciEval.verdict, 'passed');
  const inner = f.bridge.github;
  f.bridge.github = async (method, path, body) => {
    if (/check-runs\?per_page=100&page=2/.test(path)) throw new ApiError('GitHub', 502);
    return inner(method, path, body);
  };
  const rows = [];
  for (let i = 0; i < 101; i++) rows.push(checkRow({ id: i + 1, name: `ok-${i}` }));
  f.setChecks(rows);
  await assert.rejects(f.bridge.refresh(await f.bridge.state(f.issueId())), /502/);
  const state = await f.bridge.state(f.issueId());
  assert.equal(state.ciEval.verdict, 'blocked');
  assert.match(state.ci[0], /invalidated|blocked/i);
  assert.notEqual(state.ciEval.verdict, 'passed');
});

test('definite automatic correction rejections are terminal and never replayed', async () => {
  async function assertOnePost(status) {
    const f = fixture(); readablePolicy(f);
    f.setChecks([checkRow({ name: 'bridge-tests', conclusion: 'failure' })]);
    f.rejectFollowup(status);
    await f.start(CORRECTION_START);
    await finishBoundPr(f, { number: 100 + status, branch: `cursor/rej-${status}` });
    assert.equal(f.runPosts().length, 1);
    assert.equal((await f.bridge.state(f.issueId())).ciCorrectionIntent.status, 'rejected');
    f.setChecks([checkRow({ name: 'other-job', conclusion: 'failure' })]);
    await f.bridge.run('schedule', f.event({}));
    await f.bridge.run('check_suite', { repository: { full_name: REPO } });
    await f.bridge.refresh(await f.bridge.state(f.issueId()), { allowCorrection: true });
    assert.equal(f.runPosts().length, 1);
  }
  await assertOnePost(403);
  await assertOnePost(429);
});

test('cancel of a finished opted-in failure does not launch a correction', async () => {
  const f = fixture(); readablePolicy(f);
  f.setChecks([checkRow({ name: 'bridge-tests', conclusion: 'failure' })]);
  await f.start(CORRECTION_START);
  const pr = attachPr(f, { number: 110, branch: 'cursor/fin-cancel' });
  f.finish();
  [...f.agents.values()][0].run.git.branches = [{ branch: pr.branch, prUrl: `https://github.com/${REPO}/pull/${pr.number}` }];
  await f.bridge.cancel(await f.bridge.state(f.issueId()));
  assert.equal(f.runPosts().length, 0);
  await f.bridge.run('schedule', f.event({}));
  assert.equal(f.runPosts().length, 0);
  assert.equal((await f.bridge.state(f.issueId())).suppressAutoCorrect, true);
});

test('missed cancel is consumed before automatic correction', async () => {
  const f = fixture(); readablePolicy(f);
  f.setChecks([checkRow({ name: 'bridge-tests', conclusion: 'failure' })]);
  await f.start(CORRECTION_START);
  const pr = attachPr(f, { number: 111, branch: 'cursor/missed-cancel' });
  f.finish();
  [...f.agents.values()][0].run.git.branches = [{ branch: pr.branch, prUrl: `https://github.com/${REPO}/pull/${pr.number}` }];
  const issue = f.issueId();
  f.comments.get(issue).push({
    id: 801, body: '/cursor cancel', user: { login: 'paulventer01' },
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  });
  await f.bridge.run('schedule', f.event({}));
  assert.equal(f.runPosts().length, 0);
});

test('manual follow-up takes precedence over automatic correction', async () => {
  const f = fixture(); readablePolicy(f);
  f.setChecks([checkRow({ name: 'bridge-tests', conclusion: 'failure' })]);
  await f.start(CORRECTION_START);
  const pr = attachPr(f, { number: 112, branch: 'cursor/manual-first' });
  f.finish();
  [...f.agents.values()][0].run.git.branches = [{ branch: pr.branch, prUrl: `https://github.com/${REPO}/pull/${pr.number}` }];
  const issue = f.issueId();
  f.comments.get(issue).push({
    id: 802, body: '/cursor follow-up\nFix the bounded issue.', user: { login: 'paulventer01' },
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  });
  await f.bridge.run('schedule', f.event({}));
  assert.equal(f.runPosts().length, 1);
  assert.match(f.runPosts()[0][3].prompt.text, /Fix the bounded issue/);
});

test('status observes without launching automatic correction', async () => {
  const f = fixture(); readablePolicy(f);
  f.setChecks([checkRow({ name: 'bridge-tests', conclusion: 'failure' })]);
  await f.start(CORRECTION_START);
  const pr = attachPr(f, { number: 113, branch: 'cursor/status-obs' });
  f.finish();
  [...f.agents.values()][0].run.git.branches = [{ branch: pr.branch, prUrl: `https://github.com/${REPO}/pull/${pr.number}` }];
  await f.bridge.status(await f.bridge.state(f.issueId()), { key: 'comment:status-obs' });
  assert.equal(f.runPosts().length, 0);
  assert.equal((await f.bridge.state(f.issueId())).ciEval.verdict, 'failed');
});

test('correction opt-in requires consecutive leading headers and ignores quoted examples', async () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(parseCiCorrectionAuth('ci-correction: authorized\nci-correction-window: 1h\nDo the task.', now).enabled, true);
  assert.equal(parseCiCorrectionAuth('ci-correction: authorized\nci-correction-window: 1h\nDo the task.', now).hours, 1);
  assert.equal(parseCiCorrectionAuth('ci-correction: authorized\nci-correction-window: 72h\nDo the task.', now).hours, 72);
  assert.equal(parseCiCorrectionAuth('Please implement.\nci-correction: authorized\nci-correction-window: 24h', now).enabled, false);
  assert.equal(parseCiCorrectionAuth('```\nci-correction: authorized\nci-correction-window: 24h\n```\nTask', now).enabled, false);
  assert.equal(parseCiCorrectionAuth('ci-correction: authorized\nci-correction-window: 24h\nci-correction-window: 12h\nTask', now).enabled, false);
  assert.equal(parseCiCorrectionAuth('ci-correction-window: 24h\nci-correction: authorized\nTask', now).enabled, false);
  assert.equal(parseCiCorrectionAuth('ci-correction: authorized\nci-correction-window: 99h\nTask', now).enabled, false);
  assert.equal(parseCiCorrectionAuth('ci-correction: authorized\nDo the task.', now).enabled, false);
  const f = fixture();
  await f.start('See this example:\nci-correction: authorized\nci-correction-window: 24h\nReal task.');
  assert.equal((await f.bridge.state(f.issueId())).ciCorrectionAuth.enabled, false);
});

test('a newer pending check without started_at is not hidden by an older success', () => {
  const latest = latestChecks([
    checkRow({ id: 1, name: 'bridge-tests', conclusion: 'success', started_at: '2026-01-01T00:00:00Z' }),
    {
      id: 2, name: 'bridge-tests', status: 'in_progress', conclusion: null,
      started_at: undefined, completed_at: undefined, app: { id: 15368 },
    },
  ]);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].id, 2);
  assert.equal(latest[0].status, 'in_progress');
});

test('inner malformed protection and ruleset rows cannot pass via the floor', async () => {
  assert.throws(() => liveRequiredFromProtection({}), /malformed/);
  assert.throws(() => liveRequiredFromProtection({ checks: [{}] }), /malformed/);
  assert.throws(() => liveRequiredFromProtection({ checks: [{ context: 42 }] }), /malformed/);
  assert.throws(() => liveRequiredFromProtection({ checks: [{ context: 'ok', app_id: '1' }] }), /malformed/);
  assert.deepEqual(liveRequiredFromProtection({ checks: [], contexts: [] }), []);
  assert.throws(() => liveRequiredFromRules([{ type: 'required_status_checks' }]), /malformed/);
  assert.throws(() => liveRequiredFromRules([{ type: 'required_status_checks', parameters: {} }]), /malformed/);
  assert.throws(() => liveRequiredFromRules([{
    type: 'required_status_checks', parameters: { required_status_checks: [{ context: 42 }] },
  }]), /malformed/);
  assert.deepEqual(liveRequiredFromRules([{
    type: 'required_status_checks', parameters: { required_status_checks: [] },
  }]), []);

  const sha = 'b'.repeat(40);
  for (const body of [{}, { checks: [{}] }, { checks: [{ context: 42 }] }]) {
    const f = fixture();
    f.setProtection(0, body);
    const result = await f.bridge.evaluateSha(sha);
    assert.equal(result.verdict, 'blocked');
    assert.equal(result.policyComplete, false);
    assert.equal(result.policySources.protection, 'malformed');
    assert.doesNotMatch(result.summary, /CI passed/);
  }
  const rules = fixture();
  rules.setProtection(0, { checks: [], contexts: [] });
  rules.setRules([{ type: 'required_status_checks', parameters: { required_status_checks: [{}] } }]);
  const badRules = await rules.bridge.evaluateSha(sha);
  assert.equal(badRules.verdict, 'blocked');
  assert.equal(badRules.policySources.rules, 'malformed');
  const empty = fixture();
  empty.setProtection(0, { checks: [], contexts: [] });
  const ok = await empty.bridge.evaluateSha(sha);
  assert.equal(ok.verdict, 'passed');
  assert.equal(ok.policyComplete, true);
});

test('PRs targeting a non-default base cannot pass or auto-correct', async () => {
  const f = fixture(); readablePolicy(f);
  f.setChecks([checkRow({ name: 'required-release', conclusion: 'failure' })]);
  await f.start(CORRECTION_START);
  await finishBoundPr(f, { number: 120, branch: 'cursor/release-pr', base: 'release' });
  const state = await f.bridge.state(f.issueId());
  assert.equal(state.pr.base, 'release');
  assert.equal(state.ciEval.verdict, 'blocked');
  assert.match(state.ci[0], /non-default base/);
  assert.doesNotMatch(state.ci[0], /CI passed/);
  assert.equal(f.runPosts().length, 0);
});

test('PR base retarget during evaluation invalidates evidence and does not correct', async () => {
  const f = fixture(); readablePolicy(f);
  f.setChecks([checkRow({ name: 'bridge-tests', conclusion: 'failure' })]);
  await f.start(CORRECTION_START);
  attachPr(f, { number: 121, branch: 'cursor/retarget' });
  f.finish();
  [...f.agents.values()][0].run.git.branches = [{ branch: 'cursor/retarget', prUrl: `https://github.com/${REPO}/pull/121` }];
  let pullGets = 0;
  const inner = f.bridge.github;
  f.bridge.github = async (method, path, body) => {
    if (method === 'GET' && path === `${ROOT}/pulls/121`) {
      pullGets += 1;
      if (pullGets >= 3) f.pulls.get(121).base.ref = 'release';
    }
    return inner(method, path, body);
  };
  await f.bridge.refresh(await f.bridge.state(f.issueId()), { allowCorrection: true });
  const state = await f.bridge.state(f.issueId());
  assert.equal(state.ciEval.verdict, 'blocked');
  assert.match(state.ci[0], /base moved|non-default base/);
  assert.doesNotMatch(state.ci[0], /CI passed/);
  assert.equal(f.runPosts().length, 0);
});
