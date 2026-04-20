function classifyInterest(message) {
  const lower = (message || '').toLowerCase();

  if (/fat\s*loss|weight|shred|lean|cut/i.test(lower)) {
    return { program: '6wk_gym', label: '6-Week Burn & Build', price: 97 };
  }
  if (/pcos|hormonal|hormone|period|irregular/i.test(lower)) {
    return { program: 'pcos', label: 'PCOS Warrior', price: 45 };
  }
  if (/40|menopause|joints|senior|mature/i.test(lower)) {
    return { program: '40plus', label: '40+ Strong', price: 50 };
  }
  if (/custom|12\s*week|serious|transform|flagship/i.test(lower)) {
    return { program: '12wk', label: '12-Week Flagship', price: 200 };
  }
  if (/trial|zoom|not sure|try|test|sample/i.test(lower)) {
    return { program: 'zoom_trial', label: 'Zoom Trial', price: 20 };
  }
  if (/home|bodyweight|no gym|no equipment/i.test(lower)) {
    return { program: '6wk_home', label: '6-Week Home Program', price: 97 };
  }

  return null;
}

module.exports = { classifyInterest };
