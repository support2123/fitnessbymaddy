const { supabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone } = require('./lib/whatsapp');
const { shouldEscalate, createEscalation } = require('./lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'shred', 'burn', 'lean', 'cut'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'menopause', 'joints', 'joint pain', 'age'],
  '12wk': ['custom', '12 week', 'serious', 'transform', 'flagship', 'personalised'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test']
};

const STOP_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

function isStopRequest(message) {
  const lower = (message || '').toLowerCase().trim();
  return STOP_KEYWORDS.some(kw => lower.includes(kw));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.mobile || body.senderMobile || body.from;
    const message = body.message || body.text || body.body || '';
    const senderName = body.senderName || body.name || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (isStopRequest(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationReason = shouldEscalate(message);
    if (escalationReason) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .single();
      await createEscalation({
        leadId: lead?.id,
        phone,
        reason: `Keyword detected: ${escalationReason}`,
        triggerMessage: message
      });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          last_msg_at: new Date().toISOString(),
          market
        })
        .select()
        .single();

      const welcomeTemplate = market === 'IN' ? 'welcome_v1_hindi' : 'welcome_v1';
      await sendWhatsApp(phone, welcomeTemplate, {
        name: senderName || 'there',
        templateParams: [senderName || 'there']
      }, true);

      return res.status(200).json({ action: 'new_lead', id: newLead.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_no_reply' });
    }

    const matchedProgram = matchProgram(message);
    if (matchedProgram && existingLead.status === 'new') {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: matchedProgram })
        .eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const market = existingLead.market || 'IN';
      const template = market === 'IN' ? 'program_offer_hindi' : 'program_offer';

      await sendWhatsApp(phone, template, {
        name: existingLead.name || 'there',
        templateParams: [matchedProgram, checkoutUrl, intakeUrl]
      }, true);

      return res.status(200).json({ action: 'qualified', program: matchedProgram });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
