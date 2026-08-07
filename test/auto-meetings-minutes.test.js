'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFullTeamMinutes } = require('../services/officer/meeting_minutes');

describe('auto-meeting full-team minutes', () => {
  it('requires a department update for every attendee', () => {
    const attendees = ['Marketing Officer', 'Sales Officer', 'Operations Officer'];
    const minutes = normalizeFullTeamMinutes({
      discussion: ['Kickoff'],
      departmentUpdates: [
        {
          officer: 'Marketing Officer',
          whatWorks: 'Ads live',
          whatDoesNotWork: 'Creative fatigue',
          why: 'Same assets 30d',
          remedialAction: 'Refresh creatives',
        },
      ],
      decisions: ['Refresh creatives this week'],
      actionItems: [{ owner: 'Marketing Officer', action: 'Refresh creatives', dueIn: '3d', status: 'agreed' }],
    }, attendees, 'Weekly standup');

    assert.equal(minutes.mandatoryAttendance, true);
    assert.equal(minutes.departmentUpdates.length, 3);
    assert.ok(minutes.departmentUpdates.every((u) =>
      u.officer && u.whatWorks && u.whatDoesNotWork && u.why && u.remedialAction));
    assert.ok(minutes.actionItems.every((a) => a.status === 'agreed'));
    assert.ok(minutes.actionItems.some((a) => a.owner === 'Marketing Officer'));
  });
});
