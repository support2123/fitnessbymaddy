const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendText, notifyMaddy, logIncoming, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { checkEscalation, checkOptOut } = require('./_lib/escalation');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', 'weight loss': '6wk_gym', 'weight': '6wk_gym',
  'shred': '6wk_gym', 'fat': '6wk_gym', 'patla': '6wk_gym', 'lose': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos', 'pcod': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'full': '12wk', 'premium': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Training',
  'zoom_trial': 'Zoom Trial Session'
};

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.senderPhone || payload.from;
    const message = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logIncoming(phone, message);
    const sb = getSupabase();

    if (checkOptOut(message)) {
      await sb.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await sb.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const esc = checkEscalation(message);
    if (esc.escalate) {
      await notifyMaddy(
        `🚨 ESCALATION\nFrom: ${maskPhone(phone)}\nReason: "${esc.reason}"\nMsg: ${message.slice(0, 200)}`
      );
    }

    const { data: existingClient } = await sb
      .from('clients')
      .select('id, program, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      if (esc.escalate) {
        return res.status(200).json({ action: 'escalated_client' });
      }
      return res.status(200).json({ action: 'active_client_msg_logged' });
    }

    const { data: existingLead } = await sb
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead_ignored' });
      }

      await sb.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

      const program = matchProgram(message);
      if (program) {
        await sb.from('leads').update({
          status: 'qualified',
          program_interest: program
        }).eq('id', existingLead.id);

        const market = detectMarket(phone);
        const hinglish = isHinglish(market);
        const programName = PROGRAM_NAMES[program];

        const checkoutMsg = hinglish
          ? `${programName} — perfect choice! 💪\nYahan se start karo:\nhttps://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nIntake form bhi fill karo:\nhttps://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`
          : `${programName} — great choice! 💪\nGet started here:\nhttps://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nAlso fill your intake form:\nhttps://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        await sendText(phone, checkoutMsg);
        return res.status(200).json({ action: 'qualified', program });
      }

      return res.status(200).json({ action: 'existing_lead_msg_logged' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await sb.from('leads').insert({
      phone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      market
    }).select().single();

    const hinglish = isHinglish(market);
    const welcomeMsg = hinglish
      ? `Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?`
      : `Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?`;

    await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);

    setTimeout(async () => {
      const { data: lead } = await sb.from('leads').select('status').eq('id', newLead.id).single();
      if (lead && lead.status === 'new') {
        const nudgeMsg = hinglish
          ? `Abhi tak decide nahi hua? Koi baat nahi! Pehle ek trial session try karo — sirf $20 mein 💪\nhttps://www.fitnessbymaddy.com/intake?lead=${newLead.id}&trial=1`
          : `Still thinking? No worries! Try a trial session first — just $20 💪\nhttps://www.fitnessbymaddy.com/intake?lead=${newLead.id}&trial=1`;
        await sendTemplate(phone, 'nudge_trial', []);
      }
    }, 2 * 60 * 60 * 1000);

    return res.status(200).json({ action: 'new_lead', id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
