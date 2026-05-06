const { getSupabase } = require('./lib/supabase');
const { maskPhone, detectMarket, detectProgram, sendTemplate, needsEscalation, isOptOut, notifyMaddy } = require('./lib/whatsapp');
const { canSendMessage, logMessage } = require('./lib/ratelimit');

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload?.phone || payload?.waId || payload?.from;
    const text = payload?.text || payload?.body || payload?.message?.text || '';
    const name = payload?.name || payload?.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();

    await logMessage(phone, 'in', text);

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy(
        'Escalation Required',
        `Lead ${maskPhone(phone)} said: "${text.substring(0, 100)}"`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: lead } = await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      const canSend = await canSendMessage(phone);
      if (canSend) {
        await sendTemplate(phone, 'welcome_v1', {
          name: name || 'there',
          templateParams: [name || 'there'],
        });
        await logMessage(phone, 'out', 'Welcome template sent', 'welcome_v1');
      }

      return res.status(200).json({ action: 'new_lead', id: lead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: name || existingLead.name,
    }).eq('id', existingLead.id);

    const program = detectProgram(text);
    if (program && existingLead.status === 'new') {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('id', existingLead.id);

      const canSend = await canSendMessage(phone);
      if (canSend) {
        const checkoutUrl = CHECKOUT_URLS[program] || CHECKOUT_URLS['zoom_trial'];
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        await sendTemplate(phone, 'program_checkout', {
          name: name || existingLead.name || 'there',
          templateParams: [
            name || existingLead.name || 'there',
            program,
            checkoutUrl,
            intakeUrl,
          ],
        });
        await logMessage(phone, 'out', `Checkout link sent for ${program}`, 'program_checkout');
      }

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
