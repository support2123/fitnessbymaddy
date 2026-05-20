const COUNTRY_CODES = {
  '91': 'IN',
  '971': 'UAE',
  '44': 'UK'
};

export function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9]/g, '');

  for (const [code, market] of Object.entries(COUNTRY_CODES)) {
    if (cleaned.startsWith(code)) return market;
  }
  return 'GLOBAL';
}

export function isHinglish(market) {
  return market === 'IN';
}

export const WELCOME_MSG = {
  IN: "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?",
  DEFAULT: "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?"
};

export const NUDGE_MSG = {
  IN: "Hey! Abhi bhi decide nahi hua? Ek $20 trial session try karo — full Zoom session with Maddy's team. Koi commitment nahi.",
  DEFAULT: "Hey! Still deciding? Try a $20 trial session — a full Zoom session with Maddy's team. No commitment needed."
};

export function getWelcome(market) {
  return WELCOME_MSG[market] || WELCOME_MSG.DEFAULT;
}

export function getNudge(market) {
  return NUDGE_MSG[market] || NUDGE_MSG.DEFAULT;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack'
};

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  '12wk': 200,
  'pcos': 45,
  '40plus': 50,
  'zoom_trial': 20,
  'zoom_pack': 80
};

export function getProgramName(key) {
  return PROGRAM_NAMES[key] || key;
}

export function getProgramPrice(key) {
  return PROGRAM_PRICES[key] || 0;
}

export function getProgramWeeks(key) {
  if (key === '12wk') return 12;
  if (key.startsWith('6wk')) return 6;
  if (key === 'pcos' || key === '40plus') return 8;
  if (key === 'zoom_trial') return 1;
  if (key === 'zoom_pack') return 4;
  return 6;
}
