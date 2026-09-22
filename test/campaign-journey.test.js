'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const React=require('react'),{act}=React,{JSDOM}=require('jsdom');
function loader(){
  const cache=new Map();
  function load(file){
    if(cache.has(file))return cache.get(file);
    const {outputText}=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}});
    const mod={exports:{}};
    new Function('exports','require','module',outputText)(mod.exports,id=>id==='next/navigation'?{useRouter:()=>({push(){}})}:id.startsWith('@/lib/')?load(id.slice(2)+'.ts')
      :id.endsWith('.module.css')?{default:{}}:id==='next/link'?{default:({children,...props})=>React.createElement('a',props,children)}:require(id),mod);
    cache.set(file,mod.exports);return mod.exports;
  }
  return load;
}

const brief={id:11,brand:'Example',headline:'Spring campaign',greeting:'Review this source',generated_by:'test',content_hash:'b'.repeat(64)};
const creative={id:'creative-row',artifact_id:'asset',version:1,content_hash:'c'.repeat(64),format:'image',objective:'Traffic'};
const workflow={id:'workflow',name:'Spring',objective:'traffic',landing_page_url:'https://example.com',advertising_budget:10,currency:'USD',target_markets:['US'],target_audiences:['Customers'],selected_platforms:['meta']};
async function harness(t,handler=()=>undefined,options={}){
  const dom=new JSDOM('<div id="root"></div>',{url:options.url||'http://localhost/',pretendToBeVisual:true});
  const state={tenant:7,permissions:['orchestrator.workflows.view','reports.view','orchestrator.workflows.edit','orchestrator.workflows.approve.campaign_publishing'],draft:null};
  const calls=[];
  const values={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,
    fetch:async(url,opts={})=>{
      const request={url,headers:opts.headers,method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):null};calls.push(request);
      let body=await handler(request,state);
      if(body===undefined){
        if(url==='/api/tenants/me')body={ok:true,user:{id:1},activeTenantId:state.tenant,memberships:[{tenantId:state.tenant}]};
        else if(url==='/api/tenants/active')body={ok:true,tenant:{id:state.tenant,status:'active'},permissions:state.permissions,isPlatformAdmin:false};
        else if(url.includes('journey-options'))body={ok:true,briefs:[brief],creatives:[creative]};
        else if(url.endsWith('/workflows'))body={ok:true,workflows:[workflow]};
        else if(url.includes('?workflow_id='))body={ok:true,drafts:state.draft?[state.draft]:[]};
        else if(request.method==='POST'&&url.endsWith('/campaign-drafts')){
          state.draft={...request.body,id:'draft',tenant_id:7,workflow_id:'workflow',status:'draft',current_revision:1,contract_hash:'d'.repeat(64),validation_status:'pending',validation:{errors:[]}};
          body={ok:true,draft:state.draft};
        } else if(url.endsWith('/validate')){state.draft={...state.draft,status:'ready_for_approval',validation_status:'passed'};body={ok:true,draft:state.draft};}
        else if(url.endsWith('/approve')){state.draft={...state.draft,status:'approved_for_publish',approval_expires_at:new Date(Date.now()+3600000).toISOString()};body={ok:true,draft:state.draft};}
        else if(url.endsWith('/revoke')){state.draft={...state.draft,status:'ready_for_approval'};body={ok:true,draft:state.draft};}
        else throw Error('Unexpected request '+url);
      }
      return {ok:body.ok!==false,status:body.ok===false?403:200,headers:{get:()=> 'application/json'},json:async()=>body};
    }};
  const previous=new Map(Object.keys(values).map(k=>[k,Object.getOwnPropertyDescriptor(global,k)]));
  for(const [key,value]of Object.entries(values))Object.defineProperty(global,key,{value,configurable:true,writable:true});
  const root=require('react-dom/client').createRoot(document.getElementById('root'));
  t.after(async()=>{await act(async()=>root.unmount());dom.window.close();for(const[k,d]of previous){if(d)Object.defineProperty(global,k,d);else delete global[k];}});
  await act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(loader()(options.component||'components/features/manage/CampaignJourney.tsx').default))));
  const h={state,calls,text:()=>document.body.textContent,
    set:async(name,value)=>act(async()=>{const el=document.querySelector('[name="'+name+'"]');assert.ok(el,name);
      Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(el,value);
      el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));}),
    click:async(text)=>act(async()=>{const el=[...document.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(el,text);assert.equal(el.disabled,false,text+' disabled');el.click();}),
    confirm:async()=>act(async()=>document.querySelector('input[type="checkbox"]').click()),
    focus:async()=>act(async()=>window.dispatchEvent(new dom.window.Event('focus')))};
  return h;
}
async function prepare(h){await h.set('marketing_brief','11');await h.set('campaign_workflow','workflow');await h.set('creative','creative-row');await h.set('start','2030-01-01T10:00');}
test('journey is a registered React route',()=>{
 const load=loader();assert.equal(load('lib/viewRoutes.ts').pathToViewId('/manage/campaign-journey'),'campaign-journey');
 assert.equal(load('lib/migratedViews.ts').isMigratedView('campaign-journey'),true);
});
test('saved brief to campaign approval and renewed approval stay bound to saved revision',async t=>{
 const h=await harness(t);assert.ok(h.calls.every(c=>c.method==='GET'));await prepare(h);
 await h.click('Save campaign draft');assert.match(h.text(),/Campaign draft saved/);
 const created=h.calls.find(c=>c.method==='POST');assert.equal(created.body.tenant_id,7);assert.equal(created.body.contract.provenance.marketing_brief_id,11);
 await h.click('Validate saved campaign');await h.confirm();await h.click('Approve saved campaign');
 assert.match(h.text(),/Approved — not published/);
 await h.click('Withdraw approval');await h.confirm();await h.click('Approve saved campaign');
 const approvals=h.calls.filter(c=>c.url.endsWith('/approve'));
 assert.equal(approvals.length,2);assert.equal(approvals[0].body.revision,1);assert.equal(approvals[0].body.contract_hash,'d'.repeat(64));
 assert.notEqual(approvals[0].body.idempotency_key,approvals[1].body.idempotency_key);
 assert.ok(h.calls.every(c=>!c.url.includes('publishing-requests')));
});
test('starting a new campaign does not replay the prior create request',async t=>{
 const h=await harness(t);await prepare(h);await h.click('Save campaign draft');
 await h.set('saved_campaign','');await h.set('creative','creative-row');await h.set('start','2030-01-01T10:00');
 await h.click('Save campaign draft');
 const creates=h.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/campaign-drafts'));
 assert.equal(creates.length,2);assert.notEqual(creates[0].body.idempotency_key,creates[1].body.idempotency_key);
});
test('permission loss during a failed request clears previous source data',async t=>{
 const h=await harness(t,(r,state)=>{if(r.method==='POST'){state.permissions=[];return {ok:false,error:'permission_denied'};}});
 await prepare(h);await h.click('Save campaign draft');assert.doesNotMatch(h.text(),/Spring campaign|Review this source/);assert.match(h.text(),/viewing access/);
});
test('switching workspace clears brief data and disables old approval',async t=>{
 const h=await harness(t);await prepare(h);await h.click('Save campaign draft');await h.click('Validate saved campaign');
 h.state.tenant=8;await h.focus();assert.doesNotMatch(h.text(),/Spring campaign|Approve saved campaign/);assert.match(h.text(),/workspace changed/);
});
test('unsaved edits cannot approve the previously validated draft',async t=>{
 const h=await harness(t);await prepare(h);await h.click('Save campaign draft');await h.click('Validate saved campaign');
 await h.set('amount','20');assert.match(h.text(),/Unsaved changes/);assert.doesNotMatch(h.text(),/Approve saved campaign/);
});
test('invalid budget and unsupported currency do not create a contract',()=>{
 const {buildContract}=loader()('lib/campaignJourney.ts');const form={label:'Draft',objective:'traffic',platform:'meta',landing:'https://example.com',amount:'10',currency:'USD',country:'US',audience:'Customer',start:'2030-01-01',creative:'creative-row'};
 assert.throws(()=>buildContract({...form,amount:'0'},'workflow',brief,creative));
 assert.throws(()=>buildContract({...form,currency:'ZZZ'},'workflow',brief,creative));
});

test('label edit preserves explicit account owner, audience notes and exact schedule',async t=>{
 const h=await harness(t,(r,state)=>{
  if(r.method==='PATCH'){state.draft={...state.draft,...r.body};return {ok:true,draft:state.draft};}
 });
 await prepare(h);await h.click('Save campaign draft');
 h.state.draft.contract.accounts=[{platform:'meta',credential_ref:'user_integrations:1'}];
 h.state.draft.contract.audience.notes='Keep this approved targeting rationale';
 h.state.draft.contract.schedule={start_at:'2030-01-01T10:00:32.123Z',end_at:'2030-01-02T10:00:32.123Z'};
 await h.set('campaign_workflow','workflow');await h.set('saved_campaign','draft');await h.set('label','New label');await h.click('Save campaign draft');
 const payload=h.calls.find(c=>c.method==='PATCH').body;
 assert.equal(payload.contract.accounts[0].credential_ref,'user_integrations:1');
 assert.equal(payload.contract.audience.notes,'Keep this approved targeting rationale');
 assert.equal(payload.contract.schedule.start_at,'2030-01-01T10:00:32.123Z');
 assert.equal(payload.contract.schedule.end_at,'2030-01-02T10:00:32.123Z');
 assert.equal(payload.expected_revision,1);assert.equal(payload.expected_hash,'d'.repeat(64));
});

async function setupWorkspace(h) {
 await h.set('marketing_brief','11');await h.click('Create campaign workspace');
 await h.set('workspace_name','New workspace');await h.set('workspace_landing','https://example.com');
}
test('empty workspace setup creates once, selects it, and preserves the source brief',async t=>{
 const h=await harness(t,(r,state)=>{
  state.permissions.push('orchestrator.workflows.create');
  if(r.url.endsWith('/workflows'))return r.method==='POST'?{ok:true,workflow}:{ok:true,workflows:[]};
 });
 assert.match(h.text(),/No campaign workspaces yet/);await setupWorkspace(h);await h.click('Create and select workspace');
 assert.equal(document.querySelector('[name="campaign_workflow"]').value,'workflow');
 assert.equal(document.querySelector('[name="marketing_brief"]').value,'11');
 assert.match(h.text(),/2. Prepare the campaign draft/);
 const calls=h.calls.filter(r=>r.method==='POST');assert.equal(calls.length,1);
 assert.equal(calls[0].body.expected_tenant_id,7);assert.equal(calls[0].body.expected_actor_user_id,1);
 assert.equal(calls[0].body.credit_ceiling_micros,0);assert.equal(calls[0].body.advertising_budget,0);
 assert.ok(calls[0].headers['Idempotency-Key']);
});
test('retry after an uncertain create reuses the same idempotency key',async t=>{
 let attempts=0;
 const h=await harness(t,(r,state)=>{
  state.permissions.push('orchestrator.workflows.create');
  if(r.method==='POST'&&r.url.endsWith('/workflows'))return ++attempts===1?{ok:false,error:'network_error'}:{ok:true,workflow};
 });
 await setupWorkspace(h);await h.click('Create and select workspace');assert.match(h.text(),/network_error/);
 await h.click('Create and select workspace');
 const creates=h.calls.filter(r=>r.method==='POST');assert.equal(creates.length,2);
 assert.equal(creates[0].headers['Idempotency-Key'],creates[1].headers['Idempotency-Key']);
});
test('creation permission is rechecked before sending the mutation',async t=>{
 let initial=true;
 const h=await harness(t,(_r,state)=>{if(initial){state.permissions.push('orchestrator.workflows.create');initial=false;}});
 await setupWorkspace(h);
 h.state.permissions=h.state.permissions.filter(p=>p!=='orchestrator.workflows.create');
 await h.click('Create and select workspace');assert.equal(h.calls.filter(r=>r.method==='POST').length,0);
 assert.match(h.text(),/do not have permission/);
});
test('tenant switch while creating never selects a stale workspace',async t=>{
 const h=await harness(t,(r,state)=>{
  state.permissions.push('orchestrator.workflows.create');
  if(r.method==='POST'){state.tenant=8;return {ok:true,workflow};}
 });
 await setupWorkspace(h);await h.click('Create and select workspace');
 assert.match(h.text(),/workspace changed/);assert.doesNotMatch(h.text(),/New workspace|2. Prepare the campaign draft/);
});


test('creative handoff opens selected workspace separately and refresh preserves unsaved edits',async t=>{
 let ready=false;
 const h=await harness(t,r=>r.url.includes('journey-options')?{ok:true,briefs:[brief],creatives:ready?[creative]:[]}:undefined);
 await h.set('marketing_brief','11');await h.set('campaign_workflow','workflow');
 await h.set('label','My unsaved campaign');await h.set('audience','My unsaved audience');
 const link=[...document.querySelectorAll('a')].find(a=>a.textContent.includes('creative approvals ('));
 assert.equal(link.getAttribute('href'),'/manage/agent-orchestrator?workflow_id=workflow');
 assert.equal(link.target,'_blank');assert.match(link.rel,/noopener/);
 ready=true;await h.click('Refresh creative briefs');
 assert.equal(document.querySelector('[name="label"]').value,'My unsaved campaign');
 assert.equal(document.querySelector('[name="audience"]').value,'My unsaved audience');
 assert.equal(document.querySelector('[name="marketing_brief"]').value,'11');
 assert.equal(document.querySelector('[name="creative"]').options.length,2);
 assert.equal(document.querySelector('[name="saved_campaign"]').disabled,true);
 assert.equal(h.calls.filter(r=>r.method!=='GET').length,0);
});
test('creative refresh rejects changed tenant and clears stale edits',async t=>{
 const h=await harness(t,r=>r.url.includes('journey-options')?{ok:true,briefs:[brief],creatives:[]}:undefined);
 await h.set('marketing_brief','11');await h.set('campaign_workflow','workflow');await h.set('label','Unsaved old tenant');
 h.state.tenant=8;await h.click('Refresh creative briefs');
 assert.match(h.text(),/workspace changed/);assert.equal(document.querySelector('[name="label"]'),null);
});
test('existing creative approvals can refresh after replacement without losing campaign edits',async t=>{
 let replaced=false;
 const replacement={...creative,id:'replacement-row',artifact_id:'replacement-asset',version:2};
 const h=await harness(t,r=>r.url.includes('journey-options')?{ok:true,briefs:[brief],creatives:replaced?[replacement]:[creative]}:undefined);
 await prepare(h);await h.set('label','Keep my draft');await h.set('amount','25');
 replaced=true;await h.click('Refresh creative briefs');
 assert.equal(document.querySelector('[name="label"]').value,'Keep my draft');
 assert.equal(document.querySelector('[name="amount"]').value,'25');
 assert.equal(document.querySelector('[name="creative"]').value,'');
 assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='Save campaign draft').disabled,true);
 assert.match(h.text(),/Choose an approved creative brief/);
 await h.set('creative','replacement-row');await h.click('Save campaign draft');
 const created=h.calls.find(r=>r.method==='POST');
 assert.equal(created.body.contract.creatives[0].asset_id,'replacement-asset');
 assert.equal(created.body.contract.creatives[0].version,2);
 assert.equal(created.body.label,'Keep my draft');
 assert.equal(created.body.contract.budget.amount_micros,25000000);
});
test('refresh retains unchanged selection and blocks approval when its version changes',async t=>{
 let changed=false;
 const h=await harness(t,r=>r.url.includes('journey-options')?{ok:true,briefs:[brief],creatives:[changed?{...creative,version:2,content_hash:'e'.repeat(64)}:creative]}:undefined);
 await prepare(h);await h.click('Save campaign draft');await h.click('Validate saved campaign');await h.confirm();
 await h.click('Refresh creative briefs');
 assert.equal(document.querySelector('[name="creative"]').value,'creative-row');
 assert.equal(document.querySelector('input[type="checkbox"]').checked,false);
 assert.doesNotMatch(h.text(),/Unsaved changes/);
 changed=true;await h.click('Refresh creative briefs');
 assert.equal(document.querySelector('[name="creative"]').value,'');
 assert.match(h.text(),/Unsaved changes/);assert.doesNotMatch(h.text(),/Approve saved campaign/);
 await h.click('Discard edits');
 assert.doesNotMatch(h.text(),/Approve saved campaign/);
 assert.match(h.text(),/save a new revision before approval/);
 assert.equal(h.calls.filter(r=>r.url.endsWith('/approve')).length,0);
});
for(const requested of ['workflow','foreign-workflow']){
 test('creative review handoff only selects accessible workflow: '+requested,async t=>{
  const h=await harness(t,r=>{
   if(r.url==='/api/tenants/active')return {ok:true,permissions:[],isPlatformAdmin:false};
   if(r.url.endsWith('/workflows'))return {ok:true,workflows:[workflow]};
   if(r.url.endsWith('/workflows/workflow'))return {ok:true,workflow:{...workflow,current_state:'draft',current_phase:'research',version:1}};
   return {ok:true};
  },{component:'components/features/manage/AgentOrchestrator.tsx',url:'http://localhost/manage/agent-orchestrator?workflow_id='+requested});
  if(requested==='workflow'){
   assert.match(h.text(),/Creative review for Spring/);
   assert.ok(document.querySelector('#campaign-workspace-details'));
   assert.ok(h.calls.some(r=>r.url.endsWith('/workflows/workflow')));
  }else{
   assert.match(h.text(),/requested campaign workspace is not available/);
   assert.equal(document.querySelector('#campaign-workspace-details'),null);
   assert.ok(!h.calls.some(r=>r.url.includes('foreign-workflow')));
  }
  assert.equal(h.calls.filter(r=>r.method!=='GET').length,0);
 });
}
