'use strict';
const assert = require('node:assert/strict');

module.exports = async function briefDelivery({page,db,actors,baseUrl}) {
  const pool=db.getPool(), tid=actors.owner.tid;
  const scanner=require('../../services/ai_governance/output_gate'), scan=scanner.scanOutput;
  let provider=()=>200, sends=[], scanned=[];
  const restore=require('./marketing-brief-delivery-provider')((body,options)=>{
    sends.push({body,options});return provider();
  });
  const rows=async()=> (await pool.query('SELECT * FROM marketing_briefs WHERE tenant_id=$1 ORDER BY id',[tid])).rows;
  const post=id=>page.evaluate(async id=>{
    const r=await fetch(`/api/marketing-brief/${id}/deliver`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"channels":["slack"]}'});
    return {status:r.status,body:await r.json()};
  },id);
  const button=()=>page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>/Send to Slack|Sending|✓ Sent/.test(b.textContent))?.textContent);
  const click=()=>page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Send to Slack')).click());
  const send=async()=>{
    const [r]=await Promise.all([page.waitForResponse(r=>/\/api\/marketing-brief\/\d+\/deliver$/.test(new URL(r.url()).pathname)),click()]);
    return {status:r.status(),body:await r.json()};
  };
  try {
    const id=(await pool.query(`INSERT INTO marketing_briefs(tenant_id,headline,signals)
      VALUES($1,'DEMO delivery safety','[{"detail":"guaranteed returns"}]') RETURNING id`,[tid])).rows[0].id;
    const foreign=(await pool.query('SELECT id FROM marketing_briefs WHERE tenant_id=$1 LIMIT 1',[actors.other.tid])).rows[0].id;
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='enforce' WHERE tenant_id=$1",[tid]);
    await page.goto(baseUrl+'/manage/marketing-brief',{waitUntil:'networkidle2'});
    await page.waitForFunction(()=>document.body.innerText.includes('DEMO delivery safety'));
    const before=await rows();
    scanner.scanOutput=(payload,...args)=>{scanned.push(payload.text);return scan(payload,...args);};
    assert.equal((await post(foreign)).status,404);assert.equal(scanned.length,0);
    const blocked=await send();assert.equal(blocked.status,403);assert.equal(blocked.body.ok,false);
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('was not sent'));
    assert.match(await button(),/Send to Slack/);assert.equal(sends.length,0);assert.deepEqual(await rows(),before);
    assert.ok(scanned.some(text=>text.includes('guaranteed returns')),'stored signal beyond outgoing projection is checked');
    scanner.scanOutput=()=>{throw new Error('private scanner outage');};
    const outage=await send();assert.equal(outage.status,503);assert.doesNotMatch(JSON.stringify(outage.body),/private scanner/);
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('temporarily unavailable'));
    assert.equal(sends.length,0);assert.deepEqual(await rows(),before);assert.match(await button(),/Send to Slack/);
    scanner.scanOutput=(payload,...args)=>{scanned.push(payload.text);return scan(payload,...args);};
    await pool.query("UPDATE ai_governance_policies SET content_safety_mode='warning_only' WHERE tenant_id=$1",[tid]);
    delete process.env.SLACK_WEBHOOK_URL;
    assert.equal((await send()).status,503);
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('not configured'));
    assert.equal(sends.length,0);assert.deepEqual(await rows(),before);
    process.env.SLACK_WEBHOOK_URL='https://hooks.slack.com/services/synthetic-delivery';
    provider=()=>500;assert.equal((await send()).status,502);
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('did not confirm'));
    assert.match(await button(),/Send to Slack/);assert.deepEqual(await rows(),before);
    let started,release;const start=new Promise(r=>{started=r;});
    provider=()=>{started();return new Promise(r=>{release=()=>r(200);});};
    let requests=0;const observe=r=>{if(r.method()==='POST'&&r.url().endsWith(`/${id}/deliver`))requests++;};
    page.on('request',observe);scanned=[];
    const response=page.waitForResponse(r=>r.url().endsWith(`/${id}/deliver`)&&r.status()===200);
    await click();await start;
    await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Sending'));
      b.click();b.click();});
    assert.equal(requests,1,'UI suppresses duplicate in-flight sends');
    const duplicate=await post(id);assert.equal(duplicate.status,409);assert.equal(sends.length,2);
    release();const success=await (await response).json();
    assert.equal(success.ok,true);assert.equal(success.delivered[0].ok,true);assert.ok(success.content_safety_warnings.length);
    await page.waitForFunction(()=>document.body.innerText.includes('✓ Sent')&&document.body.innerText.includes('Content safety warnings'));
    page.off('request',observe);
    const saved=(await rows()).find(row=>row.id===id);
    assert.deepEqual(saved.content_safety_warnings,success.content_safety_warnings);assert.equal(saved.delivered_to.length,1);
    assert.equal(scanned.at(-1),sends.at(-1).body.text,'exact text at HTTPS boundary was scanned');
    assert.equal((await post(id)).body.already_delivered,true);assert.equal(sends.length,2);
    await page.reload({waitUntil:'networkidle2'});
    await page.waitForFunction(()=>document.body.innerText.includes('Content safety warnings'));
    assert.equal((await send()).body.already_delivered,true);assert.equal(sends.length,2);
    await page.waitForFunction(()=>document.body.innerText.includes('✓ Sent'));
    assert.deepEqual((await rows()).find(row=>row.id===id),saved,'deduped send does not rewrite');
  } finally {restore();scanner.scanOutput=scan;}
};
