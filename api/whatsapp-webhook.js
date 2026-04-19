const { supabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const {
  detectMarket, isHinglish, needsEscalation,
  classifyIntent, PROGRAM_META, jsonResponse, sanitizeInput,
} = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = sanitizeInput(body.mobile || body.from || body.sender);
    const text = sanitizeInput(body.text || body.message || body.body || '');
    const name = sanitizeInput(body.name || body.pushName || '');

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text,
    });

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text.trim())) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy('Escalation needed', `${phone} said: "${text.slice(0, 200)}"`);
    }

    const { data: existingClient } = await supabase
      .from('clients').select('id,status').eq('phone', phone).eq('status', 'active').maybeSingle();

    if (existingClient) {
      return res.json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads').select('*').eq('phone', phone).maybeSingle();

    const market = detectMarket(phone);

    if (!existingLead) {
      const { data: lead } = await supabase.from('leads').insert({
        phone, name, source: 'whatsapp', status: 'new',
        first_msg: text, market,
      }).select().single();

      const greeting = isHinglish(market)
        ? `Hi${name ? ' ' + name : ''}! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?`
        : `Hi${name ? ' ' + name : ''}! Welcome to FitnessByMaddy 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?`;

      await sendWhatsApp(phone, 'welcome_v1', [name || 'there']);
      return res.json({ action: 'new_lead', lead_id: lead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'dropped_lead' });
    }

    const intent = classifyIntent(text);
    if (intent && PROGRAM_META[intent]) {
      await supabase.from('leads').update({
        status: 'qualified', program_interest: intent, last_msg_at: new Date().toISOString(),
      }).eq('id', existingLead.id);

      const meta = PROGRAM_META[intent];
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const msgParams = isHinglish(market)
        ? [meta.name, `$${meta.price}`, checkoutUrl, intakeUrl]
        : [meta.name, `$${meta.price}`, checkoutUrl, intakeUrl];

      await sendWhatsApp(phone, 'program_offer', msgParams);
      return res.json({ action: 'qualified', program: intent });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
