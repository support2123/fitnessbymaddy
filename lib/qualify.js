const PROGRAM_MAP = {
  '6wk_gym': { name: '6-Week Burn & Build', price: 97, checkoutSlug: '6wk-burn-build' },
  'pcos': { name: 'PCOS Warrior', price: 45, checkoutSlug: 'pcos-warrior' },
  '40plus': { name: '40+ Strong', price: 50, checkoutSlug: '40plus-strong' },
  '12wk': { name: '12-Week Flagship', price: 200, checkoutSlug: '12wk-flagship' },
  'zoom_trial': { name: 'Zoom Trial', price: 20, checkoutSlug: 'zoom-trial' }
};

function qualifyLead(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  if (/fat\s*loss|weight\s*loss|weight|shred|lean|cut|slim/.test(lower)) {
    return { program: '6wk_gym', ...PROGRAM_MAP['6wk_gym'] };
  }
  if (/pcos|hormonal|hormone|irregular\s*period/.test(lower)) {
    return { program: 'pcos', ...PROGRAM_MAP['pcos'] };
  }
  if (/\b40|menopause|joint|joints|senior|mature/.test(lower)) {
    return { program: '40plus', ...PROGRAM_MAP['40plus'] };
  }
  if (/custom|12\s*week|serious|transform|flagship|full\s*program/.test(lower)) {
    return { program: '12wk', ...PROGRAM_MAP['12wk'] };
  }
  if (/trial|zoom|not\s*sure|try|test|sample/.test(lower)) {
    return { program: 'zoom_trial', ...PROGRAM_MAP['zoom_trial'] };
  }

  return null;
}

module.exports = { qualifyLead, PROGRAM_MAP };
