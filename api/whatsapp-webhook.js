const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');
const {
  detectMarket, detectProgram, needsEscalation, isOptOut,
  programLabel, maskPhone, jsonResponse
} = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.senderMobile;
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.senderName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    if (isOptOut(text)) {
      await db.from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy(
        'Message needs review',
        `Phone: ${maskPhone(phone)}\nMessage: ${text}`
      );
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
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const isHindi = market === 'IN';
      await sendWhatsApp(phone, 'welcome_v1', [
        name || (isHindi ? 'there' : 'there')
      ]);

      scheduleNudges(db, phone, newLead?.id);

      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = detectProgram(text);
      if (program) {
        await db.from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const label = programLabel(program);
        const market = existingLead.market || 'GLOBAL';
        const isHindi = market === 'IN';

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        await sendWhatsApp(phone, 'program_match', [
          name || existingLead.name || 'there',
          label,
          checkoutUrl,
          intakeUrl
        ]);

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'noted' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function scheduleNudges(db, phone, leadId) {
  setTimeout(async () => {
    try {
      const { data: lead } = await db
        .from('leads')
        .select('status')
        .eq('id', leadId)
        .single();

      if (lead && lead.status === 'new') {
        await sendWhatsApp(phone, 'nudge_trial', []);
      }
    } catch (e) {
      console.error('Nudge 2hr error:', e.message);
    }
  }, 2 * 60 * 60 * 1000);

  setTimeout(async () => {
    try {
      const { data: lead } = await db
        .from('leads')
        .select('status')
        .eq('id', leadId)
        .single();

      if (lead && lead.status === 'new') {
        await db.from('leads')
          .update({ status: 'dropped' })
          .eq('id', leadId);
      }
    } catch (e) {
      console.error('Drop 24hr error:', e.message);
    }
  }, 24 * 60 * 60 * 1000);
}
