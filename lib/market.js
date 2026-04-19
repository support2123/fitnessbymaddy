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

const WELCOME_MSG = {
  IN: "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?",
  DEFAULT: "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?"
};

const NUDGE_TRIAL_MSG = {
  IN: "Hey! Abhi decide nahi kar pa rahe? Ek $20 trial session try karo — full Zoom session with Maddy's team. Link: ",
  DEFAULT: "Still deciding? Try a $20 trial session — full Zoom session with Maddy's team. Link: "
};

function getWelcomeMsg(market) {
  return WELCOME_MSG[market] || WELCOME_MSG.DEFAULT;
}

function getNudgeMsg(market) {
  return NUDGE_TRIAL_MSG[market] || NUDGE_TRIAL_MSG.DEFAULT;
}

module.exports = { detectMarket, isHinglish, getWelcomeMsg, getNudgeMsg };
