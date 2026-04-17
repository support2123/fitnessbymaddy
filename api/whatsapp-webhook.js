const { supabase } = require('../lib/supabase');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { canSendMessage, sendTemplate, sendText } = require('../lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'cut'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', '40+', 'forty'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'full'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
];

const STOP_WORDS = ['stop', 'unsubscribe', 'optout', 'opt out', 'opt-out'];

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const message = extractMessage(req.body);
    if (!message) return res.status(200).json({ status: 'no_message' });

    const { phone, text, name } = message;

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text,
    });

    if (STOP_WORDS.some((w) => text.toLowerCase().includes(w))) {
      await supabase.from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', { phone, name, message: text });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ status: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .maybeSingle();

    const market = detectMarket(phone);

    if (!existingLead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone, name, source: 'whatsapp', status: 'new',
        first_msg: text, last_msg_at: new Date().toISOString(), market,
      }).select().single();

      const hinglish = isHinglish(market);
      await sendTemplate(phone, 'welcome_v1', [name || 'there'], name);

      scheduleNudge(phone, name, newLead.id);

      return res.status(200).json({ status: 'new_lead', lead_id: newLead.id });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ status: 'dropped_lead' });
    }

    if (existingLead.status === 'new') {
      const matched = matchProgram(text);
      if (matched) {
        await supabase.from('leads')
          .update({ status: 'qualified', program_interest: matched.program })
          .eq('id', existingLead.id);

        const hinglish = isHinglish(market);
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        if (await canSendMessage(phone, false)) {
          const msg = hinglish
            ? `${matched.label} program perfect hai aapke liye! 💪\n\nCheckout: ${checkoutUrl}\n\nPehle ye form bhar do: ${intakeUrl}`
            : `${matched.label} is perfect for you! 💪\n\nCheckout: ${checkoutUrl}\n\nPlease fill this form first: ${intakeUrl}`;
          await sendText(phone, msg);
        }

        return res.status(200).json({ status: 'qualified', program: matched.program });
      }
    }

    return res.status(200).json({ status: 'processed' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error' });
  }
};

function extractMessage(body) {
  try {
    if (body.entry) {
      const change = body.entry[0]?.changes?.[0]?.value;
      const msg = change?.messages?.[0];
      if (!msg) return null;
      return {
        phone: msg.from,
        text: msg.text?.body || msg.button?.text || '',
        name: change.contacts?.[0]?.profile?.name || null,
      };
    }
    if (body.message) {
      return {
        phone: body.message.from || body.from,
        text: body.message.text || body.message.body || '',
        name: body.message.name || body.name || null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function matchProgram(text) {
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some((kw) => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

async function scheduleNudge(phone, name, leadId) {
  // Nudges are handled by the cron/nudge-dropped endpoint
  // which checks lead timestamps and sends nudges accordingly
}
