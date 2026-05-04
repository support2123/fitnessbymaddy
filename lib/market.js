function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

function getWelcomeMessage(market) {
  if (isHinglish(market)) {
    return "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?";
  }
  return "Hi! Maddy's team here 👋 What's your fitness goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";
}

function getNudgeMessage(market) {
  if (isHinglish(market)) {
    return "Hey! Maddy ka $20 trial session try karo — 1 Zoom call mein samajh aa jaayega ki program tere liye sahi hai ya nahi. Kya bolti hai? 💪";
  }
  return "Hey! Try Maddy's $20 trial session — one Zoom call to see if the program is right for you. What do you say? 💪";
}

const PROGRAM_MAP = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'lose': '6wk_gym',
  'slim': '6wk_gym',
  'burn': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'pcod': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'senior': '40plus',
  'custom': '12wk',
  '12 week': '12wk',
  'serious': '12wk',
  'flagship': '12wk',
  'personalized': '12wk',
  'personalised': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
  'try': 'zoom_trial',
};

function detectProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

const PROGRAM_PRICES = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97 },
  '12wk': { name: '12-Week Flagship Program', price: 200 },
  'pcos': { name: 'PCOS Warrior Program', price: 45 },
  '40plus': { name: '40+ Strong Program', price: 50 },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20 },
  'zoom_pack': { name: 'Zoom Sessions Pack', price: 150 },
};

function getProgramInfo(programKey) {
  return PROGRAM_PRICES[programKey] || null;
}

module.exports = { detectMarket, isHinglish, getWelcomeMessage, getNudgeMessage, detectProgram, getProgramInfo };
