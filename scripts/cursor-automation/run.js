'use strict';

const fs = require('node:fs');
const { client } = require('./client');
const { Bridge } = require('./bridge');
const { policyClient } = require('./policy-client');

async function execute(eventName, event, env = process.env, fetchImpl = fetch) {
  const github = client('https://api.github.com', env.GITHUB_TOKEN, 'GitHub', fetchImpl);
  const policyOnly = eventName === 'workflow_dispatch' && event.inputs?.action === 'verify-policy';
  const cursor = policyOnly ? () => { throw new Error('Policy verification cannot contact Cursor.'); }
    : client('https://api.cursor.com', env.CURSOR_API_KEY, 'Cursor', fetchImpl);
  const bridge = new Bridge({
    github,
    policyGithub: policyClient(env.CURSOR_POLICY_READ_TOKEN, github, fetchImpl),
    // Read-only policy verification works even when Cursor billing/credentials are unavailable.
    cursor,
    secret: env.CURSOR_API_KEY,
    actors: env.CURSOR_AUTOMATION_ACTORS || 'paulventer01',
    enabled: env.CURSOR_AUTOMATION_ENABLED === 'true',
  });
  return bridge.run(eventName, event);
}

async function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  event._runId = process.env.GITHUB_RUN_ID; // stable across reruns; unlike run_attempt
  const result = await execute(process.env.GITHUB_EVENT_NAME, event);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result}\n`);
}

if (require.main === module) main().catch((error) => {
  // All own errors are bounded and do not include remote bodies or secrets.
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = { execute };
