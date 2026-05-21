const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { matchProgram, isOptOut } = require('../lib/keywords');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const body = req.body;
    const phone = body.mobile || body.senderMobile || body.from;
    const text = body.text || body.message || body.body || '';
    const senderName = body.senderName || body.name || null;

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text.slice(0, 1000),
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy({
        reason: 'Sensitive keyword detected',
        phone,
        details: text,
      });
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
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text.slice(0, 500),
        last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      const hinglish = isHinglish(market);
      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        bodyValues: hinglish
          ? [senderName || 'there']
          : [senderName || 'there'],
      });

      scheduleNudge(db, phone, newLead?.id);

      return res.json({ action: 'new_lead', lead_id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.json({ action: 'active_client_msg', client_id: existingClient.id });
    }

    const program = matchProgram(text);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program.program,
      }).eq('id', existingLead.id);

      const market = existingLead.market || detectMarket(phone);
      const hinglish = isHinglish(market);

      await sendWhatsApp({
        phone,
        templateName: 'program_checkout',
        bodyValues: [
          senderName || existingLead.name || 'there',
          program.name,
          `$${program.price}`,
          `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`,
        ],
      });

      await sendWhatsApp({
        phone,
        templateName: 'intake_form_link',
        bodyValues: [
          `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`,
        ],
      });

      return res.json({ action: 'qualified', program: program.program });
    }

    return res.json({ action: 'unmatched_reply' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

async function scheduleNudge(db, phone, leadId) {
  // Nudges are handled by the cron job, but we record intent here
  // The cron checks last_msg_at timestamps to determine nudge timing
}
