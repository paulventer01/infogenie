'use strict';

const { createResearchAdapter } = require('./factory');

module.exports = createResearchAdapter({
  id: 'meta_research',
  version: '1.0.0',
  platform: 'meta',
  capability: 'ad_library',
  unsupported: ['ads_transparency_center', 'keyword_planner', 'public_profile'],
  allowLive: true,
  host: 'graph.facebook.com',
  path: '/v21.0/ads_archive',
  method: 'GET',
  page: require('../fixtures/research/meta.v1.json'),
  pages: require('../fixtures/research/connector-pagination.v1.json').pages,
});
