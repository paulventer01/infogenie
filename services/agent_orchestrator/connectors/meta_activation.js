'use strict';

// Narrow activation-only Meta surface. Provider identifiers are accepted only
// as a complete authoritative ledger and never escape in normalized results.
const https = require('https');
const { metaGraphVersion } = require('./meta_graph_version');
const GRAPH_ORIGIN = 'https://graph.facebook.com';
const SEQUENCE = Object.freeze(['campaign', 'adset', 'creative', 'ad']);
const TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 16 * 1024;
const FORBIDDEN = Object.freeze(['providerObjectId','provider_object_id','accountId','account_id','url','apiVersion','api_version','method','fields','status','payload','body']);
function invalid(code) { const e=new Error(code); e.code=code; throw e; }
function account(value) { return String(value||'').replace(/^act_/,''); }
function validate(input) {
  if (!input || typeof input!=='object') invalid('invalid_activation_input');
  for (const key of FORBIDDEN) if (Object.hasOwn(input,key)) invalid('caller_provider_control_rejected');
  if (typeof input.accessToken!=='string' || !input.accessToken) invalid('missing_access_token');
  if (typeof input.adAccountId!=='string' || !input.adAccountId) invalid('missing_account_binding');
  if (!Array.isArray(input.ledgerObjects) || input.ledgerObjects.length!==4) invalid('invalid_ledger_lineage');
  const byKind=Object.create(null);
  for (const row of input.ledgerObjects) {
    if (!row || !SEQUENCE.includes(row.object_kind) || byKind[row.object_kind] || typeof row.provider_object_id!=='string' || !row.provider_object_id) invalid('invalid_ledger_lineage');
    byKind[row.object_kind]=row;
  }
  if (SEQUENCE.some(k=>!byKind[k])) invalid('invalid_ledger_lineage');
  if (input.transport!==undefined && typeof input.transport!=='function') invalid('invalid_transport');
  if (input.onOutcome!==undefined && typeof input.onOutcome!=='function') invalid('invalid_outcome_sink');
  return byKind;
}
function defaultTransport(options) {
  const url=new URL(options.url);
  if(url.origin!==GRAPH_ORIGIN || !['GET','POST'].includes(options.method)) invalid('unsafe_meta_request');
  return new Promise(resolve=>{
    let settled=false; const finish=v=>{if(!settled){settled=true;resolve(v);}};
    const req=https.request(url,{method:options.method,headers:options.headers,timeout:options.timeoutMs},res=>{
      const chunks=[]; let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>options.maxResponseBytes){req.destroy();finish({oversized:true});}else chunks.push(chunk);});
      res.on('end',()=>{if(settled)return;if(res.statusCode>=300&&res.statusCode<400)return finish({redirect:true});try{return finish({status:res.statusCode,json:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch(_){return finish({status:res.statusCode,malformed:true});}});
    });
    req.on('timeout',()=>{req.destroy();finish({transportError:'timeout',mayHaveActed:options.method==='POST'});});
    req.on('error',()=>finish({transportError:'unavailable',mayHaveActed:options.method==='POST'}));
    req.end(options.body);
  });
}
function event(kind,phase,outcome,at){return Object.freeze({object_kind:kind,phase,outcome,occurred_at:at});}
function failure(res,mutation){
  if(mutation&&res&&res.transportError&&res.mayHaveActed!==false)return 'outcome_unknown';
  if(res&&res.status===401)return 'provider_unauthorized'; if(res&&res.status===403)return 'provider_forbidden';
  if(res&&res.status===429)return 'rate_limited'; if(res&&res.redirect)return 'redirect_rejected'; if(res&&res.oversized)return 'response_too_large';
  if(res&&(res.malformed||(res.status>=200&&res.status<300)))return 'invalid_provider_response';
  if(res&&(res.transportError||res.status>=500))return 'provider_unavailable'; return 'provider_rejected';
}
function confirmed(kind,res,byKind,expectedAccount){
  if(!res||res.status<200||res.status>=300||!res.json||typeof res.json!=='object')return false;
  if(kind!=='creative')return res.json.success===true;
  const status=String(res.json.effective_status||res.json.status||'').toUpperCase();
  return res.json.id===byKind.creative.provider_object_id && account(res.json.account_id)===account(expectedAccount) && status==='PAUSED';
}
async function activateMetaGraph(input){
  const byKind=validate(input), transport=input.transport||defaultTransport, now=input.now||(()=>new Date().toISOString());
  const events=[],outcomes=[]; let changed=0;
  const emit=async e=>{events.push(e);if(input.onOutcome)await input.onOutcome(e);};
  for(const kind of SEQUENCE){
    const mutation=kind!=='creative', url=new URL(`/${metaGraphVersion()}/${encodeURIComponent(byKind[kind].provider_object_id)}`,GRAPH_ORIGIN);
    const body=mutation?'status=ACTIVE':undefined; if(!mutation)url.searchParams.set('fields','id,account_id,status,effective_status');
    await emit(event(kind,'attempted',mutation?'activation_attempted':'verification_attempted',now()));
    let res; try{res=await transport({url:url.toString(),method:mutation?'POST':'GET',body,headers:{Authorization:`Bearer ${input.accessToken}`,Accept:'application/json',...(mutation?{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}:{})},timeoutMs:TIMEOUT_MS,maxResponseBytes:MAX_RESPONSE_BYTES});}
    catch(_){res={transportError:'unavailable',mayHaveActed:mutation};}
    if(!confirmed(kind,res,byKind,input.adAccountId)){
      const outcome=failure(res||{},mutation), settled=event(kind,'settled',outcome,now()); outcomes.push(settled);await emit(settled);
      return Object.freeze({state:outcome==='outcome_unknown'?'outcome_unknown':changed?'partial_failure':'failed',outcomes:Object.freeze(outcomes),events:Object.freeze(events),completed_at:now()});
    }
    if(mutation)changed+=1; const settled=event(kind,'settled',mutation?'activated':'unchanged_non_delivering',now());outcomes.push(settled);await emit(settled);
  }
  return Object.freeze({state:'activated',outcomes:Object.freeze(outcomes),events:Object.freeze(events),completed_at:now()});
}
module.exports={GRAPH_ORIGIN,SEQUENCE,TIMEOUT_MS,MAX_RESPONSE_BYTES,activateMetaGraph};
