const { getSupabase } = require('./lib/supabase');
const { sendAndLog, logMessage } = require('./lib/whatsapp');
const {
  detectMarket, isHinglish, needsEscalation, detectProgram,
  isOptOut, maskPhone, PROGRAM_NAMES, jsonResponse, corsResponse,
} = require('./lib/utils');

const MADDY_PHONE = '917082478374';
const SITE = 'https://www.fitnessbymaddy.com';

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
    const messageText = body.message || body.text || body.body || '';
    const senderName = body.name || body.senderName || '';

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const db = getSupabase();

    await logMessage(phone, 'in', messageText, null);

    if (isOptOut(messageText)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageText)) {
      await sendAndLog(
        MADDY_PHONE,
        'escalation_alert',
        [maskPhone(phone), messageText.slice(0, 200)],
        true
      );
      return res.status(200).json({ action: 'escalated' });
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
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead || existingLead.status === 'dropped') {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: senderName || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageText,
        last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      const welcomeTemplate = hinglish ? 'welcome_v1_hi' : 'welcome_v1';
      await sendAndLog(phone, welcomeTemplate, [senderName || 'there']);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    const program = detectProgram(messageText);

    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('id', existingLead.id);

      const programName = PROGRAM_NAMES[program] || program;
      const checkoutLink = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeLink = `${SITE}/intake?lead=${existingLead.id}`;

      const qualifyTemplate = hinglish ? 'program_match_hi' : 'program_match';
      await sendAndLog(phone, qualifyTemplate, [
        senderName || 'there',
        programName,
        checkoutLink,
        intakeLink,
      ]);

      return res.status(200).json({
        action: 'qualified',
        lead_id: existingLead.id,
        program,
      });
    }

    return res.status(200).json({ action: 'message_logged', lead_id: existingLead.id });

  } catch (err) {
    console.error('WhatsApp webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
