const { supabase } = require('../lib/supabase');
const { sendTemplate, canSendMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'lose': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'pcod': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'custom': '12wk',
  '12 week': '12wk',
  'serious': '12wk',
  'flagship': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
  'try': 'zoom_trial'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

function routeToProgram(message) {
  const lower = message.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = extractPayload(req.body);

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    // Log inbound message
    await supabase.from('messages').insert({
      phone, direction: 'in', body: message
    });

    // Handle opt-out
    if (isOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check escalation
    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger', phone, message);
    }

    // Check if existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (existingLead && existingLead.length > 0) {
      const lead = existingLead[0];

      if (lead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead_ignored' });
      }

      // Update last message timestamp
      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', lead.id);

      // Try to qualify
      if (lead.status === 'new') {
        const program = routeToProgram(message);
        if (program) {
          await supabase
            .from('leads')
            .update({ status: 'qualified', program_interest: program })
            .eq('id', lead.id);

          const market = detectMarket(phone);
          const checkoutUrl = CHECKOUT_LINKS[program];
          const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

          if (isHinglish(market)) {
            await sendTemplate(phone, 'qualified_hinglish', [checkoutUrl, intakeUrl]);
          } else {
            await sendTemplate(phone, 'qualified_english', [checkoutUrl, intakeUrl]);
          }

          return res.status(200).json({ action: 'qualified', program });
        }
      }

      return res.status(200).json({ action: 'existing_lead_updated' });
    }

    // New lead
    const market = detectMarket(phone);
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        market
      })
      .select()
      .single();

    // Rate-limit check
    const canSend = await canSendMessage(phone, false);
    if (canSend) {
      const template = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1_en';
      await sendTemplate(phone, template);
    }

    // Schedule nudge (handled by cron, tracked via last_msg_at)

    return res.status(200).json({ action: 'new_lead', id: newLead?.id });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function extractPayload(body) {
  // AiSensy webhook format
  if (body.phone && body.text) {
    return { phone: body.phone, message: body.text, name: body.name || null };
  }
  // Meta Cloud API format
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (msg) {
      const contact = change.contacts?.[0];
      return {
        phone: '+' + msg.from,
        message: msg.text?.body || '',
        name: contact?.profile?.name || null
      };
    }
  }
  // Generic fallback
  return { phone: body.phone, message: body.message || body.body, name: body.name };
}

function isOptOut(message) {
  const lower = message.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout'].includes(lower);
}
