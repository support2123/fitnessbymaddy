const { getSupabase } = require('./_lib/supabase');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { checkEscalation, classifyProgram, PROGRAM_LABELS } = require('./_lib/escalation');
const { canSendMessage, sendTemplate, sendText, notifyMaddy, logIncoming } = require('./_lib/whatsapp');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload?.phone || payload?.payload?.phone || payload?.from;
    const text = payload?.text || payload?.payload?.text || payload?.body || '';
    const senderName = payload?.name || payload?.payload?.name || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logIncoming(phone, text);

    const lower = (text || '').toLowerCase().trim();

    if (['stop', 'unsubscribe', 'opt out', 'optout'].includes(lower)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalation = checkEscalation(text);
    if (escalation.shouldEscalate) {
      await notifyMaddy(
        'Lead/Client message needs review',
        `Phone: ${maskPhone(phone)}\nMessage: ${text}\nTriggers: ${escalation.triggers.join(', ')}`
      );
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
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      if (isHinglish(market)) {
        await sendTemplate(phone, 'welcome_v1', [senderName || 'there'], senderName);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [senderName || 'there'], senderName);
      }

      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = classifyProgram(text);
      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program
        }).eq('id', existingLead.id);

        const label = PROGRAM_LABELS[program] || program;
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const market = existingLead.market || detectMarket(phone);
        if (isHinglish(market)) {
          await sendTemplate(phone, 'program_match', [
            senderName || existingLead.name || 'there',
            label,
            checkoutUrl,
            intakeUrl
          ], existingLead.name);
        } else {
          await sendTemplate(phone, 'program_match_en', [
            senderName || existingLead.name || 'there',
            label,
            checkoutUrl,
            intakeUrl
          ], existingLead.name);
        }

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
