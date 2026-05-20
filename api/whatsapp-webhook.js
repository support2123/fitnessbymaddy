const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { checkEscalation, checkOptOut } = require('./_lib/escalation');
const { detectMarket, isHinglishMarket } = require('./_lib/market');
const { qualifyLead, getCheckoutUrl } = require('./_lib/qualify');
const { maskPhone } = require('./_lib/mask-phone');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (checkOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeywords = checkEscalation(text);
    if (escalationKeywords) {
      await notifyMaddy(db, phone, name, text, escalationKeywords);
      return res.status(200).json({ action: 'escalated', keywords: escalationKeywords });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .in('status', ['active', 'paused'])
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.status(200).json({ action: 'existing_client', client_id: existingClient[0].id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status, first_msg')
      .eq('phone', phone)
      .limit(1);

    const market = detectMarket(phone);
    const hinglish = isHinglishMarket(market);

    if (!existingLead || existingLead.length === 0) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString(),
      }).select('id').single();

      const welcomeTemplate = hinglish ? 'welcome_v1_hi' : 'welcome_v1';
      const welcomeMsg = hinglish
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS support, strength, or 40+ fitness? Or want to try a trial session first?";

      await sendWhatsApp({
        phone,
        templateName: welcomeTemplate,
        body: welcomeMsg,
      });

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

    const qualification = qualifyLead(text);
    if (qualification) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: qualification.program,
      }).eq('id', lead.id);

      const checkoutUrl = getCheckoutUrl(qualification.program);
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

      const qualMsg = hinglish
        ? `Great choice! ${qualification.name} program tere liye perfect hai. 💪\n\nCheckout: ${checkoutUrl}\n\nPehle yeh form bhar do: ${intakeUrl}`
        : `Great choice! The ${qualification.name} program is perfect for you. 💪\n\nCheckout: ${checkoutUrl}\n\nPlease fill this form first: ${intakeUrl}`;

      await sendWhatsApp({
        phone,
        templateName: 'program_recommendation',
        body: qualMsg,
      });

      return res.status(200).json({ action: 'qualified', program: qualification.program });
    }

    return res.status(200).json({ action: 'unclassified' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function notifyMaddy(db, phone, name, text, keywords) {
  const { maskPhone: mask } = require('./_lib/mask-phone');
  const msg = `🚨 ESCALATION\nLead: ${name || 'Unknown'} (${mask(phone)})\nMessage: "${text.slice(0, 200)}"\nTriggers: ${keywords.join(', ')}`;

  await sendWhatsApp({
    phone: '+917082478374',
    templateName: 'escalation_alert',
    body: msg,
  });

  await db.from('messages').insert({
    phone: '+917082478374',
    direction: 'out',
    body: msg,
    template_name: 'escalation_alert',
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}
