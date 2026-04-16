// Message templates. Each returns { name, body } given market + params.
// `name` must match a WhatsApp template approved in AiSensy/Meta.
// `body` is the rendered copy used when free-form session messaging is allowed
// (within 24h of an inbound user message).

import { langFor } from './market.js';

const T = {
  welcome_v1: {
    hinglish: () =>
      "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?",
    english: () =>
      "Hi! This is Maddy's team 👋 What's the goal — fat loss, PCOS, strength, or 40+ fitness? Or would you like to start with a trial?"
  },
  nudge_trial: {
    hinglish: () =>
      "Still thinking? No pressure 🤍 Ek $20 Zoom trial se shuru karein — 45 min, 1-on-1 with Maddy. Book: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial",
    english: () =>
      "Still deciding? No pressure 🤍 Start with a $20 Zoom trial — 45 min, 1-on-1 with Maddy. Book: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial"
  },
  qualify_link: {
    hinglish: ({ checkoutUrl, intakeUrl, programName }) =>
      `Perfect — ${programName} tere goal ke liye fit hai.\n\n1) Payment: ${checkoutUrl}\n2) Quick intake form: ${intakeUrl}\n\nPayment ke baad WhatsApp pe onboarding aayega.`,
    english: ({ checkoutUrl, intakeUrl, programName }) =>
      `Great — ${programName} is the right fit.\n\n1) Payment: ${checkoutUrl}\n2) Quick intake form: ${intakeUrl}\n\nOnboarding hits your WhatsApp right after payment.`
  },
  onboard_6wk_gym:  { hinglish: ({ name }) => `Welcome ${name || 'champ'} 🔥 Tera 6-Week Burn & Build program active hai. Day-1 workout abhi bhej rahi hoon. Har Sunday ek chhota check-in form aayega.`,
                       english:  ({ name }) => `Welcome ${name || 'champ'} 🔥 Your 6-Week Burn & Build is live. Day-1 workout dropping now. Every Sunday a quick check-in form will arrive.` },
  onboard_6wk_home: { hinglish: ({ name }) => `Welcome ${name || 'champ'} 🏠 6-Week Home Edition start. Minimal equipment, full output. Day-1 drop aa raha hai.`,
                       english:  ({ name }) => `Welcome ${name || 'champ'} 🏠 6-Week Home Edition starts now. Minimal equipment, full output. Day-1 incoming.` },
  onboard_12wk:     { hinglish: ({ name }) => `Welcome ${name || 'champ'} ⭐ 12-Week Flagship unlock. Tera Week-1 custom plan generate ho raha hai — 24 hrs ke andar milega.`,
                       english:  ({ name }) => `Welcome ${name || 'champ'} ⭐ 12-Week Flagship unlocked. Your Week-1 custom plan is being generated — arrives within 24 hrs.` },
  onboard_pcos:     { hinglish: ({ name }) => `Welcome ${name || 'queen'} 🌸 PCOS Warrior program active. Hormonal-friendly workouts + nutrition, gently progressive.`,
                       english:  ({ name }) => `Welcome ${name || 'queen'} 🌸 PCOS Warrior is live. Hormone-friendly workouts + nutrition, gently progressive.` },
  onboard_40plus:   { hinglish: ({ name }) => `Welcome ${name || 'champ'} 💪 40+ Strong shuru. Joint-safe, mobility-first, real-life strong.`,
                       english:  ({ name }) => `Welcome ${name || 'champ'} 💪 40+ Strong starts now. Joint-safe, mobility-first, real-life strong.` },
  onboard_zoom_trial: { hinglish: ({ name }) => `Booked! ${name || ''} Zoom link email pe bheja hai. See you on the call 📹`,
                       english:  ({ name }) => `Booked! ${name || ''} Zoom link is in your email. See you on the call 📹` },
  onboard_zoom_pack: { hinglish: ({ name }) => `Welcome ${name || 'champ'} 📹 Zoom pack active. Pehli slot calendar invite email pe.`,
                       english:  ({ name }) => `Welcome ${name || 'champ'} 📹 Zoom pack active. First slot invite is in your email.` },

  checkin_request: {
    hinglish: ({ weekNo, url }) =>
      `Week ${weekNo} check-in time 📋 Ye link open kar, 2 min lagega: ${url}\nWeight, waist, photos + ek mood line. Next week ka plan isi pe depend karta hai.`,
    english: ({ weekNo, url }) =>
      `Week ${weekNo} check-in 📋 Open this — 2 min job: ${url}\nWeight, waist, photos + one mood line. Next week's plan depends on it.`
  },
  checkin_nudge_24h: {
    hinglish: ({ url }) => `Reminder 🫶 Check-in pending hai: ${url}`,
    english:  ({ url }) => `Gentle reminder 🫶 Check-in still pending: ${url}`
  },
  checkin_nudge_48h: {
    hinglish: ({ url }) => `Last nudge — check-in kar de taaki next week ka plan time pe bana sakein 🙏 ${url}`,
    english:  ({ url }) => `Last nudge — please submit so next week's plan lands on time 🙏 ${url}`
  },

  program_delivery: {
    hinglish: ({ weekNo, contextLine }) =>
      `Week ${weekNo} plan ready ⬇️\n${contextLine}\nPDF attached. Chal, shuru karte hain.`,
    english: ({ weekNo, contextLine }) =>
      `Week ${weekNo} plan is ready ⬇️\n${contextLine}\nPDF attached. Let's move.`
  },

  reengage_7day: {
    hinglish: () =>
      "Hey! 7 din ho gaye. Abhi bhi trial available hai — $20 Zoom with Maddy. Interested? 🙌",
    english: () =>
      "Hey! It's been a week. The $20 Zoom trial with Maddy is still on if you'd like to start there. 🙌"
  }
};

export function render(name, market, params = {}) {
  const tpl = T[name];
  if (!tpl) throw new Error(`Unknown template: ${name}`);
  const lang = langFor(market);
  const fn = tpl[lang] || tpl.english;
  return { name, body: fn(params) };
}
