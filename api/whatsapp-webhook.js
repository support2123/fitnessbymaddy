const { supabase } = require('../lib/supabase');
const { sendTemplate, canSendMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym',
  weight: '6wk_gym',
  shred: '6wk_gym',
  slim: '6wk_gym',
  pcos: 'pcos',
  hormonal: 'pcos',
  '40': '40plus',
  menopause: '40plus',
  joints: '40plus',
  custom: '12wk',
  '12 week': '12wk',
  serious: '12wk',
  trial: 'zoom_trial',
  zoom: 'zoom_trial',
  'not sure': 'zoom_trial',
  home: '6wk_home',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  pcos: 'PCOS Warrior',
  '40plus': '40+ Strong',
  zoom_trial: 'Zoom Trial Session',
  zoom_pack: 'Zoom Pack',
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    if (message && /\b(stop|unsubscribe)\b/i.test(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Incoming message flagged', phone, message);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await supabase.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
      });

      await sendTemplate(phone, 'welcome_v1', [
        name || (hinglish ? 'there' : 'there'),
      ]);

      return res.json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'lead_dropped_ignored' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = matchProgram(message);
      if (program) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const allowed = await canSendMessage(phone);
        if (allowed) {
          const programName = PROGRAM_NAMES[program] || program;
          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
          const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

          await sendTemplate(phone, 'program_match', [
            name || existingLead.name || 'there',
            programName,
            checkoutUrl,
            intakeUrl,
          ]);
        }

        return res.json({ action: 'lead_qualified', program });
      }
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (!body) return {};
  if (body.phone) return body;
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (msg) {
      return {
        phone: msg.from,
        message: msg.text?.body || '',
        name: change.contacts?.[0]?.profile?.name || '',
      };
    }
  }
  return {};
}
