'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const ROOT = path.resolve(__dirname,'../..');
const DIR = path.join(ROOT,'.preview-workspace');
const ACCESS = path.join(DIR,'access.json');
function atomicJson(file,value) {
  fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2),{mode:0o600});
  fs.renameSync(file+'.tmp',file);
}
const DATABASE = 'postgresql://preview:preview-container-only@127.0.0.1:5432/infogenie_preview';
function previewOrigin(source) {
  if (source.CODESPACES !== 'true') return 'http://localhost:5000';
  // Trust only platform-provided Codespaces identity, never request headers or ambient app URLs.
  const name = source.CODESPACE_NAME;
  if (typeof name !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,54}[a-z0-9])?$/.test(name)
      || source.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN !== 'app.github.dev') {
    throw new Error('Codespaces preview identity is missing or invalid. Reopen this Codespace.');
  }
  return `https://${name}-5000.app.github.dev`;
}
function previewEnv(source, keys) {
  const env = {};
  for (const key of ['PATH','HOME','TMPDIR','TMP','TEMP']) if (source[key]) env[key] = source[key];
  return {...env, PUBLIC_BASE_URL:previewOrigin(source), NODE_ENV:'development', DATABASE_URL:DATABASE,
    SESSION_SECRET:keys.session, CREDENTIAL_ENCRYPTION_KEY:keys.vault,
    INFOGENIE_API_KEY:keys.api, INFOGENIE_JOBS:'0', INFOGENIE_PREVIEW_WORKSPACE:'1',
    PERMISSION_ENFORCEMENT:'on', MULTITENANT_ENFORCEMENT:'on', SECURITY_CSRF:'on',
    NEXT_FRONT_DOOR:'1', EXPRESS_PROXY_TARGET:'http://127.0.0.1:8000',
    NEXT_TELEMETRY_DISABLED:'1', NEXT_TRACE_UPLOAD_DISABLED:'1',
    NODE_OPTIONS:`--require ${JSON.stringify(path.join(__dirname,'network.js'))}`};
}
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Preview refuses production mode.');
  for (const name of ['.env','.env.local','.env.development','.env.development.local']) {
    if (fs.existsSync(path.join(ROOT,name))) throw new Error('Preview requires a checkout without dotenv files.');
  }
  fs.mkdirSync(DIR,{recursive:true,mode:0o700});
  let lock;
  try { lock = fs.openSync(path.join(DIR,'running'),'wx',0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(fs.readFileSync(path.join(DIR,'running'),'utf8'));
    try { process.kill(pid,0); console.log('Preview already running. Open port 5000.'); return; }
    catch (check) { if (check.code !== 'ESRCH') throw check; }
    fs.unlinkSync(path.join(DIR,'running')); return main();
  }
  fs.writeFileSync(lock,String(process.pid)); fs.closeSync(lock);
  const children = []; let server;
  const shutdown = () => { for (const child of children) child.kill('SIGTERM'); server?.close();
    fs.rmSync(path.join(DIR,'running'),{force:true}); };
  process.on('exit',shutdown); process.on('SIGTERM',()=>process.exit(0)); process.on('SIGINT',()=>process.exit(0));
  const keys = fs.existsSync(path.join(DIR,'keys.json')) ? JSON.parse(fs.readFileSync(path.join(DIR,'keys.json'),'utf8'))
    : {session:crypto.randomBytes(32).toString('hex'),vault:crypto.randomBytes(32).toString('base64'),api:crypto.randomBytes(32).toString('hex')};
  if (!fs.existsSync(path.join(DIR,'keys.json'))) atomicJson(path.join(DIR,'keys.json'),keys);
  const env = previewEnv(process.env,keys);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env,env);
  require('./network');
  const db = require('../../db'), pool = db.getPool();
  const identity = (await pool.query('SELECT current_database() AS name, ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0];
  if (identity?.name !== 'infogenie_preview' || identity.ssl !== true) throw new Error('Dedicated preview database and TLS are required.');
  const fixtures = require('../../test/helpers/fixtures').makeFixtures();
  await db.ensureSchema(); await fixtures.ensureSchemas();
  await require('../../services/search_intel/schema').ensureSearchIntelSchema();
  await require('../../services/optimizer/schema').ensureOptimizerSchema();
  await require('../../services/marketing_brief/schema').ensureMarketingBriefSchema();
  await require('../../services/agent_orchestrator/schema').ensureAgentOrchestratorSchema();
  const schema = require('../../services/client_reporting/schema');
  await schema.ensureClientReportingSchema(); await schema.ensureClientReportingMappingSchema();
  const pending = ACCESS + '.pending';
  async function matches(record) {
    const found = (await pool.query(`SELECT u.password_hash FROM users u
      JOIN tenant_users tu ON tu.user_id=u.id AND tu.status='active'
      JOIN roles r ON r.id=tu.role_id AND r.key='tenant_owner'
      JOIN clients c ON c.tenant_id=tu.tenant_id
      WHERE u.email=$1 AND NOT u.is_owner AND tu.tenant_id=$2 AND c.id=$3`,
    [record.email,record.tenantId,record.clientId])).rows[0];
    return !!found && await require('bcryptjs').compare(record.password,found.password_hash);
  }
  // Recover a committed seed if the process stopped before its final file rename.
  if (!fs.existsSync(ACCESS) && fs.existsSync(pending)) {
    if (await matches(JSON.parse(fs.readFileSync(pending,'utf8')))) fs.renameSync(pending,ACCESS);
  }
  if (!fs.existsSync(ACCESS)) {
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');
      if (Number((await conn.query('SELECT count(*) FROM users')).rows[0].count)) {
        throw new Error('Preview database has users but no matching access record. No existing accounts were changed.');
      }
      const tenant = (await conn.query("INSERT INTO tenants (name,slug,status) VALUES ('DEMO — Cedar Studio','demo-cedar-studio','active') RETURNING id")).rows[0];
      const password=crypto.randomBytes(18).toString('base64url')+'7a', email='reviewer@example.test';
      const hash=await require('bcryptjs').hash(password,10);
      const user=(await conn.query("INSERT INTO users (email,password_hash,name,is_owner,email_verified_at) VALUES ($1,$2,'Preview reviewer',false,now()) RETURNING id",[email,hash])).rows[0];
      const role=(await conn.query("SELECT id FROM roles WHERE tenant_id IS NULL AND key='tenant_owner'")).rows[0];
      if(!role) throw new Error('Preview tenant owner role is unavailable.');
      await conn.query("INSERT INTO tenant_users (tenant_id,user_id,role_id,status,joined_at) VALUES ($1,$2,$3,'active',now())",[tenant.id,user.id,role.id]);
      const client=(await conn.query("INSERT INTO clients (tenant_id,name,status) VALUES ($1,'DEMO — Cedar & Coast','active') RETURNING id",[tenant.id])).rows[0];
      await conn.query('INSERT INTO search_intel_queries (tenant_id,query,brand) VALUES ($1,$2,$3)',
        [tenant.id,'DEMO — sustainable coastal homeware','DEMO — Cedar & Coast']);
      atomicJson(pending,{email,password,tenantId:tenant.id,clientId:client.id});
      await conn.query('COMMIT');
      fs.renameSync(pending,ACCESS);
    } catch(error) {await conn.query('ROLLBACK');throw error;}
    finally {conn.release();}
  }
  const access=JSON.parse(fs.readFileSync(ACCESS,'utf8'));
  if(!await matches(access)) throw new Error('Preview workspace does not match the saved access record.');
  const app = require('../../server').buildApp(); // Full real middleware; no background jobs.
  server = await new Promise((resolve,reject)=>{const s=app.listen(8000,'127.0.0.1',()=>resolve(s));s.once('error',reject);});
  const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','-H','0.0.0.0','-p','5000'],{cwd:ROOT,env,stdio:'inherit'});
  children.push(child); child.on('error',()=>process.exit(1)); child.on('exit',code=>process.exit(code || 0));
  console.log('Preview: open private port 5000, then / for your workspace. Login details: npm run preview:access');
}
if (require.main===module) main().catch(error=>{console.error(error.message);process.exit(1);});
module.exports={previewEnv,previewOrigin};
