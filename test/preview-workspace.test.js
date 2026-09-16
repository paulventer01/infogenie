'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {previewEnv}=require('../scripts/preview/start');
const {allowed}=require('../scripts/preview/network');
test('preview discards ambient production settings and retains real access controls',()=>{
  const env=previewEnv({PATH:'/bin',DATABASE_URL:'production',RESEND_API_KEY:'ambient',
    NODE_OPTIONS:'--require unsafe.js',PERMISSION_ENFORCEMENT:'off',INFOGENIE_JOBS:'1'},
  {session:'test-session',vault:'test-vault',api:'test-api'});
  assert.equal(env.PATH,'/bin'); assert.equal(env.RESEND_API_KEY,undefined);
  assert.equal(new URL(env.DATABASE_URL).hostname,'127.0.0.1');
  assert.equal(new URL(env.DATABASE_URL).pathname,'/infogenie_preview');
  assert.equal(env.INFOGENIE_JOBS,'0');
  for(const key of ['PERMISSION_ENFORCEMENT','MULTITENANT_ENFORCEMENT','SECURITY_CSRF']) assert.equal(env[key],'on');
  assert.ok(env.NODE_OPTIONS.endsWith('network.js"'));
});
test('preview network boundary rejects provider hosts, alternate ports and socket paths',()=>{
  for(const host of ['127.0.0.1','localhost','::1']) assert.equal(allowed(host,5432),true);
  for(const [host,port,path] of [['example.com',5000],['localhost.example.com',5000],
    ['127.0.0.1',443],['localhost',5432,'/var/run/postgresql']]) assert.equal(allowed(host,port,path),false);
});
test('preloaded boundary blocks actual fetch and net connect before connecting',()=>{
  const script=`const assert=require('node:assert/strict');
    assert.throws(()=>require('node:net').connect(443,'example.com'),/External connections/);
    fetch('https://example.com').then(()=>process.exit(1),e=>assert.match(e.message,/External connections/));`;
  const result=spawnSync(process.execPath,['-r',require.resolve('../scripts/preview/network'),'-e',script],
    {env:{...process.env,INFOGENIE_PREVIEW_WORKSPACE:'1'},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
test('preview access opens private credentials in the editor without logging them',t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'preview-access-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'scripts/preview'),{recursive:true});
  fs.mkdirSync(path.join(dir,'.preview-workspace'),{mode:0o700});
  fs.copyFileSync(require.resolve('../scripts/preview/access'),path.join(dir,'scripts/preview/access.js'));
  const file=path.join(dir,'.preview-workspace/access.json');
  const marker='synthetic-do-not-log';
  fs.writeFileSync(file,JSON.stringify({email:'reviewer@example.test',password:marker}),{mode:0o600});
  fs.writeFileSync(path.join(dir,'code'),`#!/bin/sh\nprintf '%s\\n' "$@" > '${dir}/editor-args'\nprintf 'editor output must not leak'\n`,{mode:0o700});
  const env={...process.env,PATH:dir+path.delimiter+process.env.PATH};
  const noninteractive=spawnSync(process.execPath,['scripts/preview/access.js'],{cwd:dir,env,encoding:'utf8'});
  assert.equal(noninteractive.status,1);
  assert.equal(fs.existsSync(path.join(dir,'editor-args')),false);
  assert.ok(!`${noninteractive.stdout}${noninteractive.stderr}`.includes(marker));
  const run=()=>spawnSync('script',['-q','-e','-c',`'${process.execPath}' scripts/preview/access.js`,'/dev/null'],{cwd:dir,env,encoding:'utf8'});
  const interactive=run();
  assert.equal(interactive.status,0,interactive.stderr);
  assert.match(interactive.stdout,/Opened the private test-login file/);
  assert.ok(!interactive.stdout.includes(marker));
  assert.ok(!interactive.stdout.includes('editor output must not leak'));
  assert.equal(fs.readFileSync(path.join(dir,'editor-args'),'utf8'),`--reuse-window\n${file}\n`);
  fs.unlinkSync(path.join(dir,'editor-args'));
  fs.chmodSync(file,0o644);
  assert.equal(run().status,1,'world-readable credentials rejected');
  assert.equal(fs.existsSync(path.join(dir,'editor-args')),false);
  fs.chmodSync(file,0o600);fs.renameSync(file,file+'.private');fs.symlinkSync(file+'.private',file);
  assert.equal(run().status,1,'symlink credentials rejected');
  assert.equal(fs.existsSync(path.join(dir,'editor-args')),false);
});
