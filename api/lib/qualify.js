const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'cut', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: 97 },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', name: '6-Week Home Shred', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'], program: 'pcos', name: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'menopause', 'joints', 'senior', 'knee'], program: '40plus', name: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'personalised', 'personalized', 'flagship'], program: '12wk', name: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 }
];

function qualifyLead(message) {
  const lower = message.toLowerCase();

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return {
        program: route.program,
        programName: route.name,
        price: route.price
      };
    }
  }

  return null;
}

function getWelcomeMessage(market) {
  if (market === 'IN') {
    return "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?";
  }
  return "Hi! Maddy's team here 👋 What's your fitness goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";
}

function getQualifiedMessage(qualification, market) {
  const { programName, price } = qualification;
  if (market === 'IN') {
    return `Perfect! "${programName}" program tere liye best hai 💪\n\nPrice: $${price} (one-time)\n\nCheckout karo: https://fitnessbymaddyy.exlyapp.com/checkout\n\nSaath mein ye form bhi fill kardo taaki hum tera plan customise kar sakein:`;
  }
  return `Perfect! The "${programName}" program is ideal for your goal 💪\n\nPrice: $${price} (one-time)\n\nCheckout here: https://fitnessbymaddyy.exlyapp.com/checkout\n\nAlso fill this quick form so we can customise your plan:`;
}

module.exports = { qualifyLead, getWelcomeMessage, getQualifiedMessage, PROGRAM_ROUTES };
