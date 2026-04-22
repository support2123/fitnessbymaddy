import supabase from './lib/supabase.js';
import { sendTemplate, sendText, maskPhone } from './lib/whatsapp.js';
import { detectMarket, getWelcomeMessage, getNudgeMessage, getProgramMessage } from './lib/market.js';
import { shouldEscalate, escalate } from './lib/escalation.js';
import { canSendMessage, logMessage, isOptedOut } from './lib/rate-limit.js';

const PROGRAM_MAP = {
  'fat loss': { program: '6wk_gym', name: '6-Week Burn & Build', price: '$45' },
  'weight': { program: '6wk_gym', name: '6-Week Burn & Build', price: '$45' },
  'shred': { program: '6wk_gym', name: '6-Week Burn & Build', price: '$45' },
  'pcos': { program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  'hormonal': { program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  '40': { program: '40plus', name: '40+ Strong', price: '$50' },
  'menopause': { program: '40plus', name: '40+ Strong', price: '$50' },
  'joints': { program: '40plus', name: '40+ Strong', price: '$50' },
  'custom': { program: '12wk', name: '12-Week Flagship', price: '$200' },
  '12 week': { program: '12wk', name: '12-Week Flagship', price: '$200' },
  'serious': { program: '12wk', name: '12-Week Flagship', price: '$200' },
  'trial': { program: 'zoom_trial', name: 'Zoom Trial Session', price: '$20' },
  'zoom': { program: 'zoom_trial', name: 'Zoom Trial Session', price: '$20' },
  'not sure': { program: 'zoom_trial', name: 'Zoom Trial Session', price: '$20' },
  'home': { program: '6wk_home', name: '6-Week Home Program', price: '$45' },
};

const CHECKOUT_BASE = 'https://fitnessbymaddyy.exlyapp.com/checkout';
const INTAKE_BASE = 'https://fitnessbymaddy.com/intake.html';

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const [keyword, info] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return info;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.senderMobile || payload.from;
    const messageBody = payload.message || payload.text || payload.body || '';
    const senderName = payload.senderName || payload.name || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logMessage(phone, 'in', messageBody);

    const optedOut = await isOptedOut(phone);
    if (optedOut) return res.status(200).json({ status: 'opted_out' });

    const lower = messageBody.toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ status: 'unsubscribed' });
    }

    const escalationKeyword = shouldEscalate(messageBody);
    if (escalationKeyword) {
      await escalate(phone, escalationKeyword, messageBody);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: senderName || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageBody,
        market,
      }).select().single();

      const welcome = getWelcomeMessage(market);
      await sendText(phone, welcome);
      await logMessage(phone, 'out', welcome, 'welcome_v1');

      return res.status(200).json({ status: 'new_lead', id: newLead?.id });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const programMatch = matchProgram(messageBody);

      if (programMatch) {
        const allowed = await canSendMessage(phone);
        if (!allowed) return res.status(200).json({ status: 'rate_limited' });

        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: programMatch.program,
        }).eq('phone', phone);

        const checkoutUrl = `${CHECKOUT_BASE}/${existingLead.id}`;
        const intakeUrl = `${INTAKE_BASE}?lead=${existingLead.id}`;
        const market = existingLead.market || 'GLOBAL';

        const msg = getProgramMessage(market, programMatch.name, checkoutUrl);
        await sendText(phone, msg);
        await logMessage(phone, 'out', msg, 'program_route');

        const intakeMsg = market === 'IN'
          ? `Aur haan, ye intake form bhi fill kar do taaki Maddy tumhare liye best plan bana sake 📋\n${intakeUrl}`
          : `Also, please fill out this intake form so Maddy can build the best plan for you 📋\n${intakeUrl}`;
        await sendText(phone, intakeMsg);
        await logMessage(phone, 'out', intakeMsg, 'intake_form');

        return res.status(200).json({ status: 'qualified', program: programMatch.program });
      }
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient && escalationKeyword) {
      return res.status(200).json({ status: 'escalated_client' });
    }

    return res.status(200).json({ status: 'received' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
