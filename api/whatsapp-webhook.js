const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logInboundMessage, detectMarket } = require('../lib/whatsapp');
const { qualifyLead, isOptOut } = require('../lib/qualify');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.from || payload.sender);
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone number' });

    await logInboundMessage(phone, message);

    if (isOptOut(message)) {
      await handleOptOut(phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy({ reason: 'Keyword trigger in message', phone, message, clientName: name });
    }

    const db = getSupabase();

    const { data: existingClient } = await db
      .from('clients')
      .select('id, name, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.json({ action: 'existing_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status, name')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.json({ action: 'lead_dropped_no_action' });
      }

      await db.from('leads').update({
        last_msg_at: new Date().toISOString(),
        name: name || existingLead.name
      }).eq('id', existingLead.id);

      const match = qualifyLead(message);
      if (match) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: match.program
        }).eq('id', existingLead.id);

        const market = detectMarket(phone);
        const isHinglish = market === 'IN';

        const qualMsg = isHinglish
          ? `Perfect! "${match.label}" aapke liye best rahega 💪\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${match.checkoutSlug}\nPrice: $${match.price}\n\nIntake form bhi fill kar do taaki Maddy aapka plan bana sake:\nhttps://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`
          : `Perfect! "${match.label}" is the best fit for you 💪\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${match.checkoutSlug}\nPrice: $${match.price}\n\nAlso fill out the intake form so Maddy can build your plan:\nhttps://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        await sendWhatsApp({ phone, body: qualMsg });
        return res.json({ action: 'qualified', program: match.program });
      }

      return res.json({ action: 'existing_lead_updated' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market
    }).select('id').single();

    const isHinglish = market === 'IN';
    const welcomeMsg = isHinglish
      ? `Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?`
      : `Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?`;

    await sendWhatsApp({ phone, body: welcomeMsg, templateName: 'welcome_v1' });

    const match = qualifyLead(message);
    if (match) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: match.program
      }).eq('id', newLead.id);

      const qualMsg = isHinglish
        ? `Based on your message, "${match.label}" sounds perfect for you!\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${match.checkoutSlug}\nPrice: $${match.price}\n\nIntake form: https://www.fitnessbymaddy.com/intake?lead=${newLead.id}`
        : `Based on your message, "${match.label}" sounds perfect for you!\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${match.checkoutSlug}\nPrice: $${match.price}\n\nIntake form: https://www.fitnessbymaddy.com/intake?lead=${newLead.id}`;

      await sendWhatsApp({ phone, body: qualMsg });
    }

    return res.json({ action: 'new_lead', lead_id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

async function handleOptOut(phone) {
  const db = getSupabase();
  await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
  await db.from('clients').update({ status: 'paused' }).eq('phone', phone).eq('status', 'active');
}
