// Pre-defined message bodies, keyed by template + market.
// `name` MUST match templates pre-approved in AiSensy / Meta.
import { isHinglishMarket } from './market.js';

export function template(name, market, vars = {}) {
  const hinglish = isHinglishMarket(market);
  const t = TEMPLATES[name];
  if (!t) throw new Error(`Unknown template: ${name}`);
  const lang = hinglish ? (t.hi || t.en) : t.en;
  return {
    name,
    body: lang.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? ''),
  };
}

const TEMPLATES = {
  welcome_v1: {
    en: "Hi! Maddy's team here 👋 What's the goal — fat loss, PCOS, strength, or 40+ fitness? Or want to try a trial first?",
    hi: "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?",
  },
  nudge_trial: {
    en: "Still thinking? Try a $20 Zoom trial first — quick form, then you'll know if it's a fit: {{trial_url}}",
    hi: "Soch rahi/raha ho? $20 Zoom trial try karo — chhota form, fir decide karo: {{trial_url}}",
  },
  qualify_6wk: {
    en: "Got it — 6-Week Burn & Build is for you. Checkout: {{checkout_url}}\nIntake form (2 min): {{intake_url}}",
    hi: "Perfect — 6-Week Burn & Build best rahega. Payment: {{checkout_url}}\nIntake form (2 min): {{intake_url}}",
  },
  qualify_pcos: {
    en: "PCOS Warrior ($45) is built for hormonal balance + fat loss. Checkout: {{checkout_url}}\nIntake (2 min): {{intake_url}}",
    hi: "PCOS Warrior ($45) — hormonal balance + fat loss ke liye. Payment: {{checkout_url}}\nIntake (2 min): {{intake_url}}",
  },
  qualify_40plus: {
    en: "40+ Strong ($50) — joint-safe strength + energy. Checkout: {{checkout_url}}\nIntake (2 min): {{intake_url}}",
    hi: "40+ Strong ($50) — joints safe, strength + energy build karega. Payment: {{checkout_url}}\nIntake (2 min): {{intake_url}}",
  },
  qualify_12wk: {
    en: "12-Week Flagship ($200) — fully personalised, weekly programs. Checkout: {{checkout_url}}\nIntake (3 min): {{intake_url}}",
    hi: "12-Week Flagship ($200) — fully personalised, weekly plan. Payment: {{checkout_url}}\nIntake (3 min): {{intake_url}}",
  },
  qualify_trial: {
    en: "$20 Zoom trial — 1 live session + plan preview. Book: {{checkout_url}}",
    hi: "$20 Zoom trial — 1 live session + plan preview. Book: {{checkout_url}}",
  },
  onboard_default: {
    en: "Welcome to Fitness by Maddy 🎉 You're locked in. Your private folder is ready. First check-in lands in 7 days. Reply STOP to opt out anytime.",
    hi: "Welcome to Fitness by Maddy 🎉 You're locked in. Aapka private folder ready hai. Pehla check-in 7 din mein. STOP reply karo opt out ke liye.",
  },
  onboard_12wk: {
    en: "Welcome to the 12-Week Flagship 🎉 Week 1 plan is being built — drops in your WhatsApp shortly. Save this number.",
    hi: "Welcome to 12-Week Flagship 🎉 Week 1 plan ban raha hai — thodi der mein WhatsApp pe milega. Number save kar lo.",
  },
  checkin_request: {
    en: "Week {{week_no}} check-in time 💪 Quick 2-min form: {{form_url}}",
    hi: "Week {{week_no}} ka check-in time 💪 2 min ka form: {{form_url}}",
  },
  checkin_nudge: {
    en: "Hey! Don't forget your Week {{week_no}} check-in — takes 2 min: {{form_url}}",
    hi: "Hey! Week {{week_no}} check-in bhul gaye — 2 min ka kaam hai: {{form_url}}",
  },
  weekly_program: {
    en: "Week {{week_no}} plan is ready 📄 {{note}}\n{{pdf_url}}",
    hi: "Week {{week_no}} plan ready hai 📄 {{note}}\n{{pdf_url}}",
  },
  reengage_dropped: {
    en: "Hi again — still thinking about getting started? The $20 trial is the easiest way in: {{trial_url}}",
    hi: "Hi again — abhi bhi soch rahe ho? $20 trial sabse easy entry hai: {{trial_url}}",
  },
};
