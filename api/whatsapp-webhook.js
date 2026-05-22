import { getSupabase } from './_lib/supabase.js';
import { sendWhatsApp, detectMarket, maskPhone } from './_lib/whatsapp.js';
import { checkEscalation, escalateToMaddy, checkOptOut } from './_lib/escalation.js';
import { handleCors, parseBody, routeProgram, PROGRAM_NAMES } from './_lib/utils.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const body = parseBody(req);

  const phone = body.phone || body.senderPhone || body.from || '';
  const message = body.message || body.text || body.body || '';
  const name = body.name || body.senderName || '';

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: message
  });

  if (checkOptOut(message)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.json({ action: 'opted_out' });
  }

  if (checkEscalation(message)) {
    await escalateToMaddy('Keyword trigger in message', phone, message);
    return res.json({ action: 'escalated' });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    const { data: lead } = await db.from('leads').insert({
      phone,
      name,
      first_msg: message,
      market,
      status: 'new'
    }).select().single();

    const welcomeParams = market === 'IN'
      ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
      : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a trial session first?'];

    await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

    return res.json({ action: 'new_lead', lead_id: lead?.id });
  }

  if (existingLead.status === 'dropped') {
    return res.json({ action: 'ignored_dropped' });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

  const program = routeProgram(message);
  if (program && existingLead.status === 'new') {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: program
    }).eq('id', existingLead.id);

    const programName = PROGRAM_NAMES[program];
    const checkoutLink = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
    const intakeLink = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

    const market = existingLead.market;
    const msgParams = market === 'IN'
      ? [`${programName} perfect rahega! Checkout: ${checkoutLink} | Intake form: ${intakeLink}`]
      : [`${programName} is perfect for you! Checkout: ${checkoutLink} | Intake form: ${intakeLink}`];

    await sendWhatsApp(phone, 'program_recommendation', msgParams);

    return res.json({ action: 'qualified', program });
  }

  return res.json({ action: 'message_logged' });
}
