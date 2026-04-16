// Keyword → program router and copy bank.

const ROUTES = [
  { re: /(fat\s*loss|weight|shred|burn|lose\s*kg)/i, program: '6wk_gym', price: 97, checkoutSlug: '6-week-shred' },
  { re: /(pcos|hormonal|pcod)/i, program: 'pcos', price: 45, checkoutSlug: 'pcos-warrior' },
  { re: /(40\+?|menopause|joints|perimenopause)/i, program: '40plus', price: 50, checkoutSlug: '40-plus-strong' },
  { re: /(custom|12[\s-]?week|serious|flagship)/i, program: '12wk', price: 200, checkoutSlug: '12-week-flagship' },
  { re: /(trial|zoom|not\s*sure|unsure)/i, program: 'zoom_trial', price: 20, checkoutSlug: 'zoom-trial' }
];

export function routeKeyword(text) {
  if (!text) return null;
  for (const r of ROUTES) if (r.re.test(text)) return r;
  return null;
}

export function checkoutUrl(slug) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${slug}`;
}

export function intakeUrl(leadId) {
  const base = process.env.SITE_URL || 'https://fitnessbymaddy.com';
  return `${base}/intake?lead=${leadId}`;
}

export function checkinUrl(clientId, weekNo) {
  const base = process.env.SITE_URL || 'https://fitnessbymaddy.com';
  return `${base}/checkin?c=${clientId}&w=${weekNo}`;
}

// Copy for Hinglish (IN) and English (everywhere else). Kept short.
export const COPY = {
  welcome: {
    IN:    "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?",
    EN:    "Hi! Maddy's team here. What's your goal — fat loss, PCOS, strength, or 40+ fitness? Or want to try a trial first?"
  },
  nudgeTrial: {
    IN:    "Quick option for you — $20 Zoom trial, 30 min with a coach. No pressure. Link: ",
    EN:    "Quick option — $20 Zoom trial, 30 min with a coach. No pressure. Link: "
  },
  route: {
    IN: (name, price, checkout, intake) =>
      `Perfect. Yeh program fit hai. Price: $${price}. Checkout: ${checkout}\nIntake form (2 min): ${intake}`,
    EN: (name, price, checkout, intake) =>
      `Perfect — this program fits. Price: $${price}. Checkout: ${checkout}\nIntake form (2 min): ${intake}`
  },
  onboard: {
    IN: (program) => `Welcome aboard! ${program} shuru ho gaya. Week 1 plan aa raha hai — check karke reply karo.`,
    EN: (program) => `Welcome aboard! ${program} is live. Your Week 1 plan is on the way — reply once you've had a look.`
  },
  checkinAsk: {
    IN: (week, url) => `Week ${week} check-in time! 2 min lagenge. ${url}`,
    EN: (week, url) => `Week ${week} check-in time — takes 2 min. ${url}`
  },
  checkinNudge: {
    IN: (url) => `Bas ek reminder — check-in form pending hai: ${url}`,
    EN: (url) => `Friendly nudge — your check-in form is pending: ${url}`
  },
  programDelivery: {
    IN: (week) => `Week ${week} plan attached. Kuchh pooch-na ho toh yahin reply karo.`,
    EN: (week) => `Week ${week} plan is attached. Any questions — reply right here.`
  },
  escalationToMaddy: (phone, reason, snippet) =>
    `ESCALATION → ${phone}\nReason: ${reason}\nMessage: ${snippet.slice(0, 280)}`
};
