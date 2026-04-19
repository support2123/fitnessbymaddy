const { supabase } = require('./_lib/supabase');
const { sendTemplate, checkRateLimit, detectMarket, isHinglish, needsEscalation, notifyMaddy, maskPhone } = require('./_lib/whatsapp');
const { cors, parseBody, classifyIntent, programLabel } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const phone = body.mobile || body.phone || body.from || '';
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text, status: 'received',
    });

    if (/\b(stop|unsubscribe|opt.?out)\b/i.test(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy('Lead Escalation', `${maskPhone(phone)} said: "${text.slice(0, 100)}"`);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const market = detectMarket(phone);

    if (!existingLead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone, name, source: 'whatsapp', status: 'new',
        first_msg: text, last_msg_at: new Date().toISOString(), market,
      }).select().single();

      await sendTemplate(phone, 'welcome_v1', {
        name: name || 'there',
        templateParams: [name || 'there'],
      });

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    const intent = classifyIntent(text);
    if (intent && existingLead.status === 'new') {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: intent,
      }).eq('id', existingLead.id);

      const rateLimited = await checkRateLimit(phone);
      if (!rateLimited) {
        const hinglish = isHinglish(market);
        const label = programLabel(intent);

        await sendTemplate(phone, 'program_offer', {
          name: existingLead.name || 'there',
          templateParams: [
            existingLead.name || 'there',
            label,
            `https://fitnessbymaddyy.exlyapp.com/checkout/${intent}`,
            `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`,
          ],
        });
      }

      return res.status(200).json({ action: 'qualified', program: intent });
    }

    return res.status(200).json({ action: 'existing_lead', lead_id: existingLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
