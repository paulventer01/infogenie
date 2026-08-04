/**
 * Which AI Provider categories a given endpoint/model can serve.
 *
 * Policy (product requirement): place each BYO provider on every tile it can
 * usefully serve — chat LLMs cover Writing, Analysis, and Audio (scripts /
 * voiceover copy); multimodal models also cover Vision. Dedicated TTS
 * endpoints stay Audio-only.
 */

const ALL = ['writing', 'analysis', 'vision', 'audio'];

function _blob(p = {}) {
  return [p.name, p.model, p.base_url, p.notes].filter(Boolean).join(' ').toLowerCase();
}

function isAudioOnly(p) {
  const s = _blob(p);
  return /\b(tts|elevenlabs|eleven\.labs|speechify|openai\/tts|audio\.speech|whisper-tts|vocode)\b/.test(s)
    || /\/audio\/speech\b/.test(s);
}

function isVisionCapable(p) {
  const s = _blob(p);
  // Explicit vision / multimodal flags
  if (/\b(vision|gpt-4o|gpt-4\.1|gpt-5|claude-3|claude-4|claude-sonnet|claude-opus|gemini|llava|moondream|qwen.?vl|glm-4v|glm-5v|kimi-k3|moonshot|mistral-small.*24|pixtral)\b/.test(s)) {
    return true;
  }
  // Azure OpenAI deployments are often multimodal when using gpt-4o class
  if (/openai\.azure\.com/.test(s) && /gpt-4|gpt-5/.test(s)) return true;
  return false;
}

function isChatLlm(p) {
  if (isAudioOnly(p)) return false;
  const s = _blob(p);
  // Anything OpenAI-compatible chat endpoint counts unless clearly TTS-only
  return !!p.base_url || /\b(gpt|claude|llama|mistral|deepseek|glm|kimi|qwen|gemini|ollama)\b/.test(s);
}

/**
 * @param {{ name?: string, model?: string, base_url?: string, notes?: string }} provider
 * @returns {string[]}
 */
function compatibleCategories(provider) {
  if (isAudioOnly(provider)) return ['audio'];
  // Product requirement: chat / BYO presets appear on every tile so they can
  // cascade together under Writing · Analysis · Vision · Audio.
  if (isChatLlm(provider) || isVisionCapable(provider)) {
    return [...ALL];
  }
  return [];
}

function isCompatible(provider, category) {
  return compatibleCategories(provider).includes(category);
}

module.exports = {
  ALL_CATEGORIES: ALL,
  compatibleCategories,
  isCompatible,
  isAudioOnly,
  isVisionCapable,
  isChatLlm,
};
