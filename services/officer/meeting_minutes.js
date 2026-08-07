'use strict';

/**
 * Normalize autonomous / full-team meeting minutes so every attendee has a
 * department update (what works / what doesn't / why / remedial action) and
 * agreed actions are trackable through to implementation.
 */
function normalizeFullTeamMinutes(parsed, attendees, topic) {
  const src = (parsed && typeof parsed === 'object') ? parsed : {};
  const byOfficer = new Map();
  for (const u of (Array.isArray(src.departmentUpdates) ? src.departmentUpdates : [])) {
    if (!u || typeof u !== 'object') continue;
    const officer = String(u.officer || u.owner || '').trim();
    if (officer) byOfficer.set(officer, u);
  }
  const departmentUpdates = attendees.map((officer) => {
    const u = byOfficer.get(officer) || {};
    return {
      officer,
      whatWorks: String(u.whatWorks || u.what_works || 'On track with assigned responsibilities.').slice(0, 600),
      whatDoesNotWork: String(u.whatDoesNotWork || u.what_does_not_work || 'No blockers reported this cycle.').slice(0, 600),
      why: String(u.why || 'n/a').slice(0, 600),
      remedialAction: String(u.remedialAction || u.remedial_action || 'Continue monitoring and report next meeting.').slice(0, 600),
    };
  });

  const discussion = Array.isArray(src.discussion) && src.discussion.length
    ? src.discussion.map((d) => String(d).slice(0, 1200)).slice(0, 12)
    : [
      `Full AI executive team convened on "${topic}". Every officer attended and delivered a department update.`,
      'Format covered: what works, what does not work, why, and the remedial action required.',
    ];

  const decisions = Array.isArray(src.decisions) && src.decisions.length
    ? src.decisions.map((d) => String(d).slice(0, 500)).slice(0, 12)
    : departmentUpdates
      .filter((u) => u.whatDoesNotWork && !/no blockers/i.test(u.whatDoesNotWork))
      .slice(0, 8)
      .map((u) => `Agreed: ${u.officer} will ${u.remedialAction}`);

  const rawActions = Array.isArray(src.actionItems) ? src.actionItems : [];
  let actionItems = rawActions
    .filter((a) => a && (a.action || a.title))
    .slice(0, 40)
    .map((a, i) => ({
      id: String(a.id || `act_${i + 1}`).slice(0, 40),
      owner: String(a.owner || attendees[i % attendees.length] || 'Team').slice(0, 80),
      action: String(a.action || a.title || '').slice(0, 400),
      dueIn: ['24h', '3d', '7d', '14d'].includes(a.dueIn) ? a.dueIn : '7d',
      status: a.status === 'implemented' ? 'implemented' : (a.status === 'in_progress' ? 'in_progress' : 'agreed'),
      implementedAt: a.implementedAt || null,
    }));

  if (!actionItems.length) {
    actionItems = departmentUpdates.map((u, i) => ({
      id: `act_${i + 1}`,
      owner: u.officer,
      action: u.remedialAction,
      dueIn: '7d',
      status: 'agreed',
      implementedAt: null,
    }));
  } else {
    const owners = new Set(actionItems.map((a) => a.owner));
    departmentUpdates.forEach((u, i) => {
      if (owners.has(u.officer)) return;
      if (/continue monitoring/i.test(u.remedialAction) && /no blockers/i.test(u.whatDoesNotWork)) return;
      actionItems.push({
        id: `act_rem_${i + 1}`,
        owner: u.officer,
        action: u.remedialAction,
        dueIn: '7d',
        status: 'agreed',
        implementedAt: null,
      });
    });
  }

  return {
    discussion,
    decisions,
    departmentUpdates,
    actionItems,
    mandatoryAttendance: true,
  };
}

module.exports = { normalizeFullTeamMinutes };
