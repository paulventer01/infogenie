// Unified agenda + conflict detection across Brand + Content calendars.
// Brand items use scheduled_at (no ends_at) — treat as durationMins (default 60).
// Content posts use date + best_time.

const DEFAULT_DURATION_MIN = 60;
const BUSY_DAY_THRESHOLD = 6;

function _parseStart(isoOrDate, bestTime) {
  if (!isoOrDate) return null;
  const s = String(isoOrDate);
  if (s.includes('T')) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const time = (bestTime && /^\d{1,2}:\d{2}/.test(bestTime)) ? bestTime.slice(0, 5) : '09:00';
  const d = new Date(`${s.slice(0, 10)}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeBrandItem(row, durationMins = DEFAULT_DURATION_MIN) {
  const start = _parseStart(row.scheduled_at);
  if (!start) return null;
  const end = new Date(start.getTime() + durationMins * 60000);
  return {
    id: row.id,
    source: 'brand',
    calendar: 'brand',
    category: row.category || 'brand',
    title: row.title || '(untitled)',
    start: start.toISOString(),
    end: end.toISOString(),
    status: row.status || 'planned',
    notes: row.notes || '',
  };
}

function normalizeContentPost(post, run, idx) {
  const start = _parseStart(post.date, post.best_time);
  if (!start) return null;
  const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60000);
  return {
    id: `cc_${run.id}_${idx}`,
    source: 'content',
    calendar: 'content',
    category: post.channel || 'content',
    title: post.hook || post.copy?.slice(0, 80) || 'Content post',
    start: start.toISOString(),
    end: end.toISOString(),
    status: 'planned',
    notes: [post.format, post.cta].filter(Boolean).join(' · '),
    channel: post.channel,
    runId: run.id,
  };
}

function normalizeCampaign(row) {
  const start = _parseStart(row.launched_at || row.created_at || row.start_date);
  if (!start) return null;
  const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60000);
  return {
    id: row.id || `camp_${start.toISOString()}`,
    source: 'campaign',
    calendar: 'campaigns',
    category: row.platform || 'campaign',
    title: row.name || row.title || 'Campaign',
    start: start.toISOString(),
    end: end.toISOString(),
    status: row.status || 'active',
    notes: row.budget != null ? `Budget: ${row.budget}` : '',
    channel: row.platform || null,
  };
}

function normalizeSocialPost(row) {
  const start = _parseStart(row.scheduled_at || row.scheduledDate || row.created_at, row.best_time);
  if (!start) return null;
  const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60000);
  return {
    id: row.id || `soc_${start.toISOString()}`,
    source: 'social',
    calendar: 'social',
    category: row.platform || row.channel || 'social',
    title: String(row.caption || row.title || row.copy || 'Social post').slice(0, 80),
    start: start.toISOString(),
    end: end.toISOString(),
    status: row.status || 'scheduled',
    notes: '',
    channel: row.platform || row.channel || null,
  };
}

function normalizeSeoArticle(row, idx = 0) {
  const start = _parseStart(row.publish_at || row.scheduled_at || row.customDate || row.date);
  if (!start) return null;
  const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60000);
  return {
    id: row.id || `seo_${idx}_${start.toISOString()}`,
    source: 'article',
    calendar: 'seo',
    category: 'article',
    title: row.title || `Article #${idx + 1}`,
    start: start.toISOString(),
    end: end.toISOString(),
    status: row.status || 'pending',
    notes: row.destination || '',
  };
}

function buildAgenda({
  brandItems = [],
  contentRuns = [],
  campaigns = [],
  socialPosts = [],
  seoArticles = [],
  from,
  to,
}) {
  const events = [];
  for (const row of brandItems) {
    const e = normalizeBrandItem(row);
    if (e) events.push(e);
  }
  for (const run of contentRuns) {
    const posts = Array.isArray(run.posts) ? run.posts
      : (typeof run.posts === 'string' ? (() => { try { return JSON.parse(run.posts); } catch { return []; } })() : []);
    posts.forEach((p, i) => {
      const e = normalizeContentPost(p, run, i);
      if (e) events.push(e);
    });
  }
  for (const row of campaigns) {
    const e = normalizeCampaign(row);
    if (e) events.push(e);
  }
  for (const row of socialPosts) {
    const e = normalizeSocialPost(row);
    if (e) events.push(e);
  }
  seoArticles.forEach((row, i) => {
    const e = normalizeSeoArticle(row, i);
    if (e) events.push(e);
  });

  const fromMs = from ? new Date(from).getTime() : null;
  const toMs = to ? new Date(to).getTime() : null;
  const filtered = events.filter((e) => {
    const t = new Date(e.start).getTime();
    if (fromMs != null && t < fromMs) return false;
    if (toMs != null && t > toMs) return false;
    return true;
  });

  filtered.sort((a, b) => new Date(a.start) - new Date(b.start));
  return filtered;
}

function _overlaps(a, b) {
  const as = new Date(a.start).getTime();
  const ae = new Date(a.end).getTime();
  const bs = new Date(b.start).getTime();
  const be = new Date(b.end).getTime();
  return as < be && bs < ae;
}

function _dayKey(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

function detectConflicts(events) {
  const conflicts = [];
  const busyDays = [];

  // Pairwise time overlaps
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      if (_overlaps(events[i], events[j])) {
        conflicts.push({
          id: `overlap_${events[i].id}_${events[j].id}`,
          type: 'overlap',
          severity: events[i].source !== events[j].source ? 'high' : 'medium',
          message: `"${events[i].title}" overlaps "${events[j].title}"`,
          events: [events[i], events[j]],
        });
      }
    }
  }

  // Same-title duplicates within 24h
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const t1 = (events[i].title || '').trim().toLowerCase();
      const t2 = (events[j].title || '').trim().toLowerCase();
      if (!t1 || t1 !== t2) continue;
      const gap = Math.abs(new Date(events[i].start) - new Date(events[j].start));
      if (gap <= 864e5) {
        conflicts.push({
          id: `dup_${events[i].id}_${events[j].id}`,
          type: 'duplicate',
          severity: 'low',
          message: `Duplicate title "${events[i].title}" within 24 hours`,
          events: [events[i], events[j]],
        });
      }
    }
  }

  // Busy days
  const byDay = {};
  for (const e of events) {
    const k = _dayKey(e.start);
    (byDay[k] ||= []).push(e);
  }
  for (const [day, list] of Object.entries(byDay)) {
    if (list.length >= BUSY_DAY_THRESHOLD) {
      busyDays.push({
        id: `busy_${day}`,
        type: 'busy_day',
        severity: 'medium',
        message: `${list.length} items on ${day} — consider spreading load`,
        day,
        count: list.length,
        events: list,
      });
    }
  }

  const all = [...conflicts, ...busyDays];
  const score = Math.max(0, 100 - conflicts.filter((c) => c.type === 'overlap').length * 15
    - conflicts.filter((c) => c.type === 'duplicate').length * 5
    - busyDays.length * 8);

  return {
    conflicts: all,
    overlapCount: conflicts.filter((c) => c.type === 'overlap').length,
    duplicateCount: conflicts.filter((c) => c.type === 'duplicate').length,
    busyDayCount: busyDays.length,
    healthScore: score,
  };
}

/** Find free slots in a date range, avoiding existing events. */
function findFreeSlots(events, {
  from,
  to,
  durationMins = 60,
  workStartHour = 9,
  workEndHour = 17,
  maxSlots = 8,
} = {}) {
  const startDay = new Date(from || Date.now());
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(to || (Date.now() + 14 * 864e5));
  endDay.setHours(23, 59, 59, 999);

  const slots = [];
  const cursor = new Date(startDay);
  while (cursor <= endDay && slots.length < maxSlots) {
    for (let h = workStartHour; h < workEndHour && slots.length < maxSlots; h++) {
      const slotStart = new Date(cursor);
      slotStart.setHours(h, 0, 0, 0);
      if (slotStart < new Date()) continue;
      const slotEnd = new Date(slotStart.getTime() + durationMins * 60000);
      const candidate = {
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
      };
      const hit = events.some((e) => _overlaps(candidate, e));
      if (!hit) {
        slots.push({
          ...candidate,
          label: slotStart.toLocaleString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          }),
          reason: 'No overlapping Brand/Content items in this window',
        });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
}

module.exports = {
  DEFAULT_DURATION_MIN,
  buildAgenda,
  detectConflicts,
  findFreeSlots,
  normalizeBrandItem,
  normalizeContentPost,
  normalizeCampaign,
  normalizeSocialPost,
  normalizeSeoArticle,
};
