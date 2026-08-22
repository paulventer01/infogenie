'use strict';

const { createResearchAdapter } = require('./factory');

module.exports = createResearchAdapter({
  id: 'google_research',
  version: '1.0.0',
  platform: 'google',
  capability: 'ads_transparency_center',
  unsupported: ['ad_library', 'keyword_planner', 'public_profile'],
  allowLive: false,
  host: 'adstransparency.google.com',
  path: '/',
  method: 'GET',
  page: require('../fixtures/research/google.v1.json'),
});
