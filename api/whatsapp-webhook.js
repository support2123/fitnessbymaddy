const { getSupabase } = require('./lib/supabase');
const { detectMarket, sendTemplate, sendMessage, needsEscalation, detectProgram, maskPhone } = require('./lib/whatsapp');
const { canSendMessage, logMessage } = require('./lib/ratelimit');

const MADDY_PHONE = '917082478374';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const payload = req.body;

  const phone = payload.senderPhone || payload.from || payload.waId;
  const messageBody = payload.text || payload.message || payload.body || '';
  const senderName = payload.senderName || payload.pushName || '';

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  await logMessage(phone, 'in', messageBody);

  if (/^(stop|unsubscribe|opt.?out)$/i.test(messageBody.trim())) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(messageBody)) {
    await sendMessage(MADDY_PHONE,
      `🚨 ESCALATION: Message from ${maskPhone(phone)}\n"${messageBody.slice(0, 200)}"\nNeeds your attention.`
    );
    await logMessage(MADDY_PHONE, 'out', '[escalation alert]', 'escalation');
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: messageBody,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString(),
    }).select().single();

    const greeting = market === 'IN'
      ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
      : 'Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or want to try a trial session first?';

    if (await canSendMessage(phone)) {
      await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
      await logMessage(phone, 'out', greeting, 'welcome_v1');
    }

    return res.status(200).json({ action: 'new_lead', id: newLead?.id });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  if (existingLead.status === 'new') {
    const program = detectProgram(messageBody);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('id', existingLead.id);

      const market = existingLead.market || 'GLOBAL';
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      let reply;
      if (market === 'IN') {
        reply = `Perfect! Tumhare liye best program mil gaya 🔥\n\nCheckout: ${checkoutUrl}\n\nIntake form bhi fill karo: ${intakeUrl}`;
      } else {
        reply = `Perfect! Found the best program for you 🔥\n\nCheckout: ${checkoutUrl}\n\nPlease also fill the intake form: ${intakeUrl}`;
      }

      if (await canSendMessage(phone)) {
        await sendMessage(phone, reply);
        await logMessage(phone, 'out', reply, 'program_match');
      }

      return res.status(200).json({ action: 'qualified', program });
    }
  }

  return res.status(200).json({ action: 'acknowledged' });
};
