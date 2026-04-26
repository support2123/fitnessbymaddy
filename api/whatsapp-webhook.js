const { getSupabase } = require('./lib/supabase');
const { sendTemplate, canSendToLead, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, createEscalation } = require('./lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.senderPhone;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text
    });

    // Check opt-out
    const lowerText = text.toLowerCase().trim();
    if (lowerText === 'stop' || lowerText === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    // Check escalation triggers
    const escalationReason = needsEscalation(text);
    if (escalationReason) {
      const { data: client } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();
      await createEscalation(phone, escalationReason, text, client?.id);
    }

    // Look up existing lead
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    // Check if already a client
    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      // Active client — don't run lead flow, just log
      return res.json({ action: 'active_client_message_logged' });
    }

    if (existingLead && existingLead.status === 'dropped') {
      return res.json({ action: 'dropped_lead_ignored' });
    }

    const market = detectMarket(phone);

    if (!existingLead) {
      // FLOW A — New lead
      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market
      });

      const canSend = await canSendToLead(phone);
      if (canSend) {
        if (market === 'IN') {
          await sendTemplate(phone, 'welcome_v1_hindi', [name || 'there']);
        } else {
          await sendTemplate(phone, 'welcome_v1', [name || 'there']);
        }
      }

      return res.json({ action: 'new_lead_welcomed' });
    }

    // FLOW B — Existing lead replied → qualify
    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    const qualification = qualifyLead(text);
    if (qualification) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: qualification.program
      }).eq('id', existingLead.id);

      const checkoutUrl = getCheckoutUrl(qualification.program);
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const canSend = await canSendToLead(phone);
      if (canSend) {
        if (market === 'IN') {
          await sendTemplate(phone, 'program_qualified_hindi', [
            name || 'there',
            qualification.label,
            checkoutUrl,
            intakeUrl
          ]);
        } else {
          await sendTemplate(phone, 'program_qualified', [
            name || 'there',
            qualification.label,
            checkoutUrl,
            intakeUrl
          ]);
        }
      }

      return res.json({ action: 'lead_qualified', program: qualification.program });
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
