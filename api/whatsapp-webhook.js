const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendSession, logMessage } = require('./_lib/whatsapp');
const { checkEscalation, notifyMaddy } = require('./_lib/escalation');
const { detectMarket, isHinglish } = require('./_lib/market');

const OPT_OUT = ['stop', 'unsubscribe', 'opt out', 'optout'];

const RULES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'patla'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personal'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'pehle', 'dekhna'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' }
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { from, text, name: senderName } = parseWebhook(req.body);
    if (!from || !text) return res.status(400).json({ error: 'Invalid payload' });

    await logMessage(from, 'in', text, null);

    if (OPT_OUT.some(kw => text.toLowerCase().includes(kw))) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', from);
      await supabase.from('clients').update({ status: 'paused' }).eq('phone', from);
      return res.status(200).json({ action: 'opted_out' });
    }

    const esc = checkEscalation(text);
    if (esc.shouldEscalate) {
      const lead = await leadByPhone(from);
      await notifyMaddy(supabase, sendTemplate,
        { name: senderName || lead?.name, phone: from },
        `Triggers: ${esc.triggers.join(', ')}. Msg: "${text.slice(0, 100)}"`
      );
    }

    const client = await clientByPhone(from);
    if (client) return res.status(200).json({ action: 'client_message', client_id: client.id });

    const lead = await leadByPhone(from);

    if (!lead) {
      const market = detectMarket(from);
      await supabase.from('leads').insert({
        phone: from, name: senderName, source: 'whatsapp', status: 'new',
        first_msg: text, last_msg_at: new Date().toISOString(), market
      });
      const tpl = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1';
      await sendTemplate(from, tpl, [senderName || 'there']);
      return res.status(200).json({ action: 'new_lead' });
    }

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_ignored' });
    }

    const lower = text.toLowerCase();
    let matched = RULES.find(r => r.keywords.some(kw => lower.includes(kw)));
    if (!matched) matched = RULES[RULES.length - 1];

    await supabase.from('leads').update({
      status: 'qualified', program_interest: matched.program,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    const market = detectMarket(from);
    const checkout = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;
    const intake = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

    if (isHinglish(market)) {
      await sendSession(from,
        `Perfect! Tumhare liye best program: *${matched.name}* (${matched.price})\n\n` +
        `Checkout: ${checkout}\n\nYeh form bhi fill karo:\n${intake}`
      );
    } else {
      await sendSession(from,
        `Great choice! Best program for you: *${matched.name}* (${matched.price})\n\n` +
        `Checkout: ${checkout}\n\nAlso fill this form:\n${intake}`
      );
    }

    return res.status(200).json({ action: 'lead_qualified', program: matched.program });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhook(body) {
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const contact = body.entry[0].changes[0].value.contacts?.[0];
    return { from: msg.from, text: msg.text?.body || '', name: contact?.profile?.name };
  }
  return { from: body?.from, text: body?.text || body?.message, name: body?.name || body?.pushName };
}

async function leadByPhone(phone) {
  const { data } = await supabase.from('leads').select('*')
    .eq('phone', phone).order('created_at', { ascending: false }).limit(1).single();
  return data;
}

async function clientByPhone(phone) {
  const { data } = await supabase.from('clients').select('*')
    .eq('phone', phone).eq('status', 'active').limit(1).single();
  return data;
}
