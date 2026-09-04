'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const start=source.indexOf('const _OWNER_GATE_ALLOW = ['),end=source.indexOf('\n];',start),allow=source.slice(start,end);
const patterns=allow.split('\n').map(line=>line.match(/^\s*(\/\^.*?\/),/)?.[1]).filter(Boolean).map(x=>new RegExp(x.slice(1,-1)));
const exempt=p=>patterns.some(rx=>rx.test(p));
test('Google activation capability routes narrowly bypass only the legacy owner gate',()=>{
 assert.match(allow,/\/\^\\\/api\\\/agent-orchestrator\\\/google-ads-activation-capabilities\(\?:\\\/\|\$\)\//);
 for(const p of ['/api/agent-orchestrator/google-ads-activation-capabilities','/api/agent-orchestrator/google-ads-activation-capabilities/gaac_1/reserve'])assert.equal(exempt(p),true);
 for(const p of ['/api/agent-orchestrator/google-ads-activation-capabilities-export','/api/agent-orchestrator/google-ads-activation-capabilitiesx','/api/agent-orchestrator'])assert.equal(exempt(p),false);
});
test('the narrow exemption does not create a human, permission, or owner bypass',()=>{
 const api=require('../services/agent_orchestrator/google_ads_activation_capabilities_api');
 assert.equal(api._human({user:{id:2,isOwner:false},session:{userId:2},sessionID:'sid'}),true);
 assert.equal(api._grant({tenantRole:{permissions:['advertising.campaign.activate']}}),true);
 assert.equal(api._grant({user:{isOwner:true},tenantRole:{permissions:[]}}),false);
 assert.equal(api._human({user:{id:1,isOwner:true},viaApiKey:true,session:{userId:1},sessionID:'sid'}),false);
});
