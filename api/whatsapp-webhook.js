const { getSupabase } = require('../lib/supabase');
const { logMessage, sendTemplate, sendToMaddy, checkRateLimit } = require('../lib/whatsapp');
const {
  detectMarket, isHinglish, needsEscalation, isOptOut,
  classifyIntent, PROGRAM_NAMES, maskPhone, jsonResponse, errorResponse
} = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload?.phone || payload?.waId || payload?.from;
    const text = payload?.text || payload?.body || payload?.message || '';
    const name = payload?.name || payload?.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const db = getSupabase();

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`[WA] Opt-out from ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await sendToMaddy(
        `Lead ${maskPhone(phone)} said: "${text.slice(0, 200)}". Needs human review.`
      );
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      if (isHinglish(market)) {
        await sendTemplate(phone, 'welcome_v1', [name || 'there']);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
      }

      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: name || existingLead.name
    }).eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const intent = classifyIntent(text);
    if (intent && existingLead.status === 'new') {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: intent
      }).eq('id', existingLead.id);

      const programName = PROGRAM_NAMES[intent];
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${intent}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const rateLimited = await checkRateLimit(phone);
      if (!rateLimited) {
        await sendTemplate(phone, 'program_match', [
          name || 'there',
          programName,
          checkoutUrl,
          intakeUrl
        ]);
      }

      return res.status(200).json({ action: 'qualified', program: intent });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('[WA Webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
