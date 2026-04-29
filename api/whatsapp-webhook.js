const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { canSendMessage, logMessage } = require('../lib/rate-limit');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'periods', 'irregular'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'forty', '40+', 'forty plus'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' }
];

function routeToProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', webhook: 'whatsapp' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const payload = req.body;

  const phone = payload.phone || payload.from || payload.sender?.phone;
  const message = payload.message || payload.text || payload.body || '';
  const name = payload.name || payload.sender?.name || null;

  if (!phone) return res.status(400).json({ error: 'No phone number in payload' });

  await logMessage(phone, 'in', message, null, 'received');

  if (isOptOut(message)) {
    await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    await supabase.from('clients').update({ status: 'paused' }).eq('phone', phone);
    console.log(`Opt-out: ${maskPhone(phone)}`);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(message)) {
    await escalateToMaddy('Keyword trigger in message', { phone, name, message });
    return res.status(200).json({ action: 'escalated' });
  }

  const { data: existingClient } = await supabase
    .from('clients')
    .select('id, status')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (existingClient) {
    return res.status(200).json({ action: 'active_client', note: 'Routed to client support flow' });
  }

  const { data: existingLead } = await supabase
    .from('leads')
    .select('id, status, first_msg')
    .eq('phone', phone)
    .limit(1)
    .single();

  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  if (!existingLead) {
    const { data: newLead } = await supabase.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market
    }).select().single();

    const allowed = await canSendMessage(phone);
    if (allowed) {
      const welcomeTemplate = hinglish ? 'welcome_v1_hi' : 'welcome_v1';
      await sendWhatsApp(phone, welcomeTemplate, { name: name || 'there' });
      await logMessage(phone, 'out', 'Welcome message sent', welcomeTemplate);
    }

    return res.status(200).json({ action: 'new_lead', leadId: newLead?.id });
  }

  await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'lead_dropped', note: 'Ignoring dropped lead' });
  }

  const route = routeToProgram(message);
  if (route) {
    await supabase.from('leads').update({
      status: 'qualified',
      program_interest: route.program
    }).eq('id', existingLead.id);

    const allowed = await canSendMessage(phone);
    if (allowed) {
      const qualifyMsg = hinglish
        ? `Great choice! ${route.name} (${route.price}) perfect hai aapke liye. Yahan se start karo:`
        : `Great choice! ${route.name} (${route.price}) is perfect for you. Get started here:`;

      await sendWhatsApp(phone, 'program_qualify', {
        name: name || 'there',
        templateParams: [route.name, route.price, `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`]
      });
      await logMessage(phone, 'out', qualifyMsg, 'program_qualify');
    }

    return res.status(200).json({ action: 'qualified', program: route.program });
  }

  return res.status(200).json({ action: 'no_route', note: 'Message did not match any program keyword' });
};
