const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage, canSendMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, createEscalation, isOptOut } = require('../lib/escalation');
const { matchProgram, getCheckoutUrl } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.mobile;
    const messageBody = payload.message || payload.text || payload.body || '';
    const senderName = payload.senderName || payload.name || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const db = getSupabase();

    await logMessage(phone, 'in', messageBody, null);

    if (isOptOut(messageBody)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(messageBody);
    if (escalationKeyword) {
      await createEscalation(phone, escalationKeyword, messageBody);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status, program')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status, created_at')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existingLead) {
      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      const programMatch = matchProgram(messageBody);
      if (programMatch) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: programMatch.program,
        }).eq('id', existingLead.id);

        const market = detectMarket(phone);
        const checkoutUrl = getCheckoutUrl(programMatch.program);
        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        if (isHinglish(market)) {
          await sendText(phone,
            `Great choice! ${programMatch.name} aapke liye perfect hai.\n\n` +
            `Checkout karo: ${checkoutUrl}\n\n` +
            `Aur ye form bhi fill karo taaki Maddy aapka plan bana sake:\n${intakeUrl}`
          );
        } else {
          await sendText(phone,
            `Great choice! ${programMatch.name} is perfect for you.\n\n` +
            `Checkout here: ${checkoutUrl}\n\n` +
            `Also fill out this quick form so Maddy can build your plan:\n${intakeUrl}`
          );
        }

        return res.status(200).json({ action: 'qualified', program: programMatch.program });
      }

      return res.status(200).json({ action: 'existing_lead' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: messageBody?.substring(0, 500),
      market,
    }).select('id').single();

    if (await canSendMessage(phone)) {
      if (isHinglish(market)) {
        await sendTemplate(phone, 'welcome_v1_hi', [senderName || 'there']);
      } else {
        await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
      }
    }

    return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
