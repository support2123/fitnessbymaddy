const { getSupabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

const TEMPLATES = {
  welcome_v1: {
    template_name: 'welcome_v1',
    body: "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
  },
  nudge_trial: {
    template_name: 'nudge_trial',
    body: "Hey! Maddy ka $20 Zoom trial try karo — full session, zero commitment. Link: https://fitnessbymaddy.com/program-trial.html"
  },
  onboard_6wk_gym: {
    template_name: 'onboard_6wk_gym',
    body: "Welcome to the 6-Week Burn & Build! 🔥 Your program starts now. Check your email for the full plan. Weekly check-in forms aayenge har Sunday."
  },
  onboard_12wk: {
    template_name: 'onboard_12wk',
    body: "Welcome to Maddy's 12-Week Flagship Program! 💪 Your Week 1 plan is being generated. You'll receive it within 24 hours on WhatsApp."
  },
  onboard_pcos: {
    template_name: 'onboard_pcos',
    body: "Welcome to PCOS Warrior! 🌸 Your customised plan is ready. Check your email and watch for your weekly check-in every Sunday."
  },
  onboard_40plus: {
    template_name: 'onboard_40plus',
    body: "Welcome to 40+ Strong! 💪 Your program is designed for sustainable strength. Check your email for details."
  },
  onboard_zoom_trial: {
    template_name: 'onboard_zoom_trial',
    body: "Your Zoom trial is booked! 🎯 Maddy's team will send you the session link within 24 hours."
  },
  checkin_reminder: {
    template_name: 'checkin_reminder',
    body: "Hey! Time for your weekly check-in 📋 Fill this out so Maddy can update your plan: {{link}}"
  },
  checkin_nudge: {
    template_name: 'checkin_nudge',
    body: "Reminder: Your weekly check-in is still pending! Submit it here so your next week's plan stays on track: {{link}}"
  },
  program_delivery: {
    template_name: 'program_delivery',
    body: "Your Week {{week}} plan is ready! 🏋️ {{note}}"
  },
  escalation_maddy: {
    template_name: 'escalation_maddy',
    body: "⚠️ ESCALATION: {{reason}} — Client: {{name}} ({{phone}}). Please review."
  }
};

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

async function sendWhatsApp(phone, templateName, params = {}) {
  const db = getSupabase();
  const apiKey = process.env.AISENSY_API_KEY;

  const template = TEMPLATES[templateName];
  if (!template) {
    throw new Error(`Unknown template: ${templateName}`);
  }

  let body = template.body;
  for (const [key, val] of Object.entries(params)) {
    body = body.replace(`{{${key}}}`, val);
  }

  const lastMsg = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  if (lastMsg.data) {
    const elapsed = Date.now() - new Date(lastMsg.data.sent_at).getTime();
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const isClient = params._isClient;
    if (!isClient && elapsed < TWO_HOURS) {
      console.log(`Rate limited: ${maskPhone(phone)}, last msg ${Math.round(elapsed / 60000)}m ago`);
      return { rateLimited: true };
    }
  }

  let status = 'sent';
  try {
    const res = await fetch(AISENSY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        apiKey,
        campaignName: templateName,
        destination: phone.replace(/^\+/, ''),
        userName: params.name || 'there',
        templateParams: Object.values(params).filter(v => typeof v === 'string'),
        source: 'automation',
        media: params._mediaUrl ? { url: params._mediaUrl, filename: params._filename || 'program.pdf' } : undefined
      })
    });

    if (!res.ok) {
      status = 'failed';
      console.error(`WhatsApp send failed for ${maskPhone(phone)}: ${res.status}`);
    }
  } catch (err) {
    status = 'failed';
    console.error(`WhatsApp send error for ${maskPhone(phone)}: ${err.message}`);
  }

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status
  });

  return { status };
}

async function logInboundMessage(phone, body) {
  const db = getSupabase();
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body,
    sent_at: new Date().toISOString(),
    status: 'received'
  });
}

module.exports = {
  sendWhatsApp,
  logInboundMessage,
  detectMarket,
  isHinglish,
  maskPhone,
  TEMPLATES
};
