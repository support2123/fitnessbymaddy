// Sanity check on Claude-generated programs before they go to a client.
export function reviewProgram(plan, profile = {}) {
  const reasons = [];
  const np = plan?.nutrition_plan || {};
  const sex = (profile.sex || '').toLowerCase();
  const minCal = sex === 'm' || sex === 'male' ? 1800 : 1500;
  if (typeof np.calorie_target === 'number' && np.calorie_target < minCal) {
    reasons.push(`calorie target ${np.calorie_target} below ${minCal}`);
  }
  const supps = (np.supplements || []).join(' ').toLowerCase();
  const banned = ['clen', 'clenbuterol', 'sarm', 'anavar', 'ostarine', 'tren',
    'winstrol', 'dnp', 'ephedrine', 'eca'];
  for (const b of banned) {
    if (supps.includes(b)) reasons.push(`banned substance referenced: ${b}`);
  }
  if (plan?.flag_for_review) {
    reasons.push(`model self-flagged: ${plan.flag_reason || 'unspecified'}`);
  }
  return { safe: reasons.length === 0, reasons };
}
