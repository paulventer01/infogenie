'use strict';

const { FORBIDDEN_KEYS } = require('./research_contracts');
const { EXTRA_FORBIDDEN_KEYS } = require('./creative_contracts');

const CONTRACT_VERSION = 'video_generation_v1';
const ASPECT = Object.freeze(['9:16', '1:1', '16:9', '4:5']);
const FPS = Object.freeze([24, 25, 30]);
const FORMATS = Object.freeze(['mp4', 'webm']);
const MIME = Object.freeze({ mp4: 'video/mp4', webm: 'video/webm' });
const DIMS = Object.freeze({
  '9:16': [1080, 1920], '1:1': [1080, 1080], '16:9': [1920, 1080], '4:5': [1080, 1350],
});
const ASSET_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const STORAGE_RE = /^orchestrator\/video\/([0-9]+)\/([A-Za-z0-9_.-]+)$/;
const DURATION = Object.freeze({ min: 1000, max: 60000 });
const MAX_SCENES = 12;
const MAX_JSON = 16384;
const TEXT = 2000;

const EXTRA_FORBIDDEN = Object.freeze([
  'credentials', 'tokens', 'url', 'urls', 'raw_prompt', 'authorization',
  'signed_url', 'signed_urls', 'signedurl', 'https', 'bytes', 'buffer', 'video_bytes',
]);
const FORBIDDEN = Object.freeze([...new Set([...FORBIDDEN_KEYS, ...EXTRA_FORBIDDEN_KEYS, ...EXTRA_FORBIDDEN])]);

const KEYS = Object.freeze([
  'contract_version', 'aspect_ratio', 'width_px', 'height_px', 'duration_ms', 'fps',
  'scenes', 'visual_direction', 'copy', 'source_assets', 'audio', 'output_format',
  'safety', 'generation_settings',
]);
const SCENE = Object.freeze(['index', 'start_ms', 'end_ms', 'visual_direction']);
const COPY = Object.freeze(['primary', 'captions', 'cta']);
const ASSET = Object.freeze(['asset_id']);
const AUDIO = Object.freeze(['voice_required', 'notes']);
const SAFETY = Object.freeze(['moderation_required', 'prohibited_claims']);
const GEN = Object.freeze(['style', 'pacing']);

module.exports = {
  CONTRACT_VERSION, ASPECT, FPS, FORMATS, MIME, DIMS, ASSET_ID_RE, STORAGE_RE,
  DURATION, MAX_SCENES, MAX_JSON, TEXT, FORBIDDEN, KEYS, SCENE, COPY, ASSET, AUDIO, SAFETY, GEN,
};
