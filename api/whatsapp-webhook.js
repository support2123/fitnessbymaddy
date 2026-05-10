const { getSupabase } = require('./_lib/supabase');
const { canSendMessage, sendTemplate, logIncoming } = require('./_lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('./_lib/market');
const {
  needsEscalation, isOptOut, escalateToMaddy, detectProgram, PROGRAM_NAMES
} = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.senderMobile || payload.from;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.senderName || payload.name || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    await logIncoming(phone, text);

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', phone, text.slice(0, 200));
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status, program_interest')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (existingLead) {
      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      const program = detectProgram(text);
      if (program && existingLead.status === 'new') {
        const market = detectMarket(phone);
        const hinglish = isHinglishMarket(market);

        await db.from('leads').update({
          status: 'qualified',
          program_interest: program
        }).eq('id', existingLead.id);

        const programName = PROGRAM_NAMES[program] || program;
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        if (await canSendMessage(phone, false)) {
          const msg = hinglish
            ? `${programName} — perfect choice! Yeh raha checkout link: ${checkoutUrl}\n\nSaath mein yeh form bhi fill kar do: ${intakeUrl}`
            : `Great choice — ${programName}! Here's your checkout link: ${checkoutUrl}\n\nPlease also fill out this quick form: ${intakeUrl}`;

          await sendTemplate(phone, 'program_offer', [programName, checkoutUrl, intakeUrl]);
        }

        return res.status(200).json({ action: 'qualified', program });
      }

      return res.status(200).json({ action: 'existing_lead' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: text.slice(0, 500),
      market
    }).select('id').single();

    if (await canSendMessage(phone, false)) {
      const hinglish = isHinglishMarket(market);
      if (hinglish) {
        await sendTemplate(phone, 'welcome_v1', [
          name || 'there',
          'fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        ]);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [
          name || 'there',
          'fat loss, PCOS, strength, or 40+ fitness? Or would you like to try a trial first?'
        ]);
      }
    }

    return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
