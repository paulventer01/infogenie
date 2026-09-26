'use strict';
const {MAX_OUTPUT_SCAN_CHARS}=require('./output_gate');

// Scan decoded JSON keys and leaves, plus a key-free stream so field names do
// not interrupt phrases. Never truncate a retained suffix, even in warning mode.
function jsonGateText(value) {
  const keyed=[], leaves=[];
  // Reserve the representation separator before visiting any source text.
  let length=3, nodes=0;
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
  // Dot-based compliance rules must also match across fields and decoded line breaks.
  // Bound the original text first; normalization never makes oversized output admissible.
  // Keep duplicate representations apart: neither dot nor whitespace-based
  // phrases may wrap from the final value back to the first value.
  try {
    visit(value);
    return [keyed,leaves].map(parts=>parts.join(' ').replace(/\s+/g,' ')).join('\n|\n');
  }
  catch (_) {return null;}
}
module.exports={jsonGateText};
