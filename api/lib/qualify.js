const KEYWORD_MAP = [
  { keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'], program: 'pcos', name: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'over 40'], program: '40plus', name: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', 'twelve week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', name: '12-Week Custom Training', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', name: '6-Week Home Burn', price: 45 },
  { keywords: ['fat loss', 'weight loss', 'lose weight', 'shred', 'burn', 'slim', 'cut', 'lean', 'fat'], program: '6wk_gym', name: '6-Week Burn & Build', price: 45 },
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const entry of KEYWORD_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return {
        program: entry.program,
        programName: entry.name,
        price: entry.price
      };
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
}

module.exports = { qualifyLead, getCheckoutUrl };
