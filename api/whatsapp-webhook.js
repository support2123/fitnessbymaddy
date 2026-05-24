const { supabase } = require('../lib/supabase');
const { sendTemplate, sendWhatsAppText, canSendMessage, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { checkEscalation, createEscalation } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'weight loss': '6wk_gym', 'lose weight': '6wk_gym', 'slim': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'pcod': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', '40+': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'personalised': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Training',
  'zoom_trial': '$20 Zoom Trial'
};

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/trial'
};

const STOP_WORDS = ['stop', 'unsubscribe', 'cancel', 'opt out', 'optout'];

function detectProgram(text) {
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.from || payload.senderPhone || payload.waId;
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone number' });

    await logMessage({ phone, direction: 'in', body: text });

    const lower = text.toLowerCase().trim();
    if (STOP_WORDS.some(w => lower === w || lower === w + '.')) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      console.log(`Opt-out received from ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = checkEscalation(text);
    if (escalationKeyword) {
      const { data: existingLead } = await supabase
        .from('leads').select('id').eq('phone', phone).limit(1).single();
      const { data: existingClient } = await supabase
        .from('clients').select('id').eq('phone', phone).limit(1).single();

      await createEscalation({
        phone,
        leadId: existingLead?.id,
        clientId: existingClient?.id,
        reason: `Keyword detected: "${escalationKeyword}"`,
        triggerMessage: text
      });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          last_msg_at: new Date().toISOString(),
          market
        })
        .select()
        .single();

      if (hinglish) {
        await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [senderName || 'there']);
      }

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: senderName || existingLead.name })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = detectProgram(text);

      if (program) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const allowed = await canSendMessage(phone, false);
        if (!allowed) {
          return res.status(200).json({ action: 'rate_limited' });
        }

        const programName = PROGRAM_NAMES[program];
        const checkoutUrl = CHECKOUT_URLS[program];
        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const msg = hinglish
          ? `Great choice! ${programName} perfect hai tere liye. Yeh raha checkout link:\n${checkoutUrl}\n\nAur yeh intake form bhi fill kardo:\n${intakeUrl}`
          : `Great choice! ${programName} is perfect for you. Here's your checkout link:\n${checkoutUrl}\n\nAlso, please fill out the intake form:\n${intakeUrl}`;

        await sendWhatsAppText(phone, msg);
        return res.status(200).json({ action: 'qualified', program });
      }

      return res.status(200).json({ action: 'awaiting_qualification' });
    }

    if (existingLead.status === 'qualified') {
      return res.status(200).json({ action: 'already_qualified' });
    }

    return res.status(200).json({ action: 'existing_lead' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
