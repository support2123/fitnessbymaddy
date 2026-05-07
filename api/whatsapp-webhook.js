const { getClient } = require('../lib/supabase');
const { sendWhatsApp, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { checkEscalation, handleEscalation, isOptOut } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', weight: '6wk_gym', shred: '6wk_gym', burn: '6wk_gym',
  pcos: 'pcos', hormonal: 'pcos',
  '40': '40plus', menopause: '40plus', joints: '40plus',
  custom: '12wk', '12 week': '12wk', serious: '12wk', flagship: '12wk',
  trial: 'zoom_trial', zoom: 'zoom_trial', 'not sure': 'zoom_trial',
  home: '6wk_home',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  pcos: 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  zoom_trial: 'Zoom Trial Session',
  zoom_pack: 'Zoom Pack',
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  pcos: 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  zoom_trial: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone || !message) return res.status(400).json({ error: 'Invalid payload' });

    const db = getClient();

    await logMessage({ phone, direction: 'in', body: message, template_name: null, status: 'received' });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const esc = checkEscalation(message);
    if (esc.escalate) {
      await handleEscalation(phone, message, esc.reason);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status, program')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }
      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
      await handleQualification(db, existingLead, message, phone);
      return res.status(200).json({ action: 'qualified' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message.substring(0, 500),
      market,
    }).select().single();

    const hinglish = isHinglish(market);
    await sendWhatsApp({
      phone,
      templateName: 'welcome_v1',
      bodyValues: [
        name || 'there',
        hinglish
          ? 'Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
          : 'What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?',
      ],
    });

    scheduleNudge(phone, newLead.id);

    return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (body.payload && body.payload.source) {
    return {
      phone: body.payload.source,
      message: body.payload.payload && body.payload.payload.text || body.payload.text || '',
      name: body.payload.sender && body.payload.sender.name || null,
    };
  }
  return {
    phone: body.phone || body.from || body.sender || '',
    message: body.message || body.text || body.body || '',
    name: body.name || body.sender_name || null,
  };
}

async function handleQualification(db, lead, message, phone) {
  const lower = message.toLowerCase();
  let matched = null;

  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) {
      matched = program;
      break;
    }
  }

  if (!matched) return;

  await db.from('leads').update({
    status: 'qualified',
    program_interest: matched,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  const market = lead.market || detectMarket(phone);
  const hinglish = isHinglish(market);
  const programName = PROGRAM_NAMES[matched];
  const checkoutLink = CHECKOUT_LINKS[matched];
  const intakeLink = `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

  await sendWhatsApp({
    phone,
    templateName: 'program_recommendation',
    bodyValues: [
      lead.name || 'there',
      programName,
      checkoutLink,
      intakeLink,
      hinglish
        ? 'Yeh program tumhare liye perfect hai. Checkout karo aur apni journey shuru karo!'
        : 'This program is perfect for you. Complete checkout and start your journey!',
    ],
  });
}

function scheduleNudge(phone, leadId) {
  // Nudge scheduling handled by the cron/nudge-dropped endpoint
  // which checks leads.last_msg_at timestamps
}
