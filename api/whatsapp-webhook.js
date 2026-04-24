const { getSupabase } = require('../lib/supabase');
const { canSendMessage, sendTemplate, sendText, notifyMaddy } = require('../lib/whatsapp');
const {
  maskPhone, detectMarket, detectProgram, isOptOut,
  needsEscalation, programCheckoutUrl, programDisplayName,
  isHinglish, corsHeaders
} = require('../lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.waId || '';
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.name || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy(
        'Lead needs human review',
        `Phone: ${maskPhone(phone)}\nMessage: ${text}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      if (await canSendMessage(phone, false)) {
        await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
      }

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: senderName || existingLead.name
    }).eq('id', existingLead.id);

    const program = detectProgram(text);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program
      }).eq('id', existingLead.id);

      if (await canSendMessage(phone, false)) {
        const checkoutUrl = programCheckoutUrl(program);
        const displayName = programDisplayName(program);
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const msg = hinglish
          ? `${displayName} — perfect choice! Yahan se checkout karo: ${checkoutUrl}\n\nPehle ye form bhi fill kardo: ${intakeUrl}`
          : `Great choice — ${displayName}! Checkout here: ${checkoutUrl}\n\nPlease also fill out your intake form: ${intakeUrl}`;

        await sendText(phone, msg);
      }

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'reply_received', lead_id: existingLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
