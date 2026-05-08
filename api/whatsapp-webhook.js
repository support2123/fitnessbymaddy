const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logIncoming } = require('../lib/whatsapp');
const { detectMarket, isHinglish, needsEscalation, detectProgram, isOptOut } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = body.senderPhone || body.waId || body.from;
    const text = body.text || body.message || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    await logIncoming(phone, text);

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', phone, text);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      const program = detectProgram(text);
      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program,
        }).eq('id', existingLead.id);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        if (hinglish) {
          await sendWhatsApp(phone, 'program_match_hi', [checkoutUrl, intakeUrl]);
        } else {
          await sendWhatsApp(phone, 'program_match_en', [checkoutUrl, intakeUrl]);
        }

        return res.status(200).json({ action: 'qualified', program });
      }

      return res.status(200).json({ action: 'existing_lead' });
    }

    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: body.senderName || body.pushName || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      market,
    }).select('id').single();

    if (hinglish) {
      await sendWhatsApp(phone, 'welcome_v1_hi', []);
    } else {
      await sendWhatsApp(phone, 'welcome_v1_en', []);
    }

    scheduleNudge(phone, newLead.id);

    return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function scheduleNudge(phone, leadId) {
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  setTimeout(async () => {
    try {
      const db = getSupabase();
      const { data } = await db.from('leads').select('status, last_msg_at').eq('id', leadId).single();
      if (data && data.status === 'new') {
        const elapsed = Date.now() - new Date(data.last_msg_at).getTime();
        if (elapsed >= TWO_HOURS) {
          const market = detectMarket(phone);
          const template = isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial_en';
          await sendWhatsApp(phone, template, ['https://fitnessbymaddy.com/intake']);
        }
      }
    } catch (_) {}
  }, TWO_HOURS);

  setTimeout(async () => {
    try {
      const db = getSupabase();
      const { data } = await db.from('leads').select('status').eq('id', leadId).single();
      if (data && data.status === 'new') {
        await db.from('leads').update({ status: 'dropped' }).eq('id', leadId);
      }
    } catch (_) {}
  }, TWENTY_FOUR_HOURS);
}
