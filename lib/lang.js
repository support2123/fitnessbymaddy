// Market + language routing from phone country code.

export function detectMarket(phoneE164) {
  if (!phoneE164) return 'GLOBAL';
  const p = String(phoneE164);
  if (p.startsWith('+91')) return 'IN';
  if (p.startsWith('+971')) return 'UAE';
  if (p.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

export function isHinglishMarket(market) {
  return market === 'IN';
}

// Safe, templated copy blocks. Keep templates mirrored in AiSensy.
export const COPY = {
  welcome_v1: {
    IN: "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?",
    EN: "Hi! Maddy's team here 👋 What's the goal — fat loss, PCOS, strength, or 40+ fitness? Or want to try a trial session first?"
  },
  nudge_trial: {
    IN: "Soch rahe ho? Pehle ek $20 Zoom trial try karlo — zero pressure. Link: {link}",
    EN: "Still deciding? Try a $20 Zoom trial first — zero pressure. Link: {link}"
  },
  nudge_dropped: {
    IN: "Hey! Still thinking about your fitness goal? Maddy ne aapke liye ek starter plan rakha hai. Reply 'YES' if interested.",
    EN: "Hey! Still thinking about your fitness goal? Maddy kept a starter plan for you. Reply 'YES' if interested."
  },
  checkout_link: {
    IN: "Yeh raha aapka checkout link — {link}\nIntake form (2 min): {intake}",
    EN: "Here's your checkout link — {link}\nIntake form (2 min): {intake}"
  },
  onboard_12wk: {
    IN: "Welcome to the 12-Week Flagship 🎯 Aapka Week 1 plan 24 hrs ke andar bheja jayega. Intake form: {intake}",
    EN: "Welcome to the 12-Week Flagship 🎯 Your Week 1 plan arrives within 24 hrs. Intake form: {intake}"
  },
  onboard_generic: {
    IN: "Welcome! Aapka program activate ho gaya hai 💪 Intake form complete karo: {intake}",
    EN: "Welcome! Your program is active 💪 Please complete the intake form: {intake}"
  },
  checkin_invite: {
    IN: "Week {week} check-in time! 2 min lagenge: {link}",
    EN: "Week {week} check-in time — takes 2 min: {link}"
  },
  checkin_nudge: {
    IN: "Friendly reminder — Week {week} check-in pending: {link}",
    EN: "Friendly reminder — Week {week} check-in pending: {link}"
  },
  program_delivery: {
    IN: "Week {week} plan ready ✨ Focus: {focus}\nPDF: {link}",
    EN: "Week {week} plan ready ✨ Focus: {focus}\nPDF: {link}"
  },
  escalation_ack: {
    IN: "Thanks for sharing. Maddy personally review karegi aur jaldi wapas reply karegi.",
    EN: "Thanks for sharing. Maddy will personally review this and reply shortly."
  }
};

export function copyFor(templateName, market, vars = {}) {
  const bundle = COPY[templateName];
  if (!bundle) return '';
  const key = isHinglishMarket(market) ? 'IN' : 'EN';
  const tmpl = bundle[key] || bundle.EN;
  return tmpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}
