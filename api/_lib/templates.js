// WhatsApp message bodies (Hinglish for IN, English otherwise).
// Template names must match AiSensy / Meta approved templates 1:1.

export const TEMPLATES = {
  welcome_v1: {
    name: 'welcome_v1',
    body: {
      hinglish: "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?",
      en: "Hi! Maddy's team here 👋 What's your main goal — fat loss, PCOS, strength, or 40+ fitness? Or want to start with a trial?"
    }
  },
  nudge_trial: {
    name: 'nudge_trial',
    body: {
      hinglish: "Thoda sochne ka time lelo — aur agar try karna ho toh yahan se $20 Zoom trial book kar sakte ho: {{url}}",
      en: "Take your time — if you'd like to try first, grab a $20 Zoom trial here: {{url}}"
    }
  },
  program_cta: {
    name: 'program_cta',
    body: {
      hinglish: "Perfect 🙌 {{label}} tumhare liye fit hai. Checkout: {{checkout}}\nAur intake form: {{intake}} (2 min, so Maddy can customise)",
      en: "Great 🙌 {{label}} is the right fit. Checkout: {{checkout}}\nIntake form: {{intake}} (2 min — lets Maddy customise)"
    }
  },
  onboard_12wk: {
    name: 'onboard_12wk',
    body: {
      hinglish: "Welcome to 12-Week Flagship, {{name}}! 🔥 Week-1 plan aaj bhej rahe hain. Check-ins har Sunday.",
      en: "Welcome to the 12-Week Flagship, {{name}}! 🔥 Week-1 plan is on the way. Check-ins every Sunday."
    }
  },
  onboard_6wk_gym: {
    name: 'onboard_6wk_gym',
    body: {
      hinglish: "Swagat hai, {{name}}! 💪 6-Week Burn & Build ka plan tumhare folder mein hai. Har Sunday ek check-in bhejenge.",
      en: "Welcome, {{name}}! 💪 Your 6-Week Burn & Build plan is in your folder. Sunday check-ins on the way."
    }
  },
  onboard_6wk_home: {
    name: 'onboard_6wk_home',
    body: {
      hinglish: "Swagat hai, {{name}}! 🏠 Home version ka plan ready hai. Koi equipment nahi chahiye. Sunday check-ins follow karenge.",
      en: "Welcome, {{name}}! 🏠 Your home plan is ready — no equipment needed. Sunday check-ins coming."
    }
  },
  onboard_pcos: {
    name: 'onboard_pcos',
    body: {
      hinglish: "Welcome to PCOS Warrior, {{name}} 💛 Hormone-friendly training + nutrition plan ready hai. Sunday check-in forms bhejenge.",
      en: "Welcome to PCOS Warrior, {{name}} 💛 Hormone-friendly training + nutrition plan ready. Sunday check-ins follow."
    }
  },
  onboard_40plus: {
    name: 'onboard_40plus',
    body: {
      hinglish: "Welcome to 40+ Strong, {{name}} 💪 Joint-safe, sustainable plan tumhare folder mein hai.",
      en: "Welcome to 40+ Strong, {{name}} 💪 Joint-safe, sustainable plan is in your folder."
    }
  },
  onboard_zoom_trial: {
    name: 'onboard_zoom_trial',
    body: {
      hinglish: "Zoom trial confirm ho gaya, {{name}}! Booking link aa raha hai — time choose karo.",
      en: "Your Zoom trial is confirmed, {{name}}! Booking link incoming — pick a slot."
    }
  },
  onboard_zoom_pack: {
    name: 'onboard_zoom_pack',
    body: {
      hinglish: "Zoom pack active hai, {{name}}! Sessions schedule karne ke liye link bhej rahe hain.",
      en: "Your Zoom pack is active, {{name}}! Scheduling link on its way."
    }
  },
  weekly_checkin_prompt: {
    name: 'weekly_checkin_prompt',
    body: {
      hinglish: "Hi {{name}}, Week {{week}} check-in time ⏱️\nYeh form 2 min mein fill kar do: {{url}}",
      en: "Hi {{name}}, Week {{week}} check-in time ⏱️\nThe form takes 2 minutes: {{url}}"
    }
  },
  checkin_nudge: {
    name: 'checkin_nudge',
    body: {
      hinglish: "Quick reminder — Week {{week}} check-in abhi bhi pending hai 🙏 {{url}}",
      en: "Quick reminder — Week {{week}} check-in is still pending 🙏 {{url}}"
    }
  },
  program_ready: {
    name: 'program_ready',
    body: {
      hinglish: "{{name}}, Week {{week}} plan ready hai 📄 {{note}}\nPDF: {{url}}",
      en: "{{name}}, Week {{week}} plan is ready 📄 {{note}}\nPDF: {{url}}"
    }
  },
  reengage_7d: {
    name: 'reengage_7d',
    body: {
      hinglish: "Hi! Tumne last week message kiya tha — agar goals pe kaam shuru karna ho, $20 trial se start kar sakte ho: {{url}}",
      en: "Hi! You messaged us last week — if you'd like to start on your goals, the $20 trial is a simple first step: {{url}}"
    }
  },
  opt_out_ack: {
    name: 'opt_out_ack',
    body: {
      hinglish: "Samajh gaye — aapko aur messages nahi bhejenge. Goodbye 🙏",
      en: "Understood — you won't receive any further messages from us. Take care 🙏"
    }
  }
};

export function render(tpl, lang, vars = {}) {
  const body = TEMPLATES[tpl]?.body?.[lang] || TEMPLATES[tpl]?.body?.en || '';
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));
}
