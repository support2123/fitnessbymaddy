const { getSupabase } = require('../lib/supabase');
const { sendTemplate, canSendMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, getWelcomeMessage, getNudgeMessage } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'shred', 'burn', 'lean', 'cut'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40+', '40 plus', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', '12-week', 'serious', 'flagship', 'full program'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test']
};

const BASE_URL = process.env.BASE_URL || 'https://www.fitnessbymaddy.com';

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    // Log inbound message
    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text
    });

    // Check opt-out
    const lowerText = text.toLowerCase().trim();
    if (lowerText === 'stop' || lowerText === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check escalation
    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', phone, text);
    }

    // Check if existing client
    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    // Check if existing lead
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      // Update last message
      await db.from('leads')
        .update({ last_msg_at: new Date().toISOString(), first_msg: existingLead.first_msg || text })
        .eq('id', existingLead.id);

      // Try to qualify based on reply
      const program = matchProgram(text);
      if (program && existingLead.status === 'new') {
        await db.from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const market = existingLead.market || detectMarket(phone);
        const isHinglish = market === 'IN';

        // Send checkout + intake links
        const checkoutMsg = isHinglish
          ? `Program mil gaya! Yahan se purchase karo aur intake form bharo:`
          : `Great choice! Complete your purchase and fill out the intake form:`;

        if (await canSendMessage(phone, false)) {
          await sendTemplate(phone, 'program_qualified', [
            checkoutMsg,
            `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`,
            `${BASE_URL}/intake?lead=${existingLead.id}`
          ]);
        }

        return res.status(200).json({ action: 'qualified', program });
      }

      return res.status(200).json({ action: 'existing_lead' });
    }

    // New lead — insert and send welcome
    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      market
    }).select().single();

    // Send welcome template
    await sendTemplate(phone, 'welcome_v1', [getWelcomeMessage(market)]);

    console.log(`New lead: ${maskPhone(phone)} market=${market}`);

    return res.status(200).json({ action: 'new_lead', id: newLead?.id });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
