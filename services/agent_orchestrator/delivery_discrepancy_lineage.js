'use strict';

// Digest-only validation for consumers that must not load provider transports or
// credential-secret infrastructure. Provider IDs are intentionally neither
// accepted nor returned.
const crypto=require('crypto');
const KINDS=Object.freeze(['campaign','adset','creative','ad']);
const HEX64=/^[0-9a-f]{64}$/;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)
  &&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
function invalid(){const e=new Error('invalid_ledger_lineage');e.code='invalid_ledger_lineage';throw e;}
function validate(rows,binding={}){
  if(!Array.isArray(rows)||rows.length!==4||!HEX64.test(String(binding.account_fingerprint||''))
    ||!HEX64.test(String(binding.snapshot_hash||'')))invalid();
  const by=Object.fromEntries(rows.map(row=>[row.object_kind,row]));
  if(Object.keys(by).length!==4||KINDS.some(kind=>!by[kind]))invalid();
  for(const row of rows)if(!HEX64.test(String(row.provider_object_id_digest||''))||row.compensated
    ||!same(row.account_fingerprint,binding.account_fingerprint)||!same(row.snapshot_hash,binding.snapshot_hash))invalid();
  if(by.campaign.parent_campaign_digest!==null||by.campaign.parent_adset_digest!==null||by.campaign.parent_creative_digest!==null
    ||!same(by.adset.parent_campaign_digest,by.campaign.provider_object_id_digest)||by.adset.parent_adset_digest!==null||by.adset.parent_creative_digest!==null
    ||!same(by.creative.parent_campaign_digest,by.campaign.provider_object_id_digest)||by.creative.parent_adset_digest!==null||by.creative.parent_creative_digest!==null
    ||!same(by.ad.parent_campaign_digest,by.campaign.provider_object_id_digest)||!same(by.ad.parent_adset_digest,by.adset.provider_object_id_digest)
    ||!same(by.ad.parent_creative_digest,by.creative.provider_object_id_digest))invalid();
  return hash(KINDS.map(kind=>{const row=by[kind];return `${kind}:${row.provider_object_id_digest}:${row.parent_campaign_digest||''}:${row.parent_adset_digest||''}:${row.parent_creative_digest||''}`;}).join('|'));
}
module.exports={validate};
