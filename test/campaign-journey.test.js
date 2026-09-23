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
      Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(el,value);
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
for(const canCancel of [true,false]){
 test('research conflict exposes explicit recovery with cancellation permission '+canCancel,async t=>{
  let conflict=true;
  const run={id:'interrupted',workflow_id:'workflow',state:'running',requested_platforms:['meta']};
  const h=await harness(t,r=>{
   if(r.url==='/api/tenants/active')return {ok:true,permissions:['orchestrator.workflows.view','orchestrator.workflows.approve.research_execution',...(canCancel?['orchestrator.workflows.cancel']:[])],isPlatformAdmin:false};
   if(r.url.endsWith('/workflows'))return {ok:true,workflows:[workflow]};
   if(r.url.endsWith('/workflows/workflow'))return {ok:true,workflow:{...workflow,current_state:'research_approved',current_phase:'research',version:1}};
   if(r.url.endsWith('/research/runs')&&r.method==='POST')return conflict?{ok:false,error:'execution_in_progress',run}:{ok:true,run:{...run,id:'fresh',state:'completed'}};
   if(r.url.endsWith('/interrupted/cancel')){conflict=false;return {ok:true,run:{...run,state:'cancelled'}};}
   return {ok:true};
  },{component:'components/features/manage/AgentOrchestrator.tsx',url:'http://localhost/manage/agent-orchestrator?workflow_id=workflow'});
  await h.click('Start Meta research');
  assert.match(h.text(),/An earlier research run is still pending or running/);
  assert.match(h.text(),/Run: interrupted/);
  assert.equal(h.calls.filter(r=>r.url.endsWith('/cancel')).length,0);
  if(canCancel){
   await h.click('Cancel run');
   assert.match(h.text(),/Research run cancelled/);
   await h.click('Start Meta research');
   assert.match(h.text(),/Run: fresh/);
   assert.match(h.text(),/State: completed/);
  }else assert.ok(![...document.querySelectorAll('button')].some(b=>b.textContent==='Cancel run'));
 });
}
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

async function creativeReviewHarness(t, options = {}) {
 const run={id:'meta-completed',workflow_id:'workflow',state:'completed',requested_platforms:['meta']};
 const generation={id:'proposal',workflow_id:'workflow',status:'pending_review',version:1,provider:'fixture',artifacts:[{id:'brief',kind:'creative_brief',status:'draft',format:'image',payload:{objective:'Review this creative',primary_message:{text:'<script>not executable</script>'}},citations:[]}]};
 const state={runs:options.runs || [],generation:options.generation ? generation : null,contextError:false};
 const h=await harness(t,async(r)=>{
  if(options.handler){const result=await options.handler(r,state);if(result!==undefined)return result;}
  if(r.url==='/api/tenants/active')return {ok:true,permissions:['orchestrator.workflows.view','orchestrator.workflows.approve.research_execution',...(options.readOnly?[]:['orchestrator.workflows.edit','orchestrator.workflows.approve.creative_generation'])],isPlatformAdmin:false};
  if(r.url.endsWith('/workflows'))return {ok:true,workflows:[workflow,{...workflow,id:'other',name:'Other workflow'}]};
  if(r.url.endsWith('/workflows/workflow'))return {ok:true,workflow:{...workflow,current_state:options.advanced?'creative_approved':'research_approved',current_phase:'research',version:1,credit_ceiling_micros:options.zero?0:1000000}};
  if(r.url.endsWith('/workflows/other'))return {ok:true,workflow:{...workflow,id:'other',name:'Other workflow',current_state:'research_approved',version:1}};
  if(r.url.includes('/proposals?workflow_id='))return state.contextError?{ok:false,error:'permission_denied'}:{ok:true,research_runs:state.runs,generation:state.generation,can_generate_in_state:!options.advanced,estimated_cost_micros:'10000'};
  if(r.url.endsWith('/research/runs')&&r.method==='POST'){state.runs=[run];return {ok:true,run};}
  if(r.url.endsWith('/proposals')&&r.method==='POST'){state.generation=generation;return {ok:true,generation};}
  return {ok:true};
 },{component:'components/features/manage/AgentOrchestrator.tsx',url:'http://localhost/manage/agent-orchestrator?workflow_id=workflow'});
 return {...h,context:state,run,generation};
}

test('completed Meta research becomes an explicit proposal source without cross-platform research',async t=>{
 const h=await creativeReviewHarness(t);
 assert.match(h.text(),/No creative proposal has been generated/);
 await h.click('Start Meta research');
 assert.equal(document.querySelector('[aria-label="Completed research snapshot"]').value,'meta-completed');
 await h.click('Generate proposals');
 const call=h.calls.find(r=>r.url.endsWith('/proposals')&&r.method==='POST');
 assert.equal(call.body.research_run_id,'meta-completed');assert.equal(call.body.workflow_id,'workflow');assert.equal(call.body.mode,'fixture');
 assert.match(h.text(),/Review this creative/);assert.match(h.text(),/<script>not executable<\/script>/);
 assert.equal(document.querySelectorAll('script').length,0);
 assert.equal(h.calls.filter(r=>r.url.endsWith('/approve')).length,0);
});

test('saved proposal and completed research restore on a new page mount without mutations',async t=>{
 const run={id:'restored',workflow_id:'workflow',state:'completed',requested_platforms:['google']};
 const h=await creativeReviewHarness(t,{runs:[run],generation:true});
 assert.match(h.text(),/Review this creative/);assert.equal(document.querySelector('[aria-label="Completed research snapshot"]').value,'restored');
 assert.ok(h.calls.every(r=>r.method==='GET'));
});

for(const options of [{zero:true},{advanced:true},{readOnly:true}])test('creative review preserves generation boundary '+JSON.stringify(options),async t=>{
 const run={id:'saved',workflow_id:'workflow',state:'completed',requested_platforms:['meta']};
 const h=await creativeReviewHarness(t,{...options,runs:[run]});
 const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Generate proposals');
 if(options.readOnly)assert.equal(button,undefined);else assert.equal(button.disabled,true);
 if(options.zero)assert.match(h.text(),/blocked by the workflow credit ceiling/);
 if(options.advanced)assert.match(h.text(),/unavailable in this workflow state/);
 assert.ok(h.calls.every(r=>r.method==='GET'));
});

test('multiple research sources require a choice and foreign or unfinished runs are excluded',async t=>{
 const h=await creativeReviewHarness(t,{runs:[
  {id:'meta',workflow_id:'workflow',state:'completed',requested_platforms:['meta']},
  {id:'google',workflow_id:'workflow',state:'completed',requested_platforms:['google']},
  {id:'foreign',workflow_id:'elsewhere',state:'completed'},
  {id:'unfinished',workflow_id:'workflow',state:'running'},
 ]});
 const select=document.querySelector('[aria-label="Completed research snapshot"]');
 assert.equal(select.options.length,3);assert.equal(select.value,'');
 assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='Generate proposals').disabled,true);
 assert.ok(h.calls.every(r=>r.method==='GET'));
});

test('creative review read failure clears stale proposal and exposes retry',async t=>{
 const h=await creativeReviewHarness(t,{generation:true});assert.match(h.text(),/Review this creative/);
 h.context.contextError=true;await h.click('Refresh creative review');
 assert.doesNotMatch(h.text(),/Review this creative/);assert.match(h.text(),/Could not load creative review/);
 h.context.contextError=false;await h.click('Refresh creative review');assert.match(h.text(),/Review this creative/);
});

test('creative refresh reports loading and empty success without mutations',async t=>{
 let defer=false,release;
 const h=await creativeReviewHarness(t,{handler:r=>{
  if(defer&&r.url.includes('/proposals?'))return new Promise(resolve=>{release=resolve;});
 }});
 defer=true;await h.click('Refresh creative review');
 assert.match(h.text(),/Refreshing creative review/);
 assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh creative review').disabled,true);
 await act(async()=>release({ok:true,research_runs:[],generation:null,can_generate_in_state:true,estimated_cost_micros:'10000'}));
 assert.match(h.text(),/Creative review refreshed. No saved proposal was found/);
 assert.doesNotMatch(h.text(),/Refreshing creative review/);
 assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh creative review').disabled,false);
 assert.ok(h.calls.every(r=>r.method==='GET'));
});

test('saved review labels image and video briefs and explains approval location',async t=>{
 const h=await creativeReviewHarness(t,{generation:true});
 h.context.generation.artifacts.push({...h.generation.artifacts[0],id:'video',format:'video'});
 await h.click('Refresh creative review');
 assert.match(h.text(),/Creative review refreshed. Saved proposal loaded below/);
 const labels=[...document.querySelectorAll('summary')].map(e=>e.textContent);
 assert.ok(labels.includes('Image creative brief · draft · citations 0'));
 assert.ok(labels.includes('Video creative brief · draft · citations 0'));
 assert.match(h.text(),/Individual brief approval controls are below this panel/);
 h.context.contextError=true;await h.click('Refresh creative review');
 assert.doesNotMatch(h.text(),/Creative review refreshed/);
 assert.match(h.text(),/Could not load creative review/);
 assert.ok(h.calls.every(r=>r.method==='GET'));
});

for(const format of ['image','video']) {
 test(format+' brief approval silently reloads review',async t=>{
  const h=await creativeReviewHarness(t,{generation:true});
  h.context.generation.artifacts[0].format=format;
  await h.click('Refresh creative review');
  await h.click('Approve '+format+' brief');
  assert.match(h.text(),new RegExp(format==='image'?'Image brief approved':'Video brief approved'));
  assert.doesNotMatch(h.text(),/Creative review refreshed|Refreshing creative review/);
  assert.equal(h.calls.filter(r=>r.method==='POST').length,1);
 });

 test('late '+format+' brief approval does not block another workflow review',async t=>{
  let release;
  const h=await creativeReviewHarness(t,{generation:true,handler:r=>{
   if(r.url.endsWith('/approve-brief'))return new Promise(resolve=>{release=resolve;});
  }});
  h.context.generation.artifacts[0].format=format;
  await h.click('Refresh creative review');
  await h.click('Approve '+format+' brief');
  await act(async()=>[...document.querySelectorAll('tr')].find(row=>row.textContent.includes('Other workflow')).click());
  const count=h.calls.filter(r=>r.url.includes('/proposals?')).length;
  await act(async()=>release({ok:true}));
  assert.equal(h.calls.filter(r=>r.url.includes('/proposals?')).length,count);
  assert.doesNotMatch(h.text(),/Refreshing creative review|Creative review refreshed/);
  assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh creative review').disabled,false);
 });
}

test('late creative context from the prior workflow cannot populate the selected workflow',async t=>{
 let release;
 const h=await creativeReviewHarness(t,{handler:r=>{
  if(r.url.endsWith('/proposals?workflow_id=workflow'))return new Promise(resolve=>{release=resolve;});
 }});
 await act(async()=>[...document.querySelectorAll('tr')].find(row=>row.textContent.includes('Other workflow')).click());
 await act(async()=>release({ok:true,research_runs:[h.run],generation:h.generation,can_generate_in_state:true,estimated_cost_micros:'10000'}));
 assert.doesNotMatch(h.text(),/Review this creative/);
 assert.doesNotMatch(h.text(),/Creative review refreshed. Saved proposal/);
 assert.equal(document.querySelector('[aria-label="Completed research snapshot"]'),null);
});


test('replacing an approved proposal clears exact image and video confirmations',async t=>{
 const h=await creativeReviewHarness(t);
 const approved=(id,approval)=>({...h.generation,id,content_hash:id,artifacts:['image','video'].map(format=>({
  id:format,kind:'creative_brief',format,status:'approved',version:1,content_hash:id,approval_id:approval,approval_hash:id,
 }))});
 h.context.generation=approved('first',1);await h.click('Refresh creative review');
 const checkboxes=()=>[...document.querySelectorAll('label')].filter(l=>l.textContent.includes('exact approved proposal version')).map(l=>l.querySelector('input'));
 assert.equal(checkboxes().length,2);
 await act(async()=>checkboxes().forEach(el=>el.click()));assert.ok(checkboxes().every(el=>el.checked));
 h.context.generation=approved('second',2);await h.click('Refresh creative review');
 assert.ok(checkboxes().every(el=>!el.checked));
 for(const label of ['Generate static image','Enqueue video job'])assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent===label).disabled,true);
 // A changed approval of the same proposal also requires fresh confirmation.
 await act(async()=>checkboxes().forEach(el=>el.click()));
 h.context.generation=approved('second',3);await h.click('Refresh creative review');
 assert.ok(checkboxes().every(el=>!el.checked));assert.ok(h.calls.every(r=>r.method==='GET'));
});

test('creative review displays escaped safety notes and claim qualifications',async t=>{
 const h=await creativeReviewHarness(t);
 h.context.generation={...h.generation,research_run_id:'saved-source',artifacts:[{...h.generation.artifacts[0],payload:{
  compliance_notes:'<img src=x onerror=alert(1)>',prohibited_claims:['Guaranteed returns'],limitations:'No performance evidence',
  supporting_claims:[{text:'Creative hypothesis',claim_kind:'hypothesis',evidence_backed:false}],
 }}]};
 await h.click('Refresh creative review');
 for(const text of ['Saved proposal research source: saved-source','<img src=x onerror=alert(1)>','Guaranteed returns','No performance evidence','claim kind: hypothesis','evidence backed: false'])assert.ok(h.text().includes(text),text);
 assert.equal(document.querySelector('img[src="x"]'),null);assert.ok(h.calls.every(r=>r.method==='GET'));
});


test('late context refresh cannot replace a newly generated proposal',async t=>{
 let defer=false,release;
 const run={id:'saved',workflow_id:'workflow',state:'completed',requested_platforms:['meta']};
 const h=await creativeReviewHarness(t,{runs:[run],handler:r=>{
  if(defer&&r.url.includes('/proposals?'))return new Promise(resolve=>{release=resolve;});
 }});
 defer=true;await h.click('Refresh creative review');
 await h.click('Generate proposals');assert.match(h.text(),/Review this creative/);
 await act(async()=>release({ok:true,research_runs:[run],generation:null,can_generate_in_state:true,estimated_cost_micros:'10000'}));
 assert.match(h.text(),/Review this creative/);
 assert.doesNotMatch(h.text(),/Refreshing creative review|Creative review refreshed/);
});

test('late generation response cannot populate another workflow',async t=>{
 let release;
 const run={id:'saved',workflow_id:'workflow',state:'completed',requested_platforms:['meta']};
 const h=await creativeReviewHarness(t,{runs:[run],handler:r=>{
  if(r.url.endsWith('/proposals')&&r.method==='POST')return new Promise(resolve=>{release=resolve;});
 }});
 await h.click('Generate proposals');
 await act(async()=>[...document.querySelectorAll('tr')].find(row=>row.textContent.includes('Other workflow')).click());
 await act(async()=>release({ok:true,generation:h.generation}));
 assert.doesNotMatch(h.text(),/Review this creative|Fixture proposal generated/);
});


test('owner-gated creative review explains the existing account boundary',async t=>{
 const h=await creativeReviewHarness(t,{handler:r=>r.url.includes('/proposals?')?{ok:false,error:'owner_only'}:undefined});
 assert.match(h.text(),/requires the deployment owner account/);
 assert.ok(h.calls.every(r=>r.method==='GET'));
});

function creditSnapshot(available = 30000, consumed = 0, reserved = 0) {
 return {ok:true,account:{available_micros:available,consumed_micros:consumed,reserved_micros:reserved,currency:'USD'},
  limits:{credit_ceiling_micros:50000,requests_per_minute:2,max_concurrent_ai:1,daily_ai_cost_micros:50000,monthly_ai_cost_micros:50000,per_workflow_cost_micros:50000},
  usage:{daily_micros:consumed,monthly_micros:consumed},reservations:[],workflows:[]};
}
async function generationCreditHarness(t, format, options = {}) {
 const ledger={snapshot:creditSnapshot()};
 const h=await creativeReviewHarness(t,{generation:true,runs:[{id:'completed',workflow_id:'workflow',state:'completed'}],handler:async(r,state)=>{
  if(state.generation){state.generation.content_hash='p'.repeat(64);Object.assign(state.generation.artifacts[0],{format,status:'approved',approval_id:12,approval_hash:'a'.repeat(64)});}
  if(options.handler){const result=await options.handler(r,ledger);if(result!==undefined)return result;}
  if(r.url==='/api/tenants/active')return {ok:true,isPlatformAdmin:false,permissions:['orchestrator.workflows.view','orchestrator.workflows.edit','orchestrator.credits.limits.edit',...(options.noCredits?[]:['orchestrator.credits.view'])]};
  if(r.url==='/api/agent-orchestrator/credits')return ledger.snapshot;
  if(r.method==='POST'&&(r.url.endsWith('/static-images')||r.url.endsWith('/video-jobs')||r.url.endsWith('/proposals'))){ledger.snapshot=creditSnapshot(20000,10000);return options.error?{ok:false,error:options.error}:{ok:true,job:{id:'generated',status:'succeeded'}};}
 }});
 return {...h,ledger,generate:async()=>{
  await act(async()=>[...document.querySelectorAll('label')].find(l=>l.textContent.includes(format==='image'?'I confirm generation':'I confirm enqueue')).querySelector('input').click());
  await h.click(format==='image'?'Generate static image':'Enqueue video job');
 }};
}
function creditValue(label) {
 const el=[...document.querySelectorAll('div')].find(el=>el.textContent===label);
 return el?.nextElementSibling?.textContent.trim();
}
for(const format of ['image','video']) {
 test(format+' generation refreshes ledger without changing limit edits or sending extra writes',async t=>{
  const h=await generationCreditHarness(t,format);
  assert.equal(creditValue('Available'),'0.03 USD');
  const input=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Credit ceiling (USD)').querySelector('input');
  await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'0.09');input.dispatchEvent(new window.Event('input',{bubbles:true}));});
  await h.generate();
  assert.equal(creditValue('Available'),'0.02 USD');assert.equal(creditValue('Consumed'),'0.01 USD');assert.equal(creditValue('Daily usage'),'0.01 USD');
  assert.equal([...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Credit ceiling (USD)').querySelector('input').value,'0.09');
  const writes=h.calls.filter(r=>r.method!=='GET');assert.equal(writes.length,1);
  assert.equal(writes[0].body.confirm,true);assert.equal(writes[0].body.estimated_max_cost_micros,10000);assert.equal(writes[0].body.approval_id,12);assert.equal(writes[0].body.proposal_content_hash,'p'.repeat(64));
 });
 test(format+' credit refusal shows guidance and refreshes accounting without retry',async t=>{
  const h=await generationCreditHarness(t,format,{error:'credit_ceiling_exceeded'});
  await h.generate();assert.match(h.text(),/workflow or tenant credit ceiling/);assert.match(h.text(),/Adding credits alone does not change spending limits/);
  assert.equal(creditValue('Consumed'),'0.01 USD');assert.equal(h.calls.filter(r=>r.method==='POST').length,1);
 });
 test(format+' terminal polling refreshes settled credits',async t=>{
  const h=await generationCreditHarness(t,format,{handler:(r,ledger)=>{
   if(r.method==='POST'){ledger.snapshot=creditSnapshot(20000,0,10000);return {ok:true,job:{id:'queued-job',status:'queued'}};}
   if(r.url.endsWith('/queued-job')){ledger.snapshot=creditSnapshot(20000,10000);return {ok:true,job:{id:'queued-job',status:'succeeded'}};}
  }});
  await h.generate();assert.match(h.text(),/queued-job · succeeded/);assert.equal(creditValue('Reserved'),'0.00 USD');assert.equal(creditValue('Consumed'),'0.01 USD');
 });
 test(format+' stale response cannot show a job in a different workflow',async t=>{
  let release;
  const h=await generationCreditHarness(t,format,{handler:r=>{if(r.method==='POST')return new Promise(resolve=>{release=resolve;});}});
  await h.generate();await act(async()=>[...document.querySelectorAll('tr')].find(r=>r.textContent.includes('Other workflow')).click());
  await act(async()=>release({ok:true,job:{id:'old-workflow-job',status:'succeeded'}}));
  assert.doesNotMatch(h.text(),/old-workflow-job|job queued/);
 });
}
test('generation does not request credit data without credits.view',async t=>{
 const h=await generationCreditHarness(t,'image',{noCredits:true});await h.generate();
 assert.equal(h.calls.filter(r=>r.url==='/api/agent-orchestrator/credits').length,0);
});
test('failed credit refresh hides outdated balance and offers read-only retry',async t=>{
 const h=await generationCreditHarness(t,'image',{handler:(r,ledger)=>{
  if(r.method==='POST'){ledger.snapshot={ok:false,error:'credit_read_unavailable'};return {ok:true,job:{id:'generated',status:'succeeded'}};}
 }});
 await h.generate();assert.equal(creditValue('Available'),undefined);assert.match(h.text(),/credit_read_unavailable/);
 h.ledger.snapshot=creditSnapshot(20000,10000);await h.click('Retry');assert.equal(creditValue('Available'),'0.02 USD');
 assert.equal(h.calls.filter(r=>r.method==='POST').length,1);
});
test('older credit read cannot overwrite the balance refreshed after a second operation',async t=>{
 let pending=false,release;
 const h=await generationCreditHarness(t,'image',{handler:r=>{
  if(pending&&r.url==='/api/agent-orchestrator/credits'){pending=false;return new Promise(resolve=>{release=resolve;});}
 }});
 pending=true;await h.generate();assert.match(h.text(),/Loading credit accounting/);
 await h.click('Generate proposals');assert.equal(creditValue('Consumed'),'0.01 USD');
 await act(async()=>release(creditSnapshot(30000,0)));assert.equal(creditValue('Available'),'0.02 USD');
});
test('proposal generation refreshes accounting',async t=>{
 const h=await generationCreditHarness(t,'image');await h.click('Generate proposals');
 assert.equal(creditValue('Consumed'),'0.01 USD');assert.equal(h.calls.filter(r=>r.method==='POST').length,1);
});
for(const component of ['AgentOrchestrator','CampaignJourney']) {
 test(component+' explains missing Meta credentials and keeps approval unavailable',async t=>{
  const draft={id:'draft',tenant_id:7,workflow_id:'workflow',status:'validation_failed',current_revision:1,contract_hash:'d'.repeat(64),label:'Fixture draft',notes:'Do not publish',validation_status:'failed',validation:{errors:[{code:'missing_credentials',field:'accounts.meta'}]}};
  const h=component==='AgentOrchestrator'?await creativeReviewHarness(t,{handler:r=>{
   if(r.url.includes('/campaign-drafts?'))return {ok:true,drafts:[draft]};
   if(r.url.endsWith('/campaign-drafts/draft/snapshot'))return {ok:true,status:'validation_failed',published:false,object_kind:'campaign_draft',draft};
  }}):await harness(t,(r,state)=>{if(r.url.endsWith('/validate')){state.draft={...state.draft,...draft};return {ok:true,draft:state.draft};}});
  if(component==='CampaignJourney'){await prepare(h);await h.click('Save campaign draft');await h.click('Validate saved campaign');}
  assert.match(h.text(),/Meta advertising credentials were not found/);assert.match(h.text(),/Settings & Integrations/);assert.match(h.text(),/adding AI credits will not resolve/);
  assert.ok(![...document.querySelectorAll('button')].some(b=>/^Approve (snapshot|saved campaign)$/.test(b.textContent)));
  if(component==='AgentOrchestrator'){await h.click('Preview snapshot');assert.match(h.text(),/Published: false/);}
  assert.ok(!h.calls.some(r=>r.url.includes('/settings')||r.url.includes('/publish')||r.url.endsWith('/approve')));
 });
}

test('campaign validation guidance preserves other errors and handles missing codes',()=>{
 const {campaignValidationMessage}=loader()('lib/campaignFeedback.ts');
 assert.match(campaignValidationMessage({code:'missing_credentials',field:'accounts.google'}),/Advertising credentials could not be verified/);
 assert.equal(campaignValidationMessage({code:'missing_creative',field:'creatives.0'}),'missing creative (creatives.0)');
 assert.equal(campaignValidationMessage({}),'Validation issue');
});


test('workspace draft fields keep visible labels and preserve the exact submitted contract',async t=>{
 let saved=null;
 const h=await creativeReviewHarness(t,{handler:r=>{
  if(r.url.includes('/campaign-drafts?'))return {ok:true,drafts:saved?[saved]:[]};
  if(r.url.endsWith('/campaign-drafts')&&r.method==='POST'){
   saved={...r.body,id:'saved-draft',status:'draft',current_revision:1,contract_hash:'d'.repeat(64)};
   return {ok:true,draft:saved};
  }
  if(r.url.endsWith('/saved-draft')&&r.method==='PATCH'){saved={...saved,...r.body};return {ok:true,draft:saved};}
 }});
 const labels={draft_label:'Campaign name',draft_notes:'Campaign notes',draft_landing:'Landing page URL',draft_account:'Advertising account reference',draft_asset:'Creative asset ID',draft_version:'Creative version',draft_hash:'Creative content hash',draft_budget:'Advertising budget (micros)',draft_start:'Campaign start date and time'};
 for(const [name,label]of Object.entries(labels)){
  const el=document.querySelector('[name="'+name+'"]');assert.ok(el,name);
  assert.equal(el.labels.length,1);assert.equal(el.labels[0].textContent,label);
  if(el.getAttribute('aria-describedby'))assert.ok(document.getElementById(el.getAttribute('aria-describedby')));
 }
 assert.match(h.text(),/Do not enter an API key or token here/);
 assert.match(h.text(),/separate from AI credits/);
 assert.equal(h.calls.filter(r=>r.method!=='GET').length,0);
 for(const [name,value]of Object.entries({draft_label:'Fixture draft',draft_notes:'Do not publish',draft_landing:'https://example.com/test',draft_account:'user_integrations',draft_asset:'approved-asset',draft_version:'3',draft_hash:'f'.repeat(64),draft_budget:'1250000',draft_start:'2030-01-01T10:00'}))await h.set(name,value);
 assert.match(document.getElementById('campaign-draft-budget-help').textContent,/1.25 USD/);
 await h.click('Create campaign draft');
 const writes=h.calls.filter(r=>r.method!=='GET');assert.equal(writes.length,1);
 const {contract,label,notes}=writes[0].body;
 assert.equal(label,'Fixture draft');assert.equal(notes,'Do not publish');
 assert.deepEqual(contract.budget,{amount_micros:1250000,currency:'USD'});
 assert.deepEqual(contract.creatives,[{kind:'creative_brief',asset_id:'approved-asset',version:3,content_hash:'f'.repeat(64)}]);
 assert.deepEqual(contract.accounts,[{platform:'meta',credential_ref:'user_integrations'}]);
 assert.equal(contract.destination.landing_page_url,'https://example.com/test');
 assert.equal(contract.schedule.start_at,new Date('2030-01-01T10:00').toISOString());
 for(const name of ['draft_label','draft_notes'])assert.equal(document.querySelector('[name="'+name+'"]').labels[0].textContent,labels[name]);
 await h.set('draft_notes','Updated draft notes');await h.click('Save label/notes');
 assert.deepEqual(h.calls.filter(r=>r.method==='PATCH')[0].body,{label:'Fixture draft',notes:'Updated draft notes'});
});

test('workspace budget guidance distinguishes zero, small amounts and invalid input without writes',async t=>{
 const h=await creativeReviewHarness(t,{readOnly:true});
 for(const [value,expected]of [['0','0.00 USD'],['1','0.000001 USD'],['1000000','1.00 USD'],['','Enter a non-negative whole number'],['-1','Enter a non-negative whole number'],['1.5','Enter a non-negative whole number']]){
  await h.set('draft_budget',value);
  assert.ok(document.getElementById('campaign-draft-budget-help').textContent.includes(expected));
 }
 assert.ok(![...document.querySelectorAll('button')].some(b=>b.textContent==='Create campaign draft'));
 assert.equal(h.calls.filter(r=>r.method!=='GET').length,0);
});

function snapshotDraftFixture(overrides={}) {
 return {id:'draft',tenant_id:7,workflow_id:'workflow',status:'ready_for_approval',current_revision:2,contract_hash:'d'.repeat(64),label:'Saved campaign',notes:'Saved notes',contract:{
  objective:'traffic',platforms:['meta','google'],budget:{amount_micros:0,currency:'USD'},destination:{landing_page_url:'https://example.com/saved'},schedule:{start_at:'2030-01-01T10:00:00Z',end_at:'2030-02-01T10:00:00Z'},geo:{countries:['US','ZA']},audience:{name:'Saved audience',notes:'<img src=x onerror=alert(1)>'},placements:[{type:'feed'}],tracking:{utm_source:'saved-source'},creatives:[{kind:'creative_brief',asset_id:'saved-asset',version:4,content_hash:'c'.repeat(64)}],accounts:[{credential_ref:'do-not-display-vault-reference'}],unknown_secret:'do-not-display-secret',
 },...overrides};
}
async function snapshotHarness(t,options={}) {
 const draft=snapshotDraftFixture(options.draft);
 const h=await creativeReviewHarness(t,{readOnly:options.readOnly,handler:r=>{
  if(options.handler){const result=options.handler(r,draft);if(result!==undefined)return result;}
  if(r.url.includes('/campaign-drafts?'))return {ok:true,drafts:r.url.endsWith('workflow_id=workflow')?[draft]:[]};
  if(r.url.endsWith('/snapshot'))return {ok:true,published:false,draft};
 }});return {...h,draft};
}
test('snapshot review renders saved contract fields, zero and escaped content with no writes',async t=>{
 const h=await snapshotHarness(t,{readOnly:true});
 await h.set('draft_label','Unsaved label');await h.set('draft_notes','Unsaved notes');
 await h.click('Preview snapshot');
 const review=document.querySelector('[aria-label="Saved campaign snapshot"]');assert.ok(review);
 for(const value of ['Saved campaign','Saved notes','meta, google','0.00 USD','https://example.com/saved','2030-01-01T10:00:00Z','2030-02-01T10:00:00Z','US, ZA','Saved audience','saved-asset','version 4','saved-source','<img src=x onerror=alert(1)>','Published: false'])assert.ok(review.textContent.includes(value),value);
 for(const value of ['Unsaved label','Unsaved notes','do-not-display-vault-reference','do-not-display-secret'])assert.ok(!review.textContent.includes(value),value);
 assert.equal(review.querySelector('img'),null);assert.equal(review.querySelector('a'),null);
 assert.equal(h.calls.filter(r=>r.method!=='GET').length,0);
 assert.equal(document.querySelector('[name="draft_label"]').value,'Unsaved label');
});
test('snapshot review distinguishes missing budget from one micro',async t=>{
 const h=await snapshotHarness(t);h.draft.contract.budget={amount_micros:1,currency:'USD'};
 await h.click('Preview snapshot');assert.match(h.text(),/0.000001 USD/);
 delete h.draft.contract.budget.amount_micros;
 await h.click('Preview snapshot');assert.match(h.text(),/Not provided USD/);
 assert.doesNotMatch(h.text(),/0.000001 USD/);
});
for(const change of [{id:'other'},{tenant_id:8},{workflow_id:'other'},{current_revision:3},{contract_hash:'e'.repeat(64)},{status:'cancelled'}]){
 test('snapshot refuses mismatched saved identity '+Object.keys(change)[0],async t=>{
  const h=await snapshotHarness(t,{handler:(r,draft)=>r.url.endsWith('/snapshot')?{ok:true,published:false,draft:{...draft,...change}}:undefined});
  await h.click('Preview snapshot');assert.equal(document.querySelector('[aria-label="Saved campaign snapshot"]'),null);
  assert.match(h.text(),/Reload the workspace before reviewing approval/);
  assert.equal(h.calls.filter(r=>r.method!=='GET').length,0);
 });
}
test('failed snapshot refresh removes previously displayed saved data',async t=>{
 let fail=false;const h=await snapshotHarness(t,{handler:r=>fail&&r.url.endsWith('/snapshot')?{ok:false,error:'permission_denied'}:undefined});
 await h.click('Preview snapshot');assert.ok(document.querySelector('[aria-label="Saved campaign snapshot"]'));
 fail=true;await h.click('Preview snapshot');assert.equal(document.querySelector('[aria-label="Saved campaign snapshot"]'),null);assert.match(h.text(),/permission_denied/);
});
test('late snapshot from a previous workspace is discarded',async t=>{
 let release;const h=await snapshotHarness(t,{handler:(r,draft)=>r.url.endsWith('/snapshot')?new Promise(resolve=>{release=()=>resolve({ok:true,published:false,draft});}):undefined});
 await h.click('Preview snapshot');await act(async()=>[...document.querySelectorAll('tr')].find(row=>row.textContent.includes('Other workflow')).click());
 await act(async()=>release());assert.equal(document.querySelector('[aria-label="Saved campaign snapshot"]'),null);
 assert.doesNotMatch(h.text(),/Saved campaign snapshot loaded/);assert.match(h.text(),/Other workflow/);
});
