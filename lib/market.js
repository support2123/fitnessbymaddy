function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('91') || cleaned.startsWith('091')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

const WELCOME_MSG = {
  IN: "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?",
  DEFAULT: "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?",
};

const NUDGE_MSG = {
  IN: "Hey! Maddy ka $20 trial session try karo — ek zoom call mein samjho tumhare liye kya best hoga 💪",
  DEFAULT: "Hey! Try Maddy's $20 trial session — one Zoom call to figure out the best plan for your goals 💪",
};

function getWelcomeMessage(market) {
  return market === 'IN' ? WELCOME_MSG.IN : WELCOME_MSG.DEFAULT;
}

function getNudgeMessage(market) {
  return market === 'IN' ? NUDGE_MSG.IN : NUDGE_MSG.DEFAULT;
}

module.exports = { detectMarket, isHinglish, getWelcomeMessage, getNudgeMessage };
