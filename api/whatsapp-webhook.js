const { getSupabase } = require('../lib/supabase');
const { sendTemplate, logMessage, checkRateLimit, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { qualifyLead, isOptOut } = require('../lib/qualify');
const { needsEscalation, detectEscalationReason, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.waId;
    const messageBody = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await logMessage(phone, 'in', messageBody, null);

    if (isOptOut(messageBody)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageBody)) {
      const reason = detectEscalationReason(messageBody);
      await escalateToMaddy(phone, reason, messageBody);
      return res.status(200).json({ action: 'escalated', reason });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .single();

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    if (existingLead && existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: lead } = await db
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: messageBody.substring(0, 500),
          market,
        })
        .select()
        .single();

      const rateLimited = await checkRateLimit(phone);
      if (!rateLimited) {
        if (isHinglish(market)) {
          await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
        } else {
          await sendTemplate(phone, 'welcome_v1_en', [senderName || 'there']);
        }
      }

      return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
    }

    const qualification = qualifyLead(messageBody);
    if (qualification) {
      await db
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: qualification.program,
          last_msg_at: new Date().toISOString(),
        })
        .eq('id', existingLead.id);

      const market = detectMarket(phone);
      const rateLimited = await checkRateLimit(phone);
      if (!rateLimited) {
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/${qualification.checkoutPath}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        if (isHinglish(market)) {
          await sendTemplate(phone, 'program_match', [
            qualification.name,
            `$${qualification.price}`,
            checkoutUrl,
            intakeUrl,
          ]);
        } else {
          await sendTemplate(phone, 'program_match_en', [
            qualification.name,
            `$${qualification.price}`,
            checkoutUrl,
            intakeUrl,
          ]);
        }
      }

      return res.status(200).json({
        action: 'qualified',
        program: qualification.program,
      });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
