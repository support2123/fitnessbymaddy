const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { detectMarket, detectProgram, needsEscalation, isOptOut, corsHeaders, PROGRAM_NAMES } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const body = req.body;
    const phone = body.mobile || body.phone || body.from;
    const message = body.text || body.message || body.body || '';
    const senderName = body.name || body.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    console.log(`Incoming WA from ${maskPhone(phone)}: ${message.slice(0, 80)}`);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Incoming message flagged', {
        phone,
        message,
        summary: `Lead/client sent: "${message.slice(0, 100)}"`,
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const programGuess = detectProgram(message);

      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        market,
        program_interest: programGuess,
      }).select().single();

      const welcomeParams = market === 'IN'
        ? [senderName || 'there']
        : [senderName || 'there'];

      await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({ action: 'new_lead', id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = detectProgram(message);
      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program,
        }).eq('id', existingLead.id);

        const programName = PROGRAM_NAMES[program] || program;
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        await sendWhatsApp(phone, 'program_match', [
          senderName || existingLead.name || 'there',
          programName,
          checkoutUrl,
          intakeUrl,
        ]);

        return res.status(200).json({ action: 'qualified', program });
      }

      await sendWhatsApp(phone, 'clarify_goal', [
        senderName || existingLead.name || 'there',
      ]);

      return res.status(200).json({ action: 'asked_clarification' });
    }

    const { data: activeClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (activeClient) {
      return res.status(200).json({ action: 'active_client_msg_logged' });
    }

    return res.status(200).json({ action: 'existing_lead_msg_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
