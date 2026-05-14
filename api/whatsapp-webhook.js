const { supabase } = require('../lib/supabase');
const { sendTemplate, logIncoming, isRateLimited } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, notifyMaddy } = require('../lib/escalation');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/pii');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'fat', 'slim', 'lean'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
  '40plus': ['40', 'menopause', 'joints', 'joint', 'senior', 'age'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test'],
};

const CHECKOUT_BASE = 'https://fitnessbymaddyy.exlyapp.com/checkout';
const SITE_BASE = 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const body = payload.message || payload.text || payload.body || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logIncoming(phone, body);

    if (/^(stop|unsubscribe|opt.?out)$/i.test(body.trim())) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(body)) {
      await notifyMaddy(supabase, sendWhatsApp,
        'Incoming message needs review',
        `From: ${maskPhone(phone)}\nMessage: ${body.slice(0, 200)}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, body, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'new') {
      return await handleQualification(phone, body, existingLead, res);
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, body, res) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    first_msg: body,
    market,
    status: 'new',
  });

  const welcome = isHinglish(market)
    ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

  await sendTemplate(phone, 'welcome_v1', []);

  return res.status(200).json({ action: 'new_lead_welcomed', market });
}

async function handleQualification(phone, body, lead, res) {
  const lower = body.toLowerCase();
  let matchedProgram = null;

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      matchedProgram = program;
      break;
    }
  }

  if (!matchedProgram) {
    if (await isRateLimited(phone)) {
      return res.status(200).json({ action: 'rate_limited' });
    }

    const market = lead.market || detectMarket(phone);
    const clarify = isHinglish(market)
      ? "Got it! Mujhe thoda aur batao — fat loss chahiye, PCOS help, 40+ fitness, ya full 12-week custom program? Ya pehle $20 zoom trial try karo?"
      : "Got it! Tell me more — are you looking for fat loss, PCOS help, 40+ fitness, or a full 12-week custom program? Or try our $20 zoom trial first?";

    await sendWhatsApp(phone, clarify, 'clarify_goal');
    return res.status(200).json({ action: 'asked_clarification' });
  }

  await supabase.from('leads')
    .update({ status: 'qualified', program_interest: matchedProgram })
    .eq('phone', phone);

  const market = lead.market || detectMarket(phone);
  const programInfo = getProgramInfo(matchedProgram, market);

  await sendWhatsApp(phone, programInfo.message, 'program_offer');

  return res.status(200).json({ action: 'qualified', program: matchedProgram });
}

function getProgramInfo(program, market) {
  const hinglish = isHinglish(market);
  const intakeLink = `${SITE_BASE}/intake`;

  const programs = {
    '6wk_gym': {
      name: '6-Week Burn & Build',
      price: '$45',
      message: hinglish
        ? `Perfect choice! 🔥 6-Week Burn & Build program — structured workouts + nutrition for just $45.\n\nCheckout: ${CHECKOUT_BASE}/6wk\n\nIntake form bhi fill karo: ${intakeLink}`
        : `Perfect choice! 🔥 6-Week Burn & Build program — structured workouts + nutrition for just $45.\n\nCheckout: ${CHECKOUT_BASE}/6wk\n\nPlease also fill the intake form: ${intakeLink}`,
    },
    'pcos': {
      name: 'PCOS Warrior',
      price: '$45',
      message: hinglish
        ? `PCOS Warrior program 💪 Specifically designed for hormonal balance + fat loss — $45.\n\nCheckout: ${CHECKOUT_BASE}/pcos\n\nIntake form: ${intakeLink}`
        : `PCOS Warrior program 💪 Specifically designed for hormonal balance + fat loss — $45.\n\nCheckout: ${CHECKOUT_BASE}/pcos\n\nIntake form: ${intakeLink}`,
    },
    '40plus': {
      name: '40+ Strong',
      price: '$50',
      message: hinglish
        ? `40+ Strong program 🏋️ Joint-friendly, strength-focused training — $50.\n\nCheckout: ${CHECKOUT_BASE}/40plus\n\nIntake form: ${intakeLink}`
        : `40+ Strong program 🏋️ Joint-friendly, strength-focused training — $50.\n\nCheckout: ${CHECKOUT_BASE}/40plus\n\nIntake form: ${intakeLink}`,
    },
    '12wk': {
      name: '12-Week Flagship',
      price: '$200',
      message: hinglish
        ? `Amazing! ⭐ 12-Week Flagship Program — Maddy ka fully customised program, weekly adjustments — $200.\n\nCheckout: ${CHECKOUT_BASE}/12wk\n\nIntake form zaroor fill karo: ${intakeLink}`
        : `Amazing! ⭐ 12-Week Flagship Program — Maddy's fully customised program with weekly adjustments — $200.\n\nCheckout: ${CHECKOUT_BASE}/12wk\n\nPlease fill the intake form: ${intakeLink}`,
    },
    'zoom_trial': {
      name: 'Zoom Trial',
      price: '$20',
      message: hinglish
        ? `Smart move! 👍 $20 Zoom trial — Maddy ke saath live session.\n\nCheckout: ${CHECKOUT_BASE}/trial\n\nIntake form: ${intakeLink}`
        : `Smart move! 👍 $20 Zoom trial — a live session with Maddy.\n\nCheckout: ${CHECKOUT_BASE}/trial\n\nIntake form: ${intakeLink}`,
    },
  };

  return programs[program] || programs['zoom_trial'];
}
