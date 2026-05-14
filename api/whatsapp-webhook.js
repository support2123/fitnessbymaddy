const { getClient } = require('../lib/supabase');
const { sendTemplate, canSendToLead, logMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateMessage } = require('../lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'shred', 'weight', 'lean', 'burn', 'cut'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior'],
  '12wk': ['custom', '12 week', 'serious', 'flagship', 'full program', 'personalised'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test'],
};

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'cancel', 'remove me'];

function classifyIntent(text) {
  const lower = text.toLowerCase();

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return program;
    }
  }
  return null;
}

function isOptOut(text) {
  const lower = text.toLowerCase().trim();
  return STOP_WORDS.some(w => lower.includes(w));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getClient();

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateMessage(phone, text, 'Sensitive keyword detected in WhatsApp message');
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .limit(1)
      .single();

    const market = detectMarket(phone);

    if (!existingLead) {
      const { data: newLead } = await db
        .from('leads')
        .insert({
          phone,
          name,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select('id')
        .single();

      await sendTemplate(phone, 'welcome_v1', [name || 'there']);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const intent = classifyIntent(text);
    if (intent) {
      await db
        .from('leads')
        .update({ status: 'qualified', program_interest: intent })
        .eq('id', existingLead.id);

      const canSend = await canSendToLead(phone);
      if (canSend) {
        const programTemplates = {
          '6wk_gym': 'program_6wk',
          'pcos': 'program_pcos',
          '40plus': 'program_40plus',
          '12wk': 'program_12wk',
          'zoom_trial': 'program_trial',
        };

        await sendTemplate(phone, programTemplates[intent] || 'program_info', [
          name || 'there',
        ]);
      }

      return res.status(200).json({ action: 'qualified', program: intent, lead_id: existingLead.id });
    }

    return res.status(200).json({ action: 'message_logged', lead_id: existingLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
