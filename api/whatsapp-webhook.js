const { getSupabase } = require('./lib/supabase');
const { sendTemplate, maskPhone, detectMarket, normalizePhone } = require('./lib/whatsapp');
const { needsEscalation, isOptOut, notifyMaddy } = require('./lib/escalation');
const { canSendToLead, logMessage } = require('./lib/rate-limit');
const { matchProgram } = require('./lib/keywords');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(
      payload.mobile || payload.senderMobile || payload.from || ''
    );
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.name || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const supabase = getSupabase();
    const market = detectMarket(phone);

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy(
        'Incoming message flagged',
        `From ${maskPhone(phone)}: "${text.slice(0, 200)}"`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status, program_interest')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select('id')
        .single();

      const welcomeParams = market === 'IN'
        ? [senderName || 'there']
        : [senderName || 'there'];

      if (await canSendToLead(phone)) {
        await sendTemplate(phone, 'welcome_v1', welcomeParams);
        await logMessage(phone, 'out', 'Welcome message sent', 'welcome_v1');
      }

      return res.status(200).json({ action: 'new_lead', leadId: newLead?.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    const programMatch = matchProgram(text);
    if (programMatch && existingLead.status === 'new') {
      await supabase
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: programMatch.program,
        })
        .eq('id', existingLead.id);

      if (await canSendToLead(phone)) {
        await sendTemplate(phone, 'program_recommendation', [
          senderName || 'there',
          programMatch.label,
          String(programMatch.price),
        ]);
        await logMessage(phone, 'out', `Recommended: ${programMatch.label}`, 'program_recommendation');
      }

      return res.status(200).json({
        action: 'qualified',
        program: programMatch.program,
      });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
