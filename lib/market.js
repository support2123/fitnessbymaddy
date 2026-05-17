function detectMarket(phone) {
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

const WELCOME_MSG = {
  IN: "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?",
  DEFAULT: "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS, strength, or 40+ fitness? Or would you like to try a trial session first?",
};

const NUDGE_MSG = {
  IN: "Hey! Maddy ka $20 trial session try karo — ek live Zoom call mein apna personalised plan lo. Interested? 👇",
  DEFAULT: "Hey! Try Maddy's $20 trial session — get your personalised plan in a live Zoom call. Interested? 👇",
};

function getWelcome(market) {
  return market === 'IN' ? WELCOME_MSG.IN : WELCOME_MSG.DEFAULT;
}

function getNudge(market) {
  return market === 'IN' ? NUDGE_MSG.IN : NUDGE_MSG.DEFAULT;
}

module.exports = { detectMarket, isHinglish, getWelcome, getNudge };
