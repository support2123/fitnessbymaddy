export function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

export function isHinglish(market) {
  return market === 'IN';
}

export function getWelcomeMessage(market) {
  if (market === 'IN') {
    return "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?";
  }
  return "Hi! Maddy's team here 👋 What's your fitness goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";
}

export function getNudgeMessage(market) {
  if (market === 'IN') {
    return "Hey! Abhi bhi soch rahe ho? Maddy ka $20 trial session try karo — full workout + nutrition guidance ek Zoom call pe. Bahut log yahi se start karte hain 💪";
  }
  return "Still thinking? Try Maddy's $20 trial session — a full workout + nutrition guidance on a Zoom call. Most people start here 💪";
}

export function getProgramMessage(market, programName, checkoutUrl) {
  if (market === 'IN') {
    return `Perfect choice! ${programName} ke liye yahan se start karo 👇\n\n${checkoutUrl}\n\nKoi bhi sawaal ho toh poochh lo!`;
  }
  return `Great choice! Here's how to get started with ${programName} 👇\n\n${checkoutUrl}\n\nFeel free to ask any questions!`;
}
