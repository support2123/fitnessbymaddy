import { getSupabase } from '../lib/supabase.js';
import { sendWhatsApp, logIncomingMessage } from '../lib/whatsapp.js';
import { detectMarket, isHinglish } from '../lib/market.js';
import { needsEscalation, escalateToMaddy } from '../lib/escalation.js';

const PROGRAM_ROUTES = {
  fat_loss: { keywords: ['fat loss', 'weight', 'shred', 'lose weight', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  pcos: { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  fortyplus: { keywords: ['40', 'menopause', 'joints', 'joint', '40+', 'forty'], program: '40plus', name: '40+ Strong', price: '$50' },
  flagship: { keywords: ['custom', '12 week', 'serious', 'personalised', 'personalized', 'flagship'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  trial: { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial Session', price: '$20' }
};

function classifyIntent(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  if (lower === 'stop' || lower === 'unsubscribe') return 'optout';

  for (const [key, route] of Object.entries(PROGRAM_ROUTES)) {
    if (route.keywords.some(kw => lower.includes(kw))) return key;
  }

  return 'unknown';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const payload = req.body;

    const phone = payload.mobile || payload.phone || payload.from;
    const message = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    await logIncomingMessage({ phone, body: message });

    if (needsEscalation(message)) {
      await escalateToMaddy({
        reason: 'Keyword trigger in incoming message',
        phone,
        message,
        clientName: senderName
      });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ ok: true, action: 'active_client_message_logged' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status, first_msg')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const intent = classifyIntent(message);
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (intent === 'optout') {
      if (existingLead) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', existingLead.id);
      }
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString()
      }).select().single();

      const welcomeBody = hinglish
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        body: welcomeBody
      });

      return res.status(200).json({ ok: true, action: 'new_lead_welcomed', leadId: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'lead_is_dropped_no_action' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString()
    }).eq('id', existingLead.id);

    if (intent && intent !== 'unknown') {
      const route = PROGRAM_ROUTES[intent];

      await db.from('leads').update({
        status: 'qualified',
        program_interest: route.program
      }).eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const qualifyBody = hinglish
        ? `Great choice! 🔥 ${route.name} program (${route.price}) bilkul sahi hai tere liye.\n\nCheckout: ${checkoutUrl}\n\nPehle ye form bhar do: ${intakeUrl}`
        : `Great choice! 🔥 The ${route.name} program (${route.price}) is perfect for you.\n\nCheckout: ${checkoutUrl}\n\nPlease fill this form first: ${intakeUrl}`;

      await sendWhatsApp({
        phone,
        templateName: 'program_recommendation',
        body: qualifyBody
      });

      return res.status(200).json({ ok: true, action: 'lead_qualified', program: route.program });
    }

    return res.status(200).json({ ok: true, action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
