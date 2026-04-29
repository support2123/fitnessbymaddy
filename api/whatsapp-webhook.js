const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, normalizePhone, maskPhone } = require('../lib/phone');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'burn': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'hormone': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'custom': '12wk',
  '12 week': '12wk',
  'serious': '12wk',
  'flagship': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
  'try': 'zoom_trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Flagship',
  'zoom_trial': '$20 Zoom Trial'
};

const PROGRAM_PRICES = {
  '6wk_gym': '$97',
  'pcos': '$45',
  '40plus': '$50',
  '12wk': '$200',
  'zoom_trial': '$20'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.from || payload.senderPhone || '');
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();
    const market = detectMarket(phone);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Flagged message from lead', { phone: maskPhone(phone), message });
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        market
      });

      const welcomeMsg = market === 'IN'
        ? 'Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Maddy\'s team here. What\'s your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        params: [name || 'there']
      });

      scheduleNudge(db, phone, market);

      return res.status(200).json({ action: 'new_lead', market });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    const matchedProgram = matchProgram(message);
    if (matchedProgram) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: matchedProgram
      }).eq('phone', phone);

      const programName = PROGRAM_NAMES[matchedProgram];
      const price = PROGRAM_PRICES[matchedProgram];
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const replyMsg = market === 'IN'
        ? `Great choice! ${programName} (${price}) aapke liye perfect hai.\n\nCheckout: ${checkoutUrl}\n\nSaath mein ye form bhi fill kardo: ${intakeUrl}`
        : `Great choice! ${programName} (${price}) is perfect for you.\n\nCheckout: ${checkoutUrl}\n\nAlso fill this quick form: ${intakeUrl}`;

      await sendWhatsApp({
        phone,
        templateName: 'program_recommendation',
        params: [name || 'there', programName, price]
      });

      return res.status(200).json({ action: 'qualified', program: matchedProgram });
    }

    return res.status(200).json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

async function scheduleNudge(db, phone, market) {
  const twoHours = 2 * 60 * 60 * 1000;
  const twentyFourHours = 24 * 60 * 60 * 1000;

  setTimeout(async () => {
    try {
      const { data: lead } = await db.from('leads').select('status').eq('phone', phone).single();
      if (lead && lead.status === 'new') {
        await sendWhatsApp({
          phone,
          templateName: 'nudge_trial',
          params: ['https://fitnessbymaddy.com/program-trial.html']
        });
      }
    } catch (e) {
      console.error('Nudge 2hr error:', e.message);
    }
  }, twoHours);

  setTimeout(async () => {
    try {
      const { data: lead } = await db.from('leads').select('status').eq('phone', phone).single();
      if (lead && lead.status === 'new') {
        await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      }
    } catch (e) {
      console.error('Drop 24hr error:', e.message);
    }
  }, twentyFourHours);
}
