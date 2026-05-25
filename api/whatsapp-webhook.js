const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText } = require('./_lib/whatsapp');
const { escalate } = require('./_lib/escalation');
const {
  normalizePhone, detectMarket, isHinglishMarket,
  needsEscalation, isOptOut, detectProgram,
  programDisplayName, maskPhone
} = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = normalizePhone(body.mobile || body.phone || body.from || '');
    const text = (body.message || body.text || body.body || '').trim();
    const name = body.name || body.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text
    });

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalate(phone, 'keyword_trigger', text);
    }

    const { data: existing } = await supabase
      .from('leads')
      .select('id, status, market')
      .eq('phone', phone)
      .maybeSingle();

    if (existing && existing.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    const { data: activeClient } = await supabase
      .from('clients')
      .select('id, program')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (activeClient) {
      return res.json({ action: 'active_client', client_id: activeClient.id });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglishMarket(market);

    if (!existing) {
      const { data: lead } = await supabase
        .from('leads')
        .insert({
          phone,
          name,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          market
        })
        .select()
        .single();

      if (hinglish) {
        await sendTemplate(phone, 'welcome_v1', [name || 'there'], true);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [name || 'there'], true);
      }

      return res.json({ action: 'new_lead', lead_id: lead.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: name || undefined })
      .eq('id', existing.id);

    const program = detectProgram(text);

    if (program) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', existing.id);

      const displayName = programDisplayName(program);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existing.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existing.id}`;

      if (hinglish) {
        await sendText(phone, [
          `Great choice! 🔥 ${displayName} aapke liye perfect hai.`,
          ``,
          `👉 Payment link: ${checkoutUrl}`,
          `👉 Intake form bhi fill karo: ${intakeUrl}`,
          ``,
          `Koi bhi question ho toh pooch lo!`
        ].join('\n'), true);
      } else {
        await sendText(phone, [
          `Great choice! 🔥 The ${displayName} is perfect for you.`,
          ``,
          `👉 Payment link: ${checkoutUrl}`,
          `👉 Please fill the intake form: ${intakeUrl}`,
          ``,
          `Let us know if you have any questions!`
        ].join('\n'), true);
      }

      return res.json({ action: 'qualified', program });
    }

    return res.json({ action: 'reply_received', lead_id: existing.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
