// Keyword → program routing (Flow B)
const RULES = [
  { keys: ['pcos', 'hormonal', 'thyroid'], program: 'pcos',       price: 45,  label: 'PCOS Warrior' },
  { keys: ['40', 'menopause', 'joint', 'joints', 'over 40', '40+'], program: '40plus',    price: 50,  label: '40+ Strong' },
  { keys: ['12 week', '12week', 'twelve week', 'custom', 'serious', 'flagship'], program: '12wk',      price: 200, label: '12-Week Flagship' },
  { keys: ['trial', 'zoom', 'not sure', 'free', 'sample'], program: 'zoom_trial', price: 20, label: '$20 Zoom Trial' },
  { keys: ['home workout', 'home', 'no gym'], program: '6wk_home', price: 40, label: '6-Week Home Burn & Build' },
  { keys: ['fat loss', 'weight', 'shred', 'burn', 'cut'], program: '6wk_gym',   price: 40, label: '6-Week Burn & Build' },
];

export function routeKeyword(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  for (const r of RULES) {
    if (r.keys.some(k => t.includes(k))) return r;
  }
  return null;
}

export function checkoutUrl(program) {
  // Exly hosted checkout — slug matches Exly product id/slug
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
}

export function intakeUrl(leadId, site) {
  const base = site || process.env.SITE_URL || 'https://fitnessbymaddy.com';
  return `${base}/intake?lead=${leadId}`;
}

export function checkinUrl(clientId, weekNo, site) {
  const base = site || process.env.SITE_URL || 'https://fitnessbymaddy.com';
  return `${base}/checkin?c=${clientId}&w=${weekNo}`;
}
