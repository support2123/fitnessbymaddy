const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone, needsEscalation, escalateToMaddy } = require('./lib/whatsapp');
const { detectProgram } = require('./lib/programs');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const message = extractMessage(payload);
    if (!message) return res.status(200).json({ status: 'no_message' });

    const { phone, text, name } = message;

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    const lowerText = text.toLowerCase().trim();

    if (lowerText === 'stop' || lowerText === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy(phone, text, 'Medical/Safety concern detected');
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      if (needsEscalation(text)) {
        await escalateToMaddy(phone, text, 'Active client concern');
      }
      return res.status(200).json({ status: 'active_client_message_logged' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.status(200).json({ status: 'lead_dropped_no_action' });
      }

      const program = detectProgram(text);
      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program.key,
          last_msg_at: new Date().toISOString()
        }).eq('id', existingLead.id);

        const market = detectMarket(phone);
        const isHinglish = market === 'IN';

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program.key}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        await sendWhatsApp(phone, 'program_match', {
          name: name || existingLead.name || 'there',
          templateParams: [
            name || existingLead.name || 'there',
            program.name,
            `$${program.price}`,
            checkoutUrl,
            intakeUrl
          ]
        });

        return res.status(200).json({ status: 'qualified', program: program.key });
      }

      await db.from('leads').update({
        last_msg_at: new Date().toISOString()
      }).eq('id', existingLead.id);

      return res.status(200).json({ status: 'existing_lead_updated' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString()
    }).select().single();

    await sendWhatsApp(phone, 'welcome_v1', {
      name: name || 'there',
      templateParams: [name || 'there']
    });

    const program = detectProgram(text);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program.key
      }).eq('id', newLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program.key}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${newLead.id}`;

      await sendWhatsApp(phone, 'program_match', {
        name: name || 'there',
        templateParams: [
          name || 'there',
          program.name,
          `$${program.price}`,
          checkoutUrl,
          intakeUrl
        ]
      }, true);
    }

    return res.status(200).json({ status: 'new_lead', id: newLead.id });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error_handled' });
  }
};

function extractMessage(payload) {
  try {
    if (payload.message && payload.mobile) {
      return {
        phone: '+' + payload.mobile,
        text: payload.message,
        name: payload.pushName || payload.name || null
      };
    }

    if (payload.entry) {
      const entry = payload.entry[0];
      const changes = entry.changes[0];
      const msg = changes.value.messages && changes.value.messages[0];
      if (!msg) return null;
      const contact = changes.value.contacts && changes.value.contacts[0];
      return {
        phone: '+' + msg.from,
        text: msg.text ? msg.text.body : '',
        name: contact ? contact.profile.name : null
      };
    }

    return null;
  } catch {
    return null;
  }
}
