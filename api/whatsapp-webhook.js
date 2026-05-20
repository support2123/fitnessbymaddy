const { supabase } = require('../lib/supabase');
const { sendTemplate, canSendMessage, detectMarket, maskPhone } = require('../lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const KEYWORD_ROUTES = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lean', 'cut'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'menopause', 'joints', 'joint pain', '40+', 'forty'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'personalised', 'personalized', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test'],
};

function routeProgram(text) {
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(KEYWORD_ROUTES)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout'].includes(lower);
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parsePayload(req.body);
    if (!phone || !message) return res.status(400).json({ error: 'Missing phone or message' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: message,
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy(
        'Incoming message flagged',
        `Phone: ${maskPhone(phone)}\nMessage: ${message}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      await supabase.from('leads').insert({
        phone, name: name || null, source: 'whatsapp',
        status: 'new', first_msg: message,
        last_msg_at: new Date().toISOString(), market,
      });

      const templateName = market === 'IN' ? 'welcome_v1_hi' : 'welcome_v1';
      await sendTemplate(phone, templateName, {
        name: name || 'there',
        templateParams: [name || 'there'],
      });

      return res.json({ action: 'new_lead_greeted', market });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'lead_dropped_ignored' });
    }

    await supabase.from('leads').update({
      last_msg_at: new Date().toISOString(),
    }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = routeProgram(message);
      if (program) {
        await supabase.from('leads').update({
          status: 'qualified', program_interest: program,
        }).eq('id', existingLead.id);

        const rateOk = await canSendMessage(phone);
        if (rateOk) {
          await sendTemplate(phone, `checkout_${program}`, {
            name: existingLead.name || name || 'there',
            templateParams: [existingLead.name || name || 'there'],
          });
        }

        return res.json({ action: 'qualified', program });
      }
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parsePayload(body) {
  if (body.phone) return body;

  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (msg) {
      return {
        phone: '+' + msg.from,
        message: msg.text?.body || '',
        name: change.contacts?.[0]?.profile?.name || null,
      };
    }
  }

  if (body.data) {
    return {
      phone: body.data.phone || body.data.from,
      message: body.data.message || body.data.text || '',
      name: body.data.name || null,
    };
  }

  return {};
}
