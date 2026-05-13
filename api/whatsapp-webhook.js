const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage, notifyMaddy } = require('../lib/whatsapp');
const { checkEscalation, maskPhone } = require('../lib/escalation');
const { detectMarket, isHinglish } = require('../lib/market');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym', 'weight loss': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', '40+': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'personalised': '12wk', 'personalized': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  '12wk': '12-Week Custom',
  'zoom_trial': 'Zoom Trial'
};

function extractMessage(body) {
  // AiSensy format
  if (body.senderPhone && body.message) {
    return { phone: body.senderPhone, name: body.senderName || '', text: body.message };
  }
  // Meta Cloud API format
  if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const contact = body.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: msg.from,
      name: contact?.profile?.name || '',
      text: msg.text?.body || msg.button?.text || ''
    };
  }
  return null;
}

function detectProgram(text) {
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  // Meta webhook verification
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).end();
  }

  if (req.method !== 'POST') return res.status(405).end();

  const parsed = extractMessage(req.body);
  if (!parsed) return res.status(200).json({ status: 'ignored' });

  const { phone, name, text } = parsed;
  const db = getSupabase();

  // Log incoming message
  await logMessage(phone, 'in', text, null);

  // Check for opt-out
  const lowerText = text.toLowerCase().trim();
  if (lowerText === 'stop' || lowerText === 'unsubscribe') {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
    return res.status(200).json({ status: 'opted_out' });
  }

  // Check for escalation
  const esc = checkEscalation(text);
  if (esc.escalate) {
    const { data: client } = await db.from('clients').select('id').eq('phone', phone).single();
    const { data: lead } = await db.from('leads').select('id').eq('phone', phone).single();
    await db.from('escalations').insert({
      phone,
      client_id: client?.id || null,
      lead_id: lead?.id || null,
      reason: esc.reason,
      trigger_message: text
    });
    await notifyMaddy(
      esc.reason,
      `Phone: ${maskPhone(phone)}\nMessage: "${text}"\nAction required.`
    );
    return res.status(200).json({ status: 'escalated' });
  }

  // Check if existing client
  const { data: existingClient } = await db.from('clients').select('*').eq('phone', phone).single();
  if (existingClient && existingClient.status === 'active') {
    // Active client messaging — don't auto-respond, just log
    return res.status(200).json({ status: 'client_message_logged' });
  }

  // Check if existing lead
  const { data: existingLead } = await db.from('leads').select('*').eq('phone', phone).single();
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  if (!existingLead) {
    // New lead — Flow A
    await db.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market
    });

    await sendTemplate(phone, 'welcome_v1', [name || 'there']);
    return res.status(200).json({ status: 'new_lead' });
  }

  // Existing lead — update last_msg_at
  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

  if (existingLead.status === 'dropped') {
    // Re-engaged dropped lead
    await db.from('leads').update({ status: 'new', nudge_count: 0 }).eq('id', existingLead.id);
  }

  // Flow B — Lead qualification
  const program = detectProgram(text);
  if (program) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: program
    }).eq('id', existingLead.id);

    const programName = PROGRAM_NAMES[program] || program;
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

    if (hinglish) {
      await sendTemplate(phone, 'program_match_hi', [
        name || 'there',
        programName,
        checkoutUrl,
        intakeUrl
      ]);
    } else {
      await sendTemplate(phone, 'program_match_en', [
        name || 'there',
        programName,
        checkoutUrl,
        intakeUrl
      ]);
    }

    return res.status(200).json({ status: 'qualified', program });
  }

  return res.status(200).json({ status: 'message_received' });
};
