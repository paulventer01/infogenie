'use strict';
const {MAX_OUTPUT_SCAN_CHARS}=require('./output_gate');

// Scan decoded JSON keys and leaves, plus a key-free stream so field names do
// not interrupt phrases. Never truncate a retained suffix, even in warning mode.
function jsonGateText(value) {
  const keyed=[], leaves=[];
  let length=0, nodes=0;
  function append(list,text) {
    length+=text.length+1;
    if(length>MAX_OUTPUT_SCAN_CHARS) throw Error('scan_limit');
    list.push(text);
  }
  function visit(item,depth=0) {
    if(++nodes>20000||depth>40) throw Error('scan_limit');
    if(item==null) return;
    if(typeof item==='object') {
      for(const [key,child] of Object.entries(item)) {
        if(!Array.isArray(item)) { if(++nodes>20000) throw Error('scan_limit'); append(keyed,key); }
        visit(child,depth+1);
      }
    } else {
      append(keyed,String(item));append(leaves,String(item));
    }
  }
  try {visit(value);return [...keyed,...leaves].join('\n');}
  catch (_) {return null;}
}
module.exports={jsonGateText};
