import { supabase } from './lib/supabase.js';
import { sendTemplate, detectMarket, maskPhone } from './lib/whatsapp.js';
import { canSendMessage, logMessage } from './lib/rate-limit.js';
import { needsEscalation, escalateToMaddy } from './lib/escalation.js';

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'burn', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build' },
  { keywords: ['home', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', name: '6-Week Home Shred' },
  { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos', name: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'senior', '40+'], program: '40plus', name: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'premium'], program: '12wk', name: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial' },
];

function classifyIntent(message) {
  const lower = message.toLowerCase();

  if (lower === 'stop' || lower === 'unsubscribe') return { action: 'optout' };

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some((kw) => lower.includes(kw))) {
      return { action: 'route_program', program: route.program, name: route.name };
    }
  }

  return { action: 'unknown' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, message, name: senderName } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await logMessage(phone, 'in', message);

    if (needsEscalation(message)) {
      await escalateToMaddy(phone, 'Keyword trigger in message', message);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ status: 'client_active', note: 'Handled by client flow' });
    }

    const intent = classifyIntent(message);

    if (intent.action === 'optout') {
      if (existingLead) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', existingLead.id);
      }
      return res.status(200).json({ status: 'opted_out' });
    }

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: senderName || null,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      const canSend = await canSendMessage(phone);
      if (canSend) {
        await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
        await logMessage(phone, 'out', 'Welcome template sent', 'welcome_v1');
      }

      if (intent.action === 'route_program') {
        await supabase.from('leads').update({
          program_interest: intent.program,
          status: 'qualified',
        }).eq('id', newLead.id);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${newLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${newLead.id}`;
        await sendTemplate(phone, 'program_link', [intent.name, checkoutUrl, intakeUrl]);
        await logMessage(phone, 'out', `Program link: ${intent.name}`, 'program_link');
      }

      return res.status(200).json({ status: 'new_lead', id: newLead.id });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (intent.action === 'route_program' && existingLead.status !== 'converted') {
      await supabase.from('leads').update({
        program_interest: intent.program,
        status: 'qualified',
      }).eq('id', existingLead.id);

      const canSend = await canSendMessage(phone);
      if (canSend) {
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;
        await sendTemplate(phone, 'program_link', [intent.name, checkoutUrl, intakeUrl]);
        await logMessage(phone, 'out', `Program link: ${intent.name}`, 'program_link');
      }
    }

    return res.status(200).json({ status: 'processed', lead_id: existingLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
