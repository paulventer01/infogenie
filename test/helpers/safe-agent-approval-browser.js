'use strict';
const assert = require('node:assert/strict');

module.exports = async function safeApproval({page,baseUrl,actors,db}) {
  const pool=db.getPool(), tid=actors.owner.tid, ids=[];
  await require('../../services/safe_agent/schema').ensureSafeAgentSchema();
  const scanner=require('../../services/ai_governance/output_gate'), scan=scanner.scanOutput;
  const seed=async (text, tenant=tid, title='DEMO safety proposal')=>{
    const r=await pool.query(`INSERT INTO safe_agent_proposals(tenant_id,title,proposal,simulation)
      VALUES($1,$2,$3,'{}') RETURNING id`,[tenant,title,JSON.stringify({actions:[{detail:text}]})]);
    ids.push(r.rows[0].id);return r.rows[0].id;
  };
  const read=async id=>(await pool.query('SELECT status,approved_by,approved_at,outcome,content_safety_warnings FROM safe_agent_proposals WHERE id=$1',[id])).rows[0];
  const approve=id=>page.evaluate(async id=>{
    const r=await fetch(`/api/safe-agent/approve/${id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    return {status:r.status,body:await r.json()};
  },id);
  const dialog=d=>void d.accept();page.on('dialog',dialog);
  try {
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce',content_safety_explicit=true WHERE tenant_id=$1",[tid]);
    const id=await seed('guaranteed\nreturns'), foreign=await seed('PRIVATE foreign',actors.other.tid);
    const before=await read(id);
    page.removeAllListeners('request');
    page.on('request',r=>{
      const url=new URL(r.url());
      if(!['data:','blob:'].includes(url.protocol)&&url.origin!==baseUrl) return void r.abort('blockedbyclient');
      if(r.method()==='GET'&&url.pathname.startsWith('/api/')&&url.pathname!=='/api/auth/me'&&!url.pathname.startsWith('/api/safe-agent/'))
        return void r.respond({status:200,contentType:'application/json',body:'{"ok":false}'});
      void r.continue();
    });
    await page.goto(baseUrl+'/grow/safe-agent',{waitUntil:'networkidle2'});
    await page.waitForFunction(()=>document.body.innerText.includes('DEMO safety proposal'));
    await page.evaluate(()=>[...document.querySelectorAll('.ig-card')].find(e=>e.textContent.includes('DEMO safety proposal')&&e.style.cursor==='pointer').click());
    const submit=async()=>{
      const [r]=await Promise.all([page.waitForResponse(r=>r.url()===`${baseUrl}/api/safe-agent/approve/${id}`),
        page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Approve & Execute')).click())]);
      return {status:r.status(),body:await r.json()};
    };
    assert.equal((await submit()).status,403);
    await page.waitForSelector('[role="alert"]');
    assert.deepEqual(await read(id),before);
    assert.equal((await approve(foreign)).status,404);
    assert.doesNotMatch(await page.evaluate(()=>document.body.innerText),/PRIVATE foreign/);
    scanner.scanOutput=()=>{throw new Error('synthetic outage');};
    assert.equal((await submit()).status,503);
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('temporarily unavailable'));
    assert.deepEqual(await read(id),before);scanner.scanOutput=scan;
    assert.equal((await pool.query('SELECT * FROM safe_agent_audit_log WHERE proposal_id=$1',[id])).rows.length,0);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='warning_only' WHERE tenant_id=$1",[tid]);
    const allowed=await submit();assert.equal(allowed.status,200);assert.ok(allowed.body.content_safety_warnings.length);
    await page.waitForFunction(()=>document.body.innerText.includes('CONTENT SAFETY WARNINGS')&&![...document.querySelectorAll('button')].some(b=>b.textContent.includes('Approve & Execute')));
    assert.equal((await read(id)).status,'executed');
    assert.deepEqual((await read(id)).content_safety_warnings,allowed.body.content_safety_warnings);
    assert.equal((await approve(id)).status,409);
    await page.reload({waitUntil:'networkidle2'});
    await page.waitForFunction(()=>document.body.innerText.includes('DEMO safety proposal'));
    await page.evaluate(()=>[...document.querySelectorAll('.ig-card')].find(e=>e.textContent.includes('DEMO safety proposal')&&e.style.cursor==='pointer').click());
    await page.waitForFunction(()=>document.body.innerText.includes('CONTENT SAFETY WARNINGS'));
    const huge=await seed('x'.repeat(100001));assert.equal((await approve(huge)).status,400);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
    // Force a real concurrent content change between the scan and conditional UPDATE.
    const race=await seed('Schedule a demo.');
    const lock=await pool.connect();let pending;
    try {
      await lock.query('BEGIN');await lock.query('SELECT id FROM safe_agent_proposals WHERE id=$1 FOR UPDATE',[race]);
      pending=approve(race);let waiting=false;
      for(let n=0;n<200&&!waiting;n++) {
        waiting=(await pool.query('SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',[lock.processID])).rows.length>0;
        if(!waiting) await new Promise(r=>setTimeout(r,25));
      }
      assert.ok(waiting,'approval reaches row lock after scan');
      await lock.query(`UPDATE safe_agent_proposals SET proposal='{"detail":"guaranteed returns"}' WHERE id=$1`,[race]);
      await lock.query('COMMIT');assert.equal((await pending).status,409);assert.equal((await read(race)).status,'pending_approval');
    } finally {await lock.query('ROLLBACK');lock.release();if(pending) await pending;}
    const once=await seed('Schedule a demo.');
    assert.deepEqual((await Promise.all([approve(once),approve(once)])).map(r=>r.status).sort(),[200,409]);
    const events=(await pool.query('SELECT event FROM safe_agent_audit_log WHERE proposal_id=$1 ORDER BY id',[once])).rows.map(r=>r.event);
    assert.deepEqual(events,['approved','executed']);
  } finally {
    scanner.scanOutput=scan;page.off('dialog',dialog);
    await pool.query('DELETE FROM safe_agent_audit_log WHERE proposal_id=ANY($1::int[])',[ids]);
    await pool.query('DELETE FROM safe_agent_proposals WHERE id=ANY($1::int[])',[ids]);
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
  }
};
