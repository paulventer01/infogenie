'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const file=path.resolve(__dirname,'../../.preview-workspace/access.json');
// Credentials belong in the private editor, never stdout/stderr or CI logs.
try {
  const stat=fs.lstatSync(file);
  if (!stat.isFile() || (stat.mode&0o077)!==0 || stat.uid!==process.getuid()) {
    throw new Error('unsafe permissions');
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('Open .preview-workspace/access.json in your private Codespace editor. Credential access requires an interactive terminal.');
    process.exitCode=1;
  } else {
    const opened=spawnSync('code',['--reuse-window',file],{stdio:'ignore',shell:false});
    if (opened.status!==0) {
      console.error('Open .preview-workspace/access.json in your private Codespace editor (Ctrl+P).');
      process.exitCode=1;
    } else {
      console.log('Opened the private test-login file in the editor. Keep port 5000 private; close the file after signing in.');
    }
  }
} catch {
  console.error('Preview login file is missing or not private. Check workspace startup; credentials were not displayed.');
  process.exitCode=1;
}
