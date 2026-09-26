'use strict';
const {approvalText}=require('./approval_text');
const {MAX_OUTPUT_SCAN_CHARS}=require('../ai_governance/output_gate');

// Preserve key coverage, then scan a second stream of decoded leaf values so
// JSON syntax/field names cannot hide a phrase split across retained fields.
function generationText(row) {
  const keyed=approvalText(row), leaves=[];
  let length=keyed.length, nodes=0;
  function visit(value,depth=0) {
    if(++nodes>20000||depth>40) throw Error('invalid_content');
    if(value==null) return;
    if(typeof value==='object') {
      for(const item of Object.values(value)) visit(item,depth+1);
      return;
    }
    const text=String(value);
    length+=text.length+1;
    if(length>MAX_OUTPUT_SCAN_CHARS) throw Error('invalid_content');
    leaves.push(text);
  }
  visit({title:row.title,proposal:row.proposal,simulation:row.simulation});
  return [keyed,...leaves].join('\n');
}
module.exports={generationText};
