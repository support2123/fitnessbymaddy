function detectMarket(phone) {
  const p = String(phone).replace(/[^0-9]/g, '');
  if (p.startsWith('91')) return 'IN';
  if (p.startsWith('971')) return 'UAE';
  if (p.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

const WELCOME_MSG = {
  hinglish: "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?",
  english: "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?"
};

const NUDGE_MSG = {
  hinglish: "Hey! Maddy ke saath ek $20 trial Zoom session try karo — bilkul risk-free. Interested?",
  english: "Hey! Try a $20 trial Zoom session with Maddy — completely risk-free. Interested?"
};

function getWelcomeMessage(market) {
  return isHinglish(market) ? WELCOME_MSG.hinglish : WELCOME_MSG.english;
}

function getNudgeMessage(market) {
  return isHinglish(market) ? NUDGE_MSG.hinglish : NUDGE_MSG.english;
}

module.exports = { detectMarket, isHinglish, getWelcomeMessage, getNudgeMessage };
