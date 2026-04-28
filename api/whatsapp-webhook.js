const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, logIncomingMessage } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'lose': '6wk_gym',
  'slim': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'hormone': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'joint': '40plus',
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

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Flagship Program',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session ($20)',
  'zoom_pack': 'Zoom Session Pack'
};

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { from, text, senderName } = parseWebhookPayload(req.body);
    if (!from) return res.status(400).json({ error: 'Missing phone number' });

    await logIncomingMessage(from, text);

    // Check opt-out
    const lowerText = (text || '').toLowerCase().trim();
    if (lowerText === 'stop' || lowerText === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', from);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check escalation triggers
    if (needsEscalation(text)) {
      await escalateToMaddy({
        reason: 'Keyword escalation trigger in message',
        phone: from,
        clientName: senderName,
        message: text
      });
    }

    // Check if existing lead
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', from)
      .order('created_at', { ascending: false })
      .limit(1);

    const market = detectMarket(from);
    const hinglish = isHinglish(market);

    if (!existingLead || existingLead.length === 0) {
      // FLOW A: New lead
      const { data: lead } = await db.from('leads').insert({
        phone: from,
        name: senderName || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market
      }).select().single();

      const welcomeMsg = hinglish
        ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Welcome to Fitness by Maddy. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({
        phone: from,
        templateName: 'welcome_v1',
        body: welcomeMsg,
        params: [senderName || 'there']
      });

      console.log(`New lead: ${maskPhone(from)} market=${market}`);
      return res.status(200).json({ action: 'new_lead', leadId: lead.id });
    }

    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    // Update last message
    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

    // FLOW B: Try to qualify based on reply
    const matchedProgram = matchProgram(text);

    if (matchedProgram && lead.status === 'new') {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: matchedProgram
      }).eq('id', lead.id);

      const programName = PROGRAM_NAMES[matchedProgram];
      const checkoutLink = CHECKOUT_LINKS[matchedProgram];
      const intakeLink = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

      const qualifyMsg = hinglish
        ? `Great choice! ${programName} aapke liye perfect hai.\n\nCheckout: ${checkoutLink}\n\nPehle ye intake form bhi fill kar do:\n${intakeLink}`
        : `Great choice! The ${programName} is perfect for your goals.\n\nCheckout here: ${checkoutLink}\n\nPlease also fill out your intake form:\n${intakeLink}`;

      await sendWhatsApp({
        phone: from,
        templateName: 'program_qualified',
        body: qualifyMsg,
        params: [senderName || 'there', programName]
      });

      console.log(`Lead qualified: ${maskPhone(from)} → ${matchedProgram}`);
      return res.status(200).json({ action: 'qualified', program: matchedProgram });
    }

    // Already qualified — check if this is an active client replying
    const { data: activeClient } = await db
      .from('clients')
      .select('id, name')
      .eq('phone', from)
      .eq('status', 'active')
      .limit(1);

    if (activeClient && activeClient.length > 0) {
      // Active client — check escalation already done above, just log
      return res.status(200).json({ action: 'client_msg_logged' });
    }

    return res.status(200).json({ action: 'existing_lead_updated' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  // AiSensy webhook format
  if (body.from) {
    return {
      from: body.from,
      text: body.text || body.message || '',
      senderName: body.senderName || body.name || ''
    };
  }
  // Meta Cloud API format (fallback)
  if (body.entry && body.entry[0]) {
    const change = body.entry[0].changes && body.entry[0].changes[0];
    if (change && change.value && change.value.messages) {
      const msg = change.value.messages[0];
      const contact = change.value.contacts && change.value.contacts[0];
      return {
        from: '+' + msg.from,
        text: msg.text ? msg.text.body : '',
        senderName: contact ? contact.profile.name : ''
      };
    }
  }
  return { from: null, text: '', senderName: '' };
}
