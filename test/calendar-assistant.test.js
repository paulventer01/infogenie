// test/calendar-assistant.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildAgenda, detectConflicts, findFreeSlots } = require('../services/calendar_assistant/agenda');

describe('Calendar Assistant agenda', () => {
  it('normalizes brand + content into a sorted agenda', () => {
    const events = buildAgenda({
      brandItems: [
        { id: 'bcal_1', category: 'ads', title: 'Launch ads', scheduled_at: '2026-08-10T10:00:00.000Z', status: 'planned' },
        { id: 'bcal_2', category: 'mine', title: 'Standup', scheduled_at: '2026-08-11T09:00:00.000Z' },
      ],
      contentRuns: [
        {
          id: 9,
          posts: [
            { date: '2026-08-10', best_time: '10:30', channel: 'linkedin', hook: 'LinkedIn drop' },
          ],
        },
      ],
    });
    assert.equal(events.length, 3);
    assert.ok(events[0].start <= events[1].start);
    assert.equal(events.find((e) => e.source === 'content')?.title, 'LinkedIn drop');
  });

  it('detects time overlaps', () => {
    const events = buildAgenda({
      brandItems: [
        { id: 'bcal_a', category: 'event', title: 'Webinar', scheduled_at: '2026-08-10T14:00:00.000Z' },
        { id: 'bcal_b', category: 'ads', title: 'Promo burst', scheduled_at: '2026-08-10T14:30:00.000Z' },
      ],
      contentRuns: [],
    });
    const report = detectConflicts(events);
    assert.ok(report.overlapCount >= 1);
    assert.ok(report.healthScore < 100);
    assert.ok(report.conflicts.some((c) => c.type === 'overlap'));
  });

  it('finds free slots that avoid existing events', () => {
    const now = new Date();
    now.setDate(now.getDate() + 2);
    now.setHours(10, 0, 0, 0);
    const events = buildAgenda({
      brandItems: [
        { id: 'bcal_x', category: 'mine', title: 'Busy', scheduled_at: now.toISOString() },
      ],
      contentRuns: [],
    });
    const from = new Date();
    from.setDate(from.getDate() + 1);
    const to = new Date();
    to.setDate(to.getDate() + 5);
    const slots = findFreeSlots(events, {
      from: from.toISOString(),
      to: to.toISOString(),
      durationMins: 60,
      maxSlots: 5,
    });
    assert.ok(slots.length >= 1);
    const busyStart = now.getTime();
    const busyEnd = busyStart + 60 * 60000;
    for (const s of slots) {
      const ss = new Date(s.start).getTime();
      const se = new Date(s.end).getTime();
      assert.ok(!(ss < busyEnd && busyStart < se), 'slot should not overlap busy event');
    }
  });
});
