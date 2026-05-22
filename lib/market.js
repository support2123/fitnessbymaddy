const COUNTRY_CODES = {
  '91': 'IN',
  '971': 'UAE',
  '44': 'UK'
};

export function detectMarket(phone) {
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

export function isHinglishMarket(market) {
  return market === 'IN';
}

export function getWelcomeMessage(market) {
  if (isHinglishMarket(market)) {
    return "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?";
  }
  return "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";
}

export function getNudgeMessage(market) {
  if (isHinglishMarket(market)) {
    return "Hey! Aapne abhi tak reply nahi kiya. Ek $20 trial session try karo — full workout + nutrition guidance. Interested?";
  }
  return "Hey! Haven't heard back from you. Try a $20 trial session — full workout + nutrition guidance. Interested?";
}
