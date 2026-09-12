-- Market Analysis — the "Analyse Now" entry capability. Given a website or a
-- sector plus a region, it maps the competitive set in the exact same industry
-- and produces a battle plan. Analysis archetype, input-heavy interaction
-- model; requires_context is false so a brand-new tenant can run it before
-- brand onboarding (analysis reads the market, it does not speak for the
-- brand). Reversible; standard A1 entry / A3 ceiling.
insert into capabilities
  (key, name, domain, archetype, agent_type, requires_context, irreversible, entry_autonomy, autonomy_ceiling, description)
values
  ('compete.market_analysis', 'Market Analysis (Analyse Now)', 'compete', 'analysis', 'input_heavy', false, false, 1, 3,
   'Enter a website or a sector — InfoGenie infers the industry, identifies competitors in the exact same industry, and analyses each: positioning, strengths, weaknesses, threat level, and counter-moves.')
on conflict (key) do nothing;
