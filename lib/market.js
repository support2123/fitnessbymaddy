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

const WELCOME_MESSAGES = {
  IN: "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?",
  UAE: "Hi! Welcome to Fitness by Maddy 👋 What's your goal — fat loss, PCOS management, strength training, or 40+ fitness? Or would you like to try a trial session first?",
  UK: "Hi! Welcome to Fitness by Maddy 👋 What's your goal — fat loss, PCOS management, strength training, or 40+ fitness? Or would you like to try a trial session first?",
  GLOBAL: "Hi! Welcome to Fitness by Maddy 👋 What's your goal — fat loss, PCOS management, strength training, or 40+ fitness? Or would you like to try a trial session first?"
};

const NUDGE_MESSAGES = {
  IN: "Hey! 👋 Maddy ka $20 trial class try karo — full guidance milega. Interested?",
  UAE: "Hey! 👋 Try Maddy's $20 trial class — you'll get full guidance. Interested?",
  UK: "Hey! 👋 Try Maddy's $20 trial class — you'll get full guidance. Interested?",
  GLOBAL: "Hey! 👋 Try Maddy's $20 trial class — you'll get full guidance. Interested?"
};

function getWelcomeMessage(market) {
  return WELCOME_MESSAGES[market] || WELCOME_MESSAGES.GLOBAL;
}

function getNudgeMessage(market) {
  return NUDGE_MESSAGES[market] || NUDGE_MESSAGES.GLOBAL;
}

module.exports = { detectMarket, isHinglish, getWelcomeMessage, getNudgeMessage };
