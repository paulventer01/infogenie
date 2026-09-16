'use strict';

const fs = require('node:fs');
const { client } = require('./client');
const { Bridge } = require('./bridge');

async function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  event._runId = process.env.GITHUB_RUN_ID; // stable across reruns; unlike run_attempt
  const bridge = new Bridge({
    github: client('https://api.github.com', process.env.GITHUB_TOKEN, 'GitHub'),
    cursor: client('https://api.cursor.com', process.env.CURSOR_API_KEY, 'Cursor'),
    secret: process.env.CURSOR_API_KEY,
    actors: process.env.CURSOR_AUTOMATION_ACTORS || 'paulventer01',
    enabled: process.env.CURSOR_AUTOMATION_ENABLED === 'true',
  });
  const result = await bridge.run(process.env.GITHUB_EVENT_NAME, event);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result}\n`);
}

main().catch((error) => {
  // All own errors are bounded and do not include remote bodies or secrets.
  console.error(error.message);
  process.exitCode = 1;
});
