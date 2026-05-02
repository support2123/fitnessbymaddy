const { supabase } = require('./_lib/supabase');
const { sendWhatsAppWithRateLimit } = require('./_lib/whatsapp');
const {
  maskPhone, detectMarket, needsEscalation, isOptOut,
  qualifyLead, programDisplayName, cors, parseBody,
} = require('./_lib/helpers');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const phone = body.senderPhone || body.from || body.waId || '';
    const name = body.senderName || body.pushName || body.name || '';
    const message = body.message || body.text || body.body || '';
    const cleanPhone = phone.replace(/[^0-9]/g, '');

    if (!cleanPhone) return res.status(400).json({ error: 'no phone' });

    await supabase.from('messages').insert({
      phone: cleanPhone,
      direction: 'in',
      body: message,
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', cleanPhone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await sendWhatsAppWithRateLimit(
        MADDY_PHONE,
        'escalation_alert',
        [maskPhone(cleanPhone), message.slice(0, 200)],
        'Maddy',
        true
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .single();

    if (!existingLead) {
      const market = detectMarket(cleanPhone);
      await supabase.from('leads').insert({
        phone: cleanPhone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        market,
      });

      await sendWhatsAppWithRateLimit(
        cleanPhone,
        'welcome_v1',
        [name || 'there'],
        name || 'there',
        false
      );

      return res.status(200).json({ action: 'new_lead', market });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: name || existingLead.name })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = qualifyLead(message);
      if (program) {
        await supabase.from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const displayName = programDisplayName(program);
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        await sendWhatsAppWithRateLimit(
          cleanPhone,
          'program_recommendation',
          [name || 'there', displayName, checkoutUrl, intakeUrl],
          name || 'there',
          false
        );

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', cleanPhone)
      .eq('status', 'active')
      .single();

    if (existingClient && needsEscalation(message)) {
      await sendWhatsAppWithRateLimit(
        MADDY_PHONE,
        'client_escalation',
        [maskPhone(cleanPhone), message.slice(0, 200)],
        'Maddy',
        true
      );
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
