function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglishMarket(market) {
  return market === 'IN';
}

const KEYWORD_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'fat', 'slim', 'lean', 'patla'], program: '6wk_gym', name: '6-Week Burn & Build', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid'], program: 'pcos', name: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'knee', 'back pain', '40+', 'forty'], program: '40plus', name: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personal', 'personalized'], program: '12wk', name: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', name: 'Zoom Trial', price: 20 },
  { keywords: ['home', 'ghar', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', name: '6-Week Home', price: 75 },
];

function routeByKeywords(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const route of KEYWORD_ROUTES) {
    for (const kw of route.keywords) {
      if (lower.includes(kw)) return route;
    }
  }
  return null;
}

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'not working', 'scam', 'fraud',
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

module.exports = { detectMarket, isHinglishMarket, routeByKeywords, needsEscalation, isOptOut, KEYWORD_ROUTES };
