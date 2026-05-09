const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, detectProgram, needsEscalation, isOptOut, maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.senderMobile || '';
    const message = body.text || body.message || body.body || '';
    const name = body.name || body.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await notifyMaddy(phone, message, 'escalation_keyword');
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      if (market === 'IN') {
        await sendWhatsApp(phone, 'welcome_v1_hi', [name || 'there']);
      } else {
        await sendWhatsApp(phone, 'welcome_v1_en', [name || 'there']);
      }

      scheduleNudge(phone, newLead?.id);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: name || existingLead.name,
    }).eq('id', existingLead.id);

    const program = detectProgram(message);
    if (program && existingLead.status === 'new') {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      if (market === 'IN') {
        await sendWhatsApp(phone, 'program_match_hi', [
          name || 'there',
          program,
          checkoutUrl,
          intakeUrl,
        ]);
      } else {
        await sendWhatsApp(phone, 'program_match_en', [
          name || 'there',
          program,
          checkoutUrl,
          intakeUrl,
        ]);
      }

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function notifyMaddy(phone, message, reason) {
  const maddyPhone = '+917082478374';
  await sendWhatsApp(maddyPhone, 'escalation_alert', [
    maskPhone(phone),
    reason,
    (message || '').slice(0, 200),
  ]);
}

function scheduleNudge(phone, leadId) {
  // Nudge is handled by the cron job /api/cron/nudge-dropped
  // which checks for leads with no reply after 2hrs and 24hrs
}
