function qualifyLead(message) {
  const lower = (message || '').toLowerCase();

  if (/fat\s*loss|weight|shred|slim|lean/.test(lower)) {
    return { program: '6wk_gym', name: '6-Week Burn & Build', price: 97 };
  }
  if (/pcos|hormonal|hormone|period|irregular/.test(lower)) {
    return { program: 'pcos', name: 'PCOS Warrior', price: 45 };
  }
  if (/40|menopause|joints|joint|senior|age/.test(lower)) {
    return { program: '40plus', name: '40+ Strong', price: 50 };
  }
  if (/custom|12\s*week|serious|advanced|flagship/.test(lower)) {
    return { program: '12wk', name: '12-Week Flagship', price: 200 };
  }
  if (/trial|zoom|not sure|try|test/.test(lower)) {
    return { program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 };
  }
  if (/home|no gym|bodyweight|at home/.test(lower)) {
    return { program: '6wk_home', name: '6-Week Home Program', price: 77 };
  }

  return null;
}

module.exports = { qualifyLead };
