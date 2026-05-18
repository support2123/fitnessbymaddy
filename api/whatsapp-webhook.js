const { supabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation } = require('./_lib/escalation');

const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'lean', 'burn'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'premium', 'flagship'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home Program' },
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.from || payload.senderMobile);
    const text = (payload.text || payload.message || payload.body || '').trim();
    const senderName = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received'
    });

    if (OPT_OUT_KEYWORDS.some(k => text.toLowerCase().includes(k))) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const { escalate, reason } = needsEscalation(text);
    if (escalate) {
      await notifyMaddy(
        `Escalation needed`,
        `Phone: ${maskPhone(phone)}\nKeyword: ${reason}\nMessage: ${text}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient[0].id });
    }

    const market = detectMarket(phone);

    if (!existingLead || existingLead.length === 0) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const hinglish = isHinglish(market);
      await sendTemplate(phone, 'welcome_v1', [
        senderName || (hinglish ? 'Friend' : 'there')
      ]);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    const lead = existingLead[0];

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead', lead_id: lead.id });
    }

    const matched = matchProgram(text);
    if (matched) {
      await supabase.from('leads')
        .update({ status: 'qualified', program_interest: matched.program })
        .eq('id', lead.id);

      const hinglish = isHinglish(market);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

      await sendTemplate(phone, 'program_offer', [
        senderName || lead.name || 'there',
        matched.label,
        checkoutUrl
      ]);

      return res.status(200).json({
        action: 'qualified',
        lead_id: lead.id,
        program: matched.program
      });
    }

    return res.status(200).json({ action: 'reply_logged', lead_id: lead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(k => lower.includes(k))) {
      return entry;
    }
  }
  return null;
}
