'use strict';
/**
 * Live spend pacing against the monthly budget plan.
 * Shared by Budget Board, canonical metrics, anomaly detector, and weekly narrative.
 */

function _ymNow() {
  return new Date().toISOString().slice(0, 7);
}

function computePacing({
  period_month,
  target_cents = 0,
  spent_cents = 0,
  by_channel = [],
  now = new Date(),
} = {}) {
  const period = period_month || _ymNow();
  const [y, m] = period.split('-').map(Number);
  const daysInMonth = (y && m) ? new Date(y, m, 0).getDate() : 30;
  const isCurrentMonth = period === _ymNow();
  const dayOfMonth = isCurrentMonth ? Math.max(1, now.getUTCDate()) : daysInMonth;
  const daysRemaining = Math.max(0, daysInMonth - dayOfMonth);
  const target = Number(target_cents) || 0;
  const spent = Number(spent_cents) || 0;

  const expected_spend_cents = target
    ? Math.round(target * (dayOfMonth / daysInMonth))
    : 0;
  const projected_month_end_cents = dayOfMonth > 0
    ? Math.round(spent * (daysInMonth / dayOfMonth))
    : spent;
  const remaining_cents = target - spent;
  const recommended_daily_cents = daysRemaining > 0 && remaining_cents > 0
    ? Math.round(remaining_cents / daysRemaining)
    : 0;
  const actual_daily_cents = dayOfMonth > 0 ? Math.round(spent / dayOfMonth) : 0;

  const pace_pct = expected_spend_cents > 0
    ? Math.round((spent / expected_spend_cents) * 100)
    : (target ? Math.round((spent / target) * 100) : null);

  let pace_status = 'unknown';
  if (pace_pct != null) {
    if (pace_pct >= 120) pace_status = 'overspending';
    else if (pace_pct >= 105) pace_status = 'ahead';
    else if (pace_pct >= 85) pace_status = 'on_pace';
    else if (pace_pct >= 60) pace_status = 'underspending';
    else pace_status = 'far_behind';
  }

  const waste_channels = (by_channel || [])
    .filter((c) => Number(c.allocated_cents) > 0 && Number(c.spent_cents) > Number(c.allocated_cents) * 1.15)
    .map((c) => ({
      channel: c.channel,
      over_cents: Number(c.spent_cents) - Number(c.allocated_cents),
      utilization: c.utilization,
    }));

  const actions = [];
  if (pace_status === 'overspending' || pace_status === 'ahead') {
    actions.push({
      priority: 'high',
      action: 'Throttle daily budgets',
      detail: `Projected month-end $${(projected_month_end_cents / 100).toFixed(0)} vs target $${(target / 100).toFixed(0)}. Cut daily burn toward $${(recommended_daily_cents / 100).toFixed(0)}/day.`,
    });
  } else if (pace_status === 'underspending' || pace_status === 'far_behind') {
    actions.push({
      priority: 'medium',
      action: 'Release held budget',
      detail: `Only ${pace_pct}% of expected pace with ${daysRemaining} day(s) left. Scale winners to ~$${(recommended_daily_cents / 100).toFixed(0)}/day.`,
    });
  } else if (pace_status === 'on_pace') {
    actions.push({
      priority: 'low',
      action: 'Hold course',
      detail: `On pace at ${pace_pct}%. Keep daily burn near $${(actual_daily_cents / 100).toFixed(0)}.`,
    });
  }
  for (const w of waste_channels.slice(0, 3)) {
    actions.push({
      priority: 'high',
      action: `Reallocate from ${w.channel}`,
      detail: `${w.channel} is ${w.utilization || '?'}% of allocation (+$${(w.over_cents / 100).toFixed(0)} over).`,
    });
  }

  return {
    period_month: period,
    day_of_month: dayOfMonth,
    days_in_month: daysInMonth,
    days_remaining: daysRemaining,
    target_cents: target,
    spent_cents: spent,
    remaining_cents,
    expected_spend_cents,
    projected_month_end_cents,
    recommended_daily_cents,
    actual_daily_cents,
    pace_pct,
    pace_status,
    waste_channels,
    actions,
  };
}

module.exports = { computePacing, _ymNow };
