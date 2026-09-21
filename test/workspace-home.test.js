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
    new Function('exports','require','module',outputText)(mod.exports,id=>id.startsWith('@/lib/')?load(id.slice(2)+'.ts')
      :id.endsWith('.module.css')?{default:{}}:id==='next/link'?{default:({children,...props})=>React.createElement('a',props,children)}:require(id),mod);
    cache.set(file,mod.exports);return mod.exports;
  }
  return load;
}
const client=id=>({id,name:'Client '+id,status:'active',slug:null,website:null});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {resolve,promise};};
async function harness(t,handler=()=>undefined){
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true});
  const state={tenant:7,permissions:['tenant.settings.manage'],clients:[client(11),client(22)]};
  const calls=[];
  const values={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT:true,fetch:async(url,opts={})=>{
      calls.push({url,method:opts.method||'GET'});
      let body=await handler(url,state);
      if(body===undefined){
        if(url==='/api/tenants/me')body={ok:true,user:{id:1},activeTenantId:state.tenant,memberships:[{tenantId:state.tenant}]};
        else if(url==='/api/tenants/active')body={ok:true,tenant:{id:state.tenant,status:'active'},permissions:state.permissions,isPlatformAdmin:false};
        else if(url.includes('/clients?'))body={ok:true,clients:state.clients,has_more:false,next_cursor:null};
        else if(url.endsWith('/profile'))body={ok:true,client:client(Number(url.split('/').at(-2))),configured:false,profile:null};
        else throw Error('Unexpected request '+url);
      }
      return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>body};
    }};
  const previous=new Map(Object.keys(values).map(k=>[k,Object.getOwnPropertyDescriptor(global,k)]));
  for(const [key,value] of Object.entries(values))Object.defineProperty(global,key,{value,configurable:true,writable:true});
  const root=require('react-dom/client').createRoot(document.getElementById('root'));
  t.after(async()=>{await act(async()=>root.unmount());dom.window.close();for(const [k,d] of previous){if(d)Object.defineProperty(global,k,d);else delete global[k];}});
  await act(async()=>root.render(React.createElement(loader()('components/features/manage/WorkspaceHome.tsx').default)));
  return {state,calls,text:()=>document.body.textContent,select:async id=>act(async()=>{
    const el=document.querySelector('select');assert.ok(el);
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(el,String(id));
    el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  }),event:async()=>act(async()=>window.dispatchEvent(new dom.window.Event('focus'))),
    resolve:async(p,v)=>act(async()=>p.resolve(v)),links:()=>[...document.querySelectorAll('a')].map(a=>a.getAttribute('href'))};
}
test('root is the React workspace while analysis bookmarks retain their destination',()=>{
  const routes=loader()('lib/viewRoutes.ts');
  assert.equal(routes.pathToViewId('/'),'workspace-home');assert.equal(routes.viewToPath('workspace-home'),'/');
  assert.equal(routes.pathToViewId('/analyse'),'home');assert.equal(routes.viewToPath('home'),'/analyse');
  assert.equal(routes.pathToViewId('/manage/client-reporting'),'client-reporting');
  assert.equal(loader()('lib/migratedViews.ts').isMigratedView('workspace-home'),true);
});
test('real client selection has setup guidance and a scoped reporting link without writes',async t=>{
  const h=await harness(t);await h.select(11);
  assert.match(h.text(),/Setup needed/);assert.ok(h.links().includes('/manage/client-reporting?client=11'));
  assert.ok(h.calls.every(c=>c.method==='GET'));assert.doesNotMatch(h.text(),/No approvals|0 pending/);
});
test('access rechecks preserve the selected client and scoped reporting link',async t=>{
  const h=await harness(t);await h.select(11);await h.event();
  assert.match(h.text(),/Client 11/);assert.ok(h.links().includes('/manage/client-reporting?client=11'));
  assert.equal(h.calls.filter(c=>c.url.endsWith('/clients/11/profile')).length,2);
});
test('non-admin members get a useful role-filtered workspace without client reporting reads',async t=>{
  const h=await harness(t,(url,state)=>{if(url==='/api/tenants/active')state.permissions=['dashboard.view','reports.view','orchestrator.workflows.view'];});
  assert.doesNotMatch(h.text(),/Access denied/);
  assert.ok(h.links().includes('/analyse'));assert.ok(h.links().includes('/manage/marketing-brief'));
  assert.ok(h.links().includes('/manage/campaign-journey'));assert.ok(!h.links().includes('/manage/client-reporting'));
  assert.equal(h.calls.filter(c=>c.url.startsWith('/api/client-reporting')).length,0);
  assert.match(h.text(),/No client reporting data has been loaded/);
});
test('missing and malformed client data have distinct honest states',async t=>{
  let malformed=false;
  const h=await harness(t,url=>url.includes('/clients?')?{ok:true,clients:malformed?[{id:1}]:[],has_more:false,next_cursor:null}:undefined);
  assert.match(h.text(),/No active reporting clients/);malformed=true;await h.event();
  assert.match(h.text(),/could not be verified/);assert.doesNotMatch(h.text(),/No active reporting clients/);
});
test('client profile failures do not leave another client or setup success visible',async t=>{
  const h=await harness(t,url=>url.includes('/clients/22/profile')?{ok:false,error:'permission_denied'}:undefined);
  await h.select(11);await h.select(22);
  assert.match(h.text(),/permission_denied/);assert.doesNotMatch(h.text(),/Client 11|Client 22|Setup needed/);
});
test('late data from the previous workspace is discarded after a context switch',async t=>{
  const pending=deferred();
  const h=await harness(t,url=>url.includes('/clients/11/profile')?pending.promise:undefined);
  await h.select(11);h.state.tenant=8;await h.event();
  await h.resolve(pending,{ok:true,client:{...client(11),name:'Old workspace secret'},configured:false,profile:null});
  assert.doesNotMatch(h.text(),/Old workspace secret|Client 11|Client 22/);
  assert.match(h.text(),/changed/);
});
test('revoked permission clears previously loaded clients',async t=>{
  const h=await harness(t);h.state.permissions=[];await h.event();
  assert.doesNotMatch(h.text(),/Access denied|Client 11|Client 22/);
  assert.match(h.text(),/No client reporting data has been loaded/);
  assert.ok(!h.links().includes('/manage/client-reporting'));
});
test('a different client in a profile response is rejected',async t=>{
  const h=await harness(t,url=>url.includes('/clients/11/profile')?{ok:true,client:client(22),configured:false,profile:null}:undefined);
  await h.select(11);assert.match(h.text(),/could not be verified/);assert.doesNotMatch(h.text(),/Setup needed/);
});
