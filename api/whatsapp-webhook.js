const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage } = require('../lib/whatsapp');
const {
  detectMarket, detectProgram, shouldEscalate, isOptOut,
  getGreeting, getProgramResponse, maskPhone,
} = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.senderPhone;
    const message = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();
    const market = detectMarket(phone);

    await logMessage(phone, 'in', message, null);

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`[OPT-OUT] ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = shouldEscalate(message);
    if (escalationKeyword) {
      await escalateToMaddy(phone, escalationKeyword, message);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status, program')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .limit(1)
      .maybeSingle();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      await db.from('leads').update({
        last_msg_at: new Date().toISOString(),
        first_msg: message,
      }).eq('id', existingLead.id);

      const program = detectProgram(message);
      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program,
        }).eq('id', existingLead.id);

        const programMsg = getProgramResponse(program, market);
        if (programMsg) {
          await sendText(phone, programMsg);
          await sendText(phone, `Checkout here: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`);
          await sendText(phone, `Also fill your intake form: https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`);
        }
        return res.status(200).json({ action: 'qualified', program });
      }

      return res.status(200).json({ action: 'existing_lead' });
    }

    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
    }).select('id').single();

    const greeting = getGreeting(market);
    await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);

    const program = detectProgram(message);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('id', newLead.id);

      const programMsg = getProgramResponse(program, market);
      if (programMsg) {
        await sendText(phone, programMsg);
        await sendText(phone, `Checkout here: https://fitnessbymaddyy.exlyapp.com/checkout/${newLead.id}`);
      }
    }

    return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
  } catch (err) {
    console.error('[WEBHOOK ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
