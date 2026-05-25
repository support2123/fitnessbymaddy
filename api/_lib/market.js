function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function getLanguage(market) {
  return market === 'IN' ? 'hinglish' : 'english';
}

function getWelcomeMessage(market) {
  if (market === 'IN') {
    return "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?";
  }
  return "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";
}

function getNudgeMessage(market) {
  if (market === 'IN') {
    return "Hey! Maddy ka $20 trial session try karo — 1 Zoom call mein pura plan milega. Interest hai? 💪 Link: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial";
  }
  return "Hey! Try Maddy's $20 trial session — get a full plan in one Zoom call. Interested? 💪 Link: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial";
}

module.exports = { detectMarket, getLanguage, getWelcomeMessage, getNudgeMessage };
