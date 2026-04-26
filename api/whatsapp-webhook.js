const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { logMessage, canSendMessage } = require('./_lib/rate-limit');
const {
  detectMarket, isHinglish, needsEscalation, classifyLead,
  isOptOut, json, maskPhone, PROGRAM_NAMES, CHECKOUT_URLS,
} = require('./_lib/helpers');

const MADDY_PHONE = '917082478374';
const SITE = 'https://fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.senderPhone || payload.from;
    const text = payload.message || payload.text || payload.body || '';
    const senderName = payload.senderName || payload.name || null;

    if (!phone) return json(res, 400, { error: 'Missing phone' });

    await logMessage(phone, 'in', text);

    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return json(res, 200, { action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
        maskPhone(phone), text.slice(0, 200),
      ]);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existingLead) {
      await supabase.from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return json(res, 200, { action: 'ignored_dropped' });
      }

      if (existingLead.status === 'new') {
        return await qualifyLead(res, existingLead, text, phone);
      }

      return json(res, 200, { action: 'existing_lead', status: existingLead.status });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await supabase.from('leads').insert({
      phone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
    }).select().single();

    const hinglish = isHinglish(market);
    const welcomeMsg = hinglish
      ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
      : 'Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

    if (await canSendMessage(phone)) {
      await sendWhatsApp(phone, 'welcome_v1', [senderName || 'there']);
      await logMessage(phone, 'out', welcomeMsg, 'welcome_v1');
    }

    const program = classifyLead(text);
    if (program) {
      await supabase.from('leads')
        .update({ program_interest: program, status: 'qualified' })
        .eq('id', newLead.id);

      if (await canSendMessage(phone)) {
        const programName = PROGRAM_NAMES[program];
        const checkoutUrl = CHECKOUT_URLS[program];
        const intakeUrl = `${SITE}/intake.html?lead=${newLead.id}`;
        const msg = hinglish
          ? `Great choice! ${programName} aapke liye perfect hai. Yahan se start karo:`
          : `Great choice! ${programName} is perfect for you. Get started here:`;

        await sendWhatsApp(phone, 'program_offer', [programName, checkoutUrl, intakeUrl]);
        await logMessage(phone, 'out', msg, 'program_offer');
      }
    }

    return json(res, 200, { action: 'new_lead', lead_id: newLead.id });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    return json(res, 500, { error: 'Internal error' });
  }
};

async function qualifyLead(res, lead, text, phone) {
  const program = classifyLead(text);
  if (!program) {
    return json(res, 200, { action: 'unclassified_reply' });
  }

  await supabase.from('leads')
    .update({ program_interest: program, status: 'qualified' })
    .eq('id', lead.id);

  const hinglish = isHinglish(lead.market);
  const programName = PROGRAM_NAMES[program];
  const checkoutUrl = CHECKOUT_URLS[program];
  const intakeUrl = `${SITE}/intake.html?lead=${lead.id}`;

  if (await canSendMessage(phone)) {
    await sendWhatsApp(phone, 'program_offer', [programName, checkoutUrl, intakeUrl]);
    const msg = hinglish
      ? `${programName} — checkout: ${checkoutUrl}`
      : `${programName} — checkout: ${checkoutUrl}`;
    await logMessage(phone, 'out', msg, 'program_offer');
  }

  return json(res, 200, { action: 'qualified', program });
}
