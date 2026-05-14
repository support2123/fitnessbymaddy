const { getSupabase } = require('./_lib/supabase');
const { detectMarket, normalizePhone, sendTemplate, needsEscalation, notifyMaddy, maskPhone } = require('./_lib/whatsapp');
const { qualifyLead, isOptOut, PROGRAM_NAMES } = require('./_lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.senderPhone || payload.waId || payload.from || '');
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received'
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy('Escalation needed', `${maskPhone(phone)} said: "${text.slice(0, 100)}"`);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status, program_interest')
      .eq('phone', phone)
      .maybeSingle();

    if (existingLead) {
      await db.from('leads').update({
        last_msg_at: new Date().toISOString(),
        first_msg: existingLead.first_msg || text
      }).eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      if (!existingLead.program_interest) {
        const program = qualifyLead(text);
        if (program) {
          await db.from('leads').update({
            status: 'qualified',
            program_interest: program
          }).eq('id', existingLead.id);

          const market = detectMarket(phone);
          const programName = PROGRAM_NAMES[program] || program;

          if (market === 'IN') {
            await sendTemplate(phone, 'program_info_hinglish', {
              name: senderName || 'there',
              templateParams: [
                senderName || 'there',
                programName,
                `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`,
                `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
              ]
            });
          } else {
            await sendTemplate(phone, 'program_info_en', {
              name: senderName || 'there',
              templateParams: [
                senderName || 'there',
                programName,
                `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`,
                `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
              ]
            });
          }

          return res.status(200).json({ action: 'qualified', program });
        }
      }

      return res.status(200).json({ action: 'existing_lead' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market
    }).select('id').single();

    if (market === 'IN') {
      await sendTemplate(phone, 'welcome_v1_hinglish', {
        name: senderName || 'there',
        templateParams: [senderName || 'there']
      });
    } else {
      await sendTemplate(phone, 'welcome_v1_en', {
        name: senderName || 'there',
        templateParams: [senderName || 'there']
      });
    }

    return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
