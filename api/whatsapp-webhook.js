const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { logMessage, canSendTo } = require('../lib/messages');
const {
  maskPhone, detectMarket, detectProgram, needsEscalation, isOptOut,
} = require('../lib/utils');

const MADDY_PHONE = '917082478374';
const SITE = 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.senderPhone || '';
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await logMessage(phone, 'in', text);

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await sendText(MADDY_PHONE,
        `🚨 ESCALATION — ${maskPhone(phone)} said: "${text.slice(0, 200)}". Needs your attention.`
      );
      await logMessage(MADDY_PHONE, 'out', 'Escalation alert', 'escalation');
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString(),
      }).select().single();

      const greeting = market === 'IN'
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a trial session first?";

      const canSend = await canSendTo(phone);
      if (canSend) {
        await sendTemplate(phone, 'welcome_v1', [name || 'there']);
        await logMessage(phone, 'out', greeting, 'welcome_v1');
      }

      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const program = detectProgram(text);
    if (program && existingLead.status === 'new') {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('phone', phone);

      const market = existingLead.market || detectMarket(phone);
      const programMessages = {
        '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: '$35' },
        '6wk_home': { name: '6-Week Burn & Build (Home)', price: '$35' },
        pcos: { name: 'PCOS Warrior Program', price: '$45' },
        '40plus': { name: '40+ Strong Program', price: '$50' },
        '12wk': { name: '12-Week Custom Flagship', price: '$200' },
        zoom_trial: { name: 'Zoom Trial Session', price: '$20' },
      };

      const p = programMessages[program] || programMessages.zoom_trial;
      const msg = market === 'IN'
        ? `Great choice! 🔥 ${p.name} — ${p.price}\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout\n\nIntake form bhi fill karo: ${SITE}/intake.html?lead=${existingLead.id}`
        : `Great choice! 🔥 ${p.name} — ${p.price}\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout\n\nPlease also fill the intake form: ${SITE}/intake.html?lead=${existingLead.id}`;

      const canSend = await canSendTo(phone);
      if (canSend) {
        await sendText(phone, msg);
        await logMessage(phone, 'out', msg, 'program_qualify');
      }

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
