export function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

export function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const clean = phone.replace(/\D/g, '');
  if (clean.startsWith('91') && clean.length === 12) return 'IN';
  if (clean.startsWith('971')) return 'UAE';
  if (clean.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

const PROGRAM_PATTERNS = [
  { pattern: /fat\s*loss|weight\s*loss|shred|lean|cut/i, program: '6wk_gym' },
  { pattern: /pcos|hormonal|period|cycle/i, program: 'pcos' },
  { pattern: /40\+?|forty|menopause|joints|senior/i, program: '40plus' },
  { pattern: /custom|12\s*week|serious|flagship|transform/i, program: '12wk' },
  { pattern: /trial|zoom|not\s*sure|try|test/i, program: 'zoom_trial' },
  { pattern: /home|bodyweight|no\s*gym|no\s*equipment/i, program: '6wk_home' },
];

export function detectProgram(text) {
  if (!text) return null;
  for (const { pattern, program } of PROGRAM_PATTERNS) {
    if (pattern.test(text)) return program;
  }
  return null;
}

const ESCALATION_TRIGGERS = [
  'injury', 'medical condition', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'vomit', 'faint', 'chest pain', 'heart', 'surgery', 'doctor said',
];

export function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_TRIGGERS.some(t => lower.includes(t));
}

export function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

export const PROGRAM_INFO = {
  '6wk_gym':     { name: '6-Week Burn & Build (Gym)', price: 97, weeks: 6 },
  '6wk_home':    { name: '6-Week Burn & Build (Home)', price: 97, weeks: 6 },
  '12wk':        { name: '12-Week Custom Training', price: 200, weeks: 12 },
  'pcos':        { name: 'PCOS Warrior', price: 45, weeks: 6 },
  '40plus':      { name: '40+ Strong', price: 50, weeks: 6 },
  'zoom_trial':  { name: 'Zoom Trial Session', price: 20, weeks: 1 },
  'zoom_pack':   { name: 'Zoom Pack', price: 80, weeks: 4 },
};

export function isHinglish(market) {
  return market === 'IN';
}
