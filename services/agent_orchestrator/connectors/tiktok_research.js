'use strict';

const { createResearchAdapter } = require('./factory');

module.exports = createResearchAdapter({
  id: 'tiktok_research',
  version: '1.0.0',
  platform: 'tiktok',
  capability: 'public_profile',
  unsupported: ['ad_library', 'ads_transparency_center', 'keyword_planner'],
  allowLive: true,
  host: 'business-api.tiktok.com',
  path: '/open_api/v1.3/ad/library/',
  method: 'GET',
  page: require('../fixtures/research/tiktok.v1.json'),
});
