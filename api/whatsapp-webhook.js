const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, classifyIntent, maskPhone, PROGRAM_INFO, jsonResponse, corsResponse } = require('./_lib/helpers');
const { escalate } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = body.phone || body.from || body.senderPhone || '';
    const message = body.message || body.text || body.body || '';
    const name = body.name || body.senderName || null;

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received',
    });

    const { intent, program, reason } = classifyIntent(message);

    if (intent === 'optout') {
      await db
        .from('leads')
        .update({ status: 'dropped', opted_out: true })
        .eq('phone', phone);
      console.log(`[OPT-OUT] ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (intent === 'escalation') {
      const { data: client } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .limit(1)
        .single();

      await escalate(phone, reason, message, client?.id);
      return res.status(200).json({ action: 'escalated', reason });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (existingLead && existingLead.opted_out) {
      return res.status(200).json({ action: 'ignored_opted_out' });
    }

    const market = detectMarket(phone);
    const isHinglish = market === 'IN';

    if (!existingLead) {
      const { data: lead } = await db
        .from('leads')
        .insert({
          phone,
          name,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      await sendWhatsApp(phone, 'welcome_v1', [name || 'there']);

      scheduleNudge(db, phone, lead?.id);

      return res.status(200).json({ action: 'new_lead', lead_id: lead?.id });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (intent === 'program' && program) {
      const info = PROGRAM_INFO[program];

      await db
        .from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('phone', phone);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${info.checkout}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const params = isHinglish
        ? [info.name, info.price, checkoutUrl, intakeUrl]
        : [info.name, info.price, checkoutUrl, intakeUrl];

      await sendWhatsApp(phone, 'program_offer_v1', params);

      return res.status(200).json({ action: 'qualified', program });
    }

    if (existingLead.status === 'new') {
      await sendWhatsApp(phone, 'clarify_goal_v1', [name || 'there']);
    }

    return res.status(200).json({ action: 'replied' });
  } catch (err) {
    console.error('[WEBHOOK ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function scheduleNudge(db, phone, leadId) {
  setTimeout(async () => {
    try {
      const { data: lead } = await db
        .from('leads')
        .select('status, last_msg_at')
        .eq('phone', phone)
        .single();

      if (lead && lead.status === 'new') {
        const lastMsg = new Date(lead.last_msg_at).getTime();
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;

        if (lastMsg <= twoHoursAgo) {
          await sendWhatsApp(phone, 'nudge_trial', []);
        }
      }
    } catch (e) {
      console.error('[NUDGE ERROR]', maskPhone(phone), e.message);
    }
  }, 2 * 60 * 60 * 1000);
}
