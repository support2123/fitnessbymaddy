const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, logMessage, checkRateLimit } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');
const { checkEscalation, checkOptOut, createEscalation, routeProgram } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.from || payload.senderPhone || payload.phone || '');
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);

    await logMessage(phone, 'in', text, null);

    if (checkOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    const escalation = checkEscalation(text);
    if (escalation.shouldEscalate) {
      await createEscalation(phone, escalation.reason, text);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status, program')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status, created_at')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.json({ action: 'dropped_lead' });
      }

      await db.from('leads').update({
        last_msg_at: new Date().toISOString(),
        first_msg: existingLead.first_msg || text
      }).eq('id', existingLead.id);

      const routed = routeProgram(text);
      if (routed) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: routed.program
        }).eq('id', existingLead.id);

        const rateLimited = await checkRateLimit(phone);
        if (!rateLimited) {
          await sendTemplate(phone, 'program_match', [
            routed.name,
            String(routed.price),
            `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`,
            `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`
          ], market);
        }

        return res.json({ action: 'qualified', program: routed.program });
      }

      return res.json({ action: 'existing_lead', lead_id: existingLead.id });
    }

    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: senderName || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market
    }).select('id').single();

    await sendTemplate(phone, 'welcome_v1', [senderName || 'there'], market);

    const routed = routeProgram(text);
    if (routed && newLead) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: routed.program
      }).eq('id', newLead.id);

      await sendTemplate(phone, 'program_match', [
        routed.name,
        String(routed.price),
        `https://fitnessbymaddyy.exlyapp.com/checkout/${newLead.id}`,
        `https://fitnessbymaddy.com/intake?lead=${newLead.id}`
      ], market);
    }

    return res.json({ action: 'new_lead', lead_id: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  return phone.replace(/[^0-9]/g, '');
}
