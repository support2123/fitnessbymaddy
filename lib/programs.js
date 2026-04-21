export const PROGRAM_MAP = {
  '6wk_gym': {
    name: '6 Week Shred Challenge',
    price: 97,
    weeks: 6,
    exlySlug: '6wk-shred',
  },
  '6wk_home': {
    name: '6 Week Home Burn',
    price: 97,
    weeks: 6,
    exlySlug: '6wk-home',
  },
  '12wk': {
    name: '12 Week Custom Training',
    price: 297,
    weeks: 12,
    exlySlug: '12wk-custom',
    flagship: true,
  },
  pcos: {
    name: 'PCOS Warrior Program',
    price: 45,
    weeks: 8,
    exlySlug: 'pcos-warrior',
  },
  '40plus': {
    name: '40+ Strong Program',
    price: 50,
    weeks: 8,
    exlySlug: '40plus-strong',
  },
  zoom_trial: {
    name: 'Zoom Trial Session',
    price: 20,
    weeks: 1,
    exlySlug: 'zoom-trial',
  },
  zoom_pack: {
    name: '1-on-1 Live Coaching',
    price: 597,
    weeks: 4,
    exlySlug: 'zoom-pack',
    recurring: true,
  },
};

export function routeToProgram(message) {
  const lower = (message || '').toLowerCase();

  if (/pcos|hormonal/.test(lower)) return 'pcos';
  if (/40\+?|menopause|joints/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship/.test(lower)) return '12wk';
  if (/trial|zoom|not sure/.test(lower)) return 'zoom_trial';
  if (/fat\s*loss|weight|shred|burn|lean/.test(lower)) return '6wk_gym';
  if (/home|bodyweight|no\s*gym/.test(lower)) return '6wk_home';

  return null;
}

export function getCheckoutUrl(programKey) {
  const program = PROGRAM_MAP[programKey];
  if (!program) return null;
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${program.exlySlug}`;
}
