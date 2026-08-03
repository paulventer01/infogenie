// Lead classification — qualified / junk / sales_opportunity via GLM 5.2 (or fallback).

const { chatForCategory } = require('../ai/chat_router');

const SYS = `You are a performance-marketing lead analyst. Classify inbound leads from paid ads.

Tiers:
- sales_opportunity — real buyer, strong intent, worth immediate sales follow-up
- qualified — legitimate enquiry, nurture or schedule a call
- junk — spam, wrong number, bot, job seeker, irrelevant, or no commercial intent

Return ONLY valid JSON:
{
  "score": number (0-100),
  "tier": "sales_opportunity"|"qualified"|"junk",
  "reasoning": string,
  "signals": [string],
  "suggestedActions": [string]
}`;

async function classifyLead(lead, tenantId) {
  const user = `Channel: ${lead.channel || 'unknown'}
Contact: ${lead.contact_name || '(none)'} / ${lead.contact_email || lead.contact_phone || '(none)'}
Message: ${lead.message || '(none)'}
Source page: ${lead.page_url || '(none)'}
Attribution: platform=${lead.platform || 'unknown'}, campaign=${lead.utm_campaign || 'unknown'}, term=${lead.utm_term || 'unknown'}
Raw: ${JSON.stringify(lead.raw_payload || {}).slice(0, 1500)}`;

  const result = await chatForCategory('analysis', [
    { role: 'system', content: SYS },
    { role: 'user', content: user },
  ], {
    tenantId,
    max_tokens: 700,
    temperature: 0.2,
    response_format: { type: 'json_object' },
  });

  if (!result || !result.content) {
    return {
      score: 50,
      tier: 'qualified',
      reasoning: 'Classifier unavailable — defaulting to qualified for manual review.',
      signals: [],
      suggestedActions: ['Review manually in the specialist queue'],
      model: null,
    };
  }

  try {
    const j = JSON.parse(result.content);
    const tier = ['sales_opportunity', 'qualified', 'junk'].includes(j.tier) ? j.tier : 'qualified';
    const score = typeof j.score === 'number' ? Math.max(0, Math.min(100, j.score)) : 50;
    return {
      score,
      tier,
      reasoning: String(j.reasoning || '').slice(0, 2000),
      signals: Array.isArray(j.signals) ? j.signals.slice(0, 8) : [],
      suggestedActions: Array.isArray(j.suggestedActions) ? j.suggestedActions.slice(0, 5) : [],
      model: result.model || result.provider,
    };
  } catch {
    return {
      score: 50,
      tier: 'qualified',
      reasoning: 'Classifier returned invalid JSON — queued for manual review.',
      signals: [],
      suggestedActions: ['Review manually'],
      model: result.model,
    };
  }
}

module.exports = { classifyLead };
