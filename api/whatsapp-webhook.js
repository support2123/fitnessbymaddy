const { supabase } = require('../lib/supabase');
const { sendTemplate, sendTextMessage, canSendMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'fat': '6wk_gym', 'lose': '6wk_gym', 'slim': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const CHECKOUT_MAP = {
  '6wk_gym': 'shred-6week',
  '6wk_home': 'shred-6week-home',
  '12wk': 'custom-12week',
  'pcos': 'pcos-warrior',
  '40plus': '40plus-strong',
  'zoom_trial': 'zoom-trial',
  'zoom_pack': 'zoom-pack'
};

const PRICE_MAP = {
  '6wk_gym': '$29', '6wk_home': '$29', '12wk': '$200',
  'pcos': '$45', '40plus': '$50', 'zoom_trial': '$20', 'zoom_pack': '$99'
};

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.mobile || body.phone || body.from;
    const message = body.message || body.text || body.body || '';
    const name = body.name || body.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const normalized = phone.startsWith('+') ? phone : `+${phone}`;
    const market = detectMarket(normalized);
    const hinglish = isHinglish(market);

    await supabase().from('messages').insert({
      phone: normalized,
      direction: 'in',
      body: message
    });

    // Check opt-out
    const lowerMsg = message.toLowerCase().trim();
    if (lowerMsg === 'stop' || lowerMsg === 'unsubscribe') {
      await supabase()
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', normalized);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check escalation
    const escalationKeyword = needsEscalation(message);
    if (escalationKeyword) {
      const { data: existingClient } = await supabase()
        .from('clients')
        .select('id')
        .eq('phone', normalized)
        .eq('status', 'active')
        .single();

      await escalateToMaddy(
        normalized,
        `Keyword detected: "${escalationKeyword}"`,
        message,
        existingClient?.id
      );
    }

    // Check if already a client
    const { data: client } = await supabase()
      .from('clients')
      .select('id, status')
      .eq('phone', normalized)
      .eq('status', 'active')
      .single();

    if (client) {
      return res.status(200).json({ action: 'active_client', client_id: client.id });
    }

    // Check existing lead
    const { data: existingLead } = await supabase()
      .from('leads')
      .select('*')
      .eq('phone', normalized)
      .single();

    if (existingLead) {
      await supabase()
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      // Lead replied — try to qualify
      const program = detectProgram(message);
      if (program) {
        await supabase()
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const canSend = await canSendMessage(normalized, false);
        if (canSend) {
          const checkoutId = CHECKOUT_MAP[program] || 'general';
          const price = PRICE_MAP[program] || '';

          const qualifyMsg = hinglish
            ? `Great choice! 🎯 Yeh raha tumhara program link (${price}):\nhttps://fitnessbymaddyy.exlyapp.com/checkout/${checkoutId}\n\nAur yeh intake form bhi fill karo:\nhttps://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`
            : `Great choice! 🎯 Here's your program link (${price}):\nhttps://fitnessbymaddyy.exlyapp.com/checkout/${checkoutId}\n\nAlso fill out the intake form:\nhttps://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

          await sendTextMessage(normalized, qualifyMsg);
        }

        return res.status(200).json({ action: 'qualified', program });
      }

      return res.status(200).json({ action: 'existing_lead' });
    }

    // New lead
    const { data: newLead } = await supabase()
      .from('leads')
      .insert({
        phone: normalized,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        market
      })
      .select()
      .single();

    // Send welcome template
    await sendTemplate(normalized, 'welcome_v1', [name || 'there']);

    // Schedule nudge — handled by cron, but flag the timestamp
    // The nudge cron checks leads with status=new and created_at > 2 hrs ago

    return res.status(200).json({
      action: 'new_lead',
      lead_id: newLead?.id,
      market
    });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
