-- No-cost evidence providers (Reference v1.2 §10 + free public APIs already
-- used by the legacy services): register the keyless integrations and bind
-- them to Market Analysis so Analyse Now grounds itself in first-party site
-- metadata, encyclopedic background, and live news — at zero cost. The rows
-- are also upserted by the code-catalog sync; inserting here keeps fresh
-- databases consistent at migration time (FK order).
insert into integrations (key, name, purpose, status, auth_kind) values
  ('web_fetch',   'Direct site fetch',          'First-party fetch of a subject website (title, description) — free, no key', 'live', 'none'),
  ('wikipedia',   'Wikipedia (REST API)',       'Company and industry background evidence — free, no key',                    'live', 'none'),
  ('hacker_news', 'Hacker News (Algolia API)',  'Tech-community signals and discussion mining — free, no key',                'live', 'none'),
  ('frankfurter', 'Frankfurter FX (ECB rates)', 'Daily currency conversion rates for budget views — free, no key',            'live', 'none'),
  ('news_api',    'Real-Time News Data',        'Live news intelligence',                                                     'live', 'api_key')
on conflict (key) do nothing;

insert into capability_integrations (capability_key, integration_key) values
  ('compete.market_analysis', 'web_fetch'),
  ('compete.market_analysis', 'wikipedia'),
  ('compete.market_analysis', 'news_api')
on conflict do nothing;
