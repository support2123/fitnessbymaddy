const { supabase } = require('../lib/supabase');
const { sendTemplate, logMessage, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, getEscalationReason } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight loss': '6wk_gym', 'weight': '6wk_gym',
  'shred': '6wk_gym', 'fat': '6wk_gym', 'lose weight': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40+': '40plus', '40 plus': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', '12wk': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Flagship Program',
  'zoom_trial': '$20 Zoom Trial Session'
};

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.from || payload.senderMobile);
    const message = (payload.message || payload.text || payload.body || '').trim();
    const name = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    await logMessage(phone, 'in', message, null);

    if (isOptOut(message)) {
      await handleOptOut(phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const reason = getEscalationReason(message);
      await notifyMaddy(
        'Lead/Client needs attention',
        `Phone: ${maskPhone(phone)}\nMessage: ${message}\nTrigger: ${reason}`
      );
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      return res.json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.json({ action: 'dropped_lead' });
      }

      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      const program = matchProgram(message);
      if (program) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const market = existingLead.market;
        const hinglish = isHinglish(market);
        const programName = PROGRAM_NAMES[program];
        const checkoutUrl = CHECKOUT_URLS[program];
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const msg = hinglish
          ? `${programName} — perfect choice! Yeh raha checkout link: ${checkoutUrl}\n\nSaath mein yeh intake form bhi fill karo: ${intakeUrl}`
          : `Great choice — ${programName}! Here's your checkout link: ${checkoutUrl}\n\nAlso fill out this quick intake form: ${intakeUrl}`;

        await sendTemplate(phone, 'program_checkout', {
          name: existingLead.name || 'there',
          templateParams: [msg]
        }, false);

        return res.json({ action: 'qualified', program });
      }

      return res.json({ action: 'existing_lead' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market
      })
      .select()
      .single();

    const hinglish = isHinglish(market);
    const welcomeMsg = hinglish
      ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

    await sendTemplate(phone, 'welcome_v1', {
      name: name || 'there',
      templateParams: [welcomeMsg]
    }, false);

    scheduleNudges(newLead.id, phone, hinglish);

    return res.json({ action: 'new_lead', lead_id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
};

function normalizePhone(raw) {
  if (!raw) return null;
  let phone = raw.replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;
  return phone;
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

async function handleOptOut(phone) {
  await supabase
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);
}

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

async function scheduleNudges(leadId, phone, hinglish) {
  // 2-hour nudge: mark for cron pickup
  await supabase.from('leads').update({
    nudge_2hr_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  }).eq('id', leadId).then(() => {});

  // 24-hour drop: handled by nudge-dropped cron
}
