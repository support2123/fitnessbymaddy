const { getSupabase } = require('../lib/supabase');
const { detectMarket, isHinglish } = require('../lib/market');
const { sendTemplate, sendText, logMessage } = require('../lib/whatsapp');
const { checkAndEscalate } = require('../lib/escalation');
const { qualifyLead, getProgramReply } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'whatsapp webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.waId || payload.from;
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    const db = getSupabase();

    await logMessage(phone, 'in', text, null);

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text.trim())) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalated = await checkAndEscalate(phone, text);

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);
      if (!escalated) {
        // Active client messaging — don't auto-reply, just log
      }
      return res.status(200).json({ action: 'client_message_logged' });
    }

    if (existingLead) {
      await db.from('leads').update({
        last_msg_at: new Date().toISOString(),
        name: senderName || existingLead.name
      }).eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'lead_dropped_ignored' });
      }

      const qualification = qualifyLead(text);
      if (qualification) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: qualification.program
        }).eq('id', existingLead.id);

        const reply = getProgramReply(qualification, existingLead.market, existingLead.id);
        await sendText(phone, reply, false);

        return res.status(200).json({ action: 'qualified', program: qualification.program });
      }

      return res.status(200).json({ action: 'lead_updated' });
    }

    // New lead
    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market
    }).select().single();

    await sendTemplate(phone, 'welcome_v1', {
      name: senderName || 'there',
      templateParams: isHinglish(market)
        ? ["Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"]
        : ["Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial first?"]
    });

    // Schedule 2hr nudge via delayed check (handled by nudge-dropped cron)

    return res.status(200).json({ action: 'new_lead', id: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
