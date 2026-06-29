const express = require('express');
const _https  = require('https');
const { normalizeChatParams } = require('../ai_compat');
const router  = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

const MODELS = {
  'gpt-4o':        { provider:'openai',    label:'GPT-4o',              color:'#10A37F' },
  'gpt-5-mini':   { provider:'openai',    label:'GPT-5 mini',          color:'#10A37F' },
  'claude-3-5-sonnet-20241022': { provider:'anthropic', label:'Claude 3.5 Sonnet', color:'#D97706' },
  'claude-3-haiku-20240307':    { provider:'anthropic', label:'Claude 3 Haiku',    color:'#D97706' },
  'gemini-1.5-flash':           { provider:'google',    label:'Gemini 1.5 Flash',  color:'#4285F4' },
  'gemini-1.5-pro':             { provider:'google',    label:'Gemini 1.5 Pro',    color:'#4285F4' },
  'llama-3.1-8b-instruct':      { provider:'cloudflare',label:'Llama 3.1 8B',      color:'#6366F1' },
  'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo': { provider:'rapidapi_llama', label:'Llama 3.2 Vision 11B', color:'#0064E0' },
};

const _LLAMA_HOST = 'meta-llama-3-2-vision.p.rapidapi.com';
function _hasLlama() {
  const k = process.env.RAPIDAPI_KEY;
  return !!(k && !/^_DUMMY/i.test(k));
}
function _callLlama(model, messages, max_tokens) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify({ model, messages, max_tokens: max_tokens || 800, temperature: 0.7 });
  const start = Date.now();
  return new Promise(resolve => {
    const req = _https.request({
      hostname: _LLAMA_HOST, path: '/chat/completions', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-rapidapi-key': key,
        'x-rapidapi-host': _LLAMA_HOST,
      }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          if (r.statusCode !== 200) return resolve(null);
          const j = JSON.parse(d);
          resolve({ text: j.choices[0].message.content, latency_ms: Date.now() - start, tokens: j.usage?.completion_tokens || 0 });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => req.destroy());
    req.write(body); req.end();
  });
}

function _callOpenAI(model, messages, max_tokens) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify(normalizeChatParams({ model, messages, temperature:0.7, max_tokens: max_tokens||800 }));
  const start = Date.now();
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { if (r.statusCode!==200) return resolve(null); const j=JSON.parse(d); resolve({ text:j.choices[0].message.content, latency_ms:Date.now()-start, tokens:j.usage?.completion_tokens||0 }); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(60000,()=>req.destroy()); req.write(body); req.end();
  });
}

function _callAnthropic(model, messages, max_tokens) {
  const key = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const sys = messages.find(m=>m.role==='system')?.content || '';
  const userMsgs = messages.filter(m=>m.role!=='system');
  const body = JSON.stringify({ model, system:sys, messages:userMsgs, max_tokens:max_tokens||800 });
  const start = Date.now();
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.anthropic.com', path:'/v1/messages', method:'POST', headers:{ 'x-api-key':key, 'anthropic-version':'2023-06-01', 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { if (r.statusCode!==200) return resolve(null); const j=JSON.parse(d); resolve({ text:j.content?.[0]?.text||'', latency_ms:Date.now()-start, tokens:j.usage?.output_tokens||0 }); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(60000,()=>req.destroy()); req.write(body); req.end();
  });
}

function _callGemini(model, messages, max_tokens) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const parts = messages.map(m=>({ role:m.role==='assistant'?'model':'user', parts:[{text:m.content}] })).filter(m=>m.role!=='system');
  const body = JSON.stringify({ contents:parts, generationConfig:{ temperature:0.7, maxOutputTokens:max_tokens||800 } });
  const modelPath = model.replace('.','-');
  const start = Date.now();
  return new Promise(resolve => {
    const req = _https.request({ hostname:'generativelanguage.googleapis.com', path:`/v1beta/models/${modelPath}:generateContent?key=${key}`, method:'POST', headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { if (r.statusCode!==200) return resolve(null); const j=JSON.parse(d); resolve({ text:j.candidates?.[0]?.content?.parts?.[0]?.text||'', latency_ms:Date.now()-start, tokens:j.usageMetadata?.candidatesTokenCount||0 }); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(60000,()=>req.destroy()); req.write(body); req.end();
  });
}

async function _judge(prompt, task_type, results) {
  const resultsText = results.filter(r=>r.output).map((r,i)=>(`[Model ${i+1}: ${r.label}]\n${r.output.slice(0,400)}`)).join('\n\n---\n\n');
  if (!resultsText.trim()) return null;
  const sys = `You are an AI output quality judge. Compare the model outputs for a given task and return JSON:
{"winner":"<model label that won>","scores":[{"model":"<label>","quality":8,"creativity":7,"accuracy":9,"conciseness":8,"overall":8}],"rationale":"<2-3 sentence explanation of the winner and why>"}
Score each dimension 1-10. Be objective and specific.`;
  const user = `Task type: ${task_type}\nOriginal prompt: ${prompt.slice(0,300)}\n\nModel outputs:\n${resultsText}`;
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const body = JSON.stringify(normalizeChatParams({ model:'gpt-5-mini', messages:[{role:'system',content:sys},{role:'user',content:user}], response_format:{type:'json_object'}, temperature:0.3, max_tokens:600 }));
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { const j=JSON.parse(d); resolve(JSON.parse(j.choices[0].message.content)); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(30000,()=>req.destroy()); req.write(body); req.end();
  });
}

router.get('/models', (req, res) => {
  const avail = {
    openai:         !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY && !/^_DUMMY/i.test(process.env.AI_INTEGRATIONS_OPENAI_API_KEY||'')),
    anthropic:      !!(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !/^_DUMMY/i.test(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY||'')),
    google:         !!(process.env.GEMINI_API_KEY && !/^_DUMMY/i.test(process.env.GEMINI_API_KEY||'')),
    cloudflare:     !!(process.env.CLOUDFLARE_AI_TOKEN && !/^_DUMMY/i.test(process.env.CLOUDFLARE_AI_TOKEN||'')),
    rapidapi_llama: _hasLlama(),
  };
  res.json({ ok:true, models: Object.entries(MODELS).map(([id,m])=>({ id, label:m.label, color:m.color, provider:m.provider, available:avail[m.provider]||false })) });
});

router.post('/run', async (req, res) => {
  const { prompt, task_type='general', models:selectedModels=['gpt-5-mini','claude-3-haiku-20240307','gemini-1.5-flash'], max_tokens=600, system_prompt='' } = req.body || {};
  if (!prompt || prompt.trim().length < 5) return _err(res,400,'prompt_required');
  const messages = system_prompt ? [{role:'system',content:system_prompt},{role:'user',content:prompt}] : [{role:'user',content:prompt}];
  const tasks = (selectedModels||[]).slice(0,5).map(async modelId => {
    const meta = MODELS[modelId];
    if (!meta) return { model_id:modelId, label:modelId, error:'unknown_model', output:null };
    let result = null;
    if (meta.provider==='openai') result = await _callOpenAI(modelId, messages, max_tokens);
    else if (meta.provider==='anthropic') result = await _callAnthropic(modelId, messages, max_tokens);
    else if (meta.provider==='google') result = await _callGemini(modelId, messages, max_tokens);
    else if (meta.provider==='rapidapi_llama') result = await _callLlama(modelId, messages, max_tokens);
    if (!result) return { model_id:modelId, label:meta.label, color:meta.color, provider:meta.provider, output:null, error:'unavailable_or_not_configured', latency_ms:0, tokens:0 };
    return { model_id:modelId, label:meta.label, color:meta.color, provider:meta.provider, output:result.text, latency_ms:result.latency_ms, tokens:result.tokens, error:null };
  });
  const results = await Promise.all(tasks);
  const judgment = await _judge(prompt, task_type, results);
  res.json({ ok:true, prompt, task_type, results, judgment });
});

module.exports = router;
