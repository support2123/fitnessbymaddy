const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, detectProgram, isOptOut } = require('./_lib/escalation');

const PROGRAM_INFO = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: '$97', slug: '6wk-gym' },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: '$97', slug: '6wk-home' },
  '12wk': { name: '12-Week Flagship Program', price: '$200', slug: '12wk' },
  pcos: { name: 'PCOS Warrior Program', price: '$45', slug: 'pcos' },
  '40plus': { name: '40+ Strong Program', price: '$50', slug: '40plus' },
  zoom_trial: { name: 'Zoom Trial Session', price: '$20', slug: 'zoom-trial' },
  zoom_pack: { name: 'Zoom Pack', price: '$80', slug: 'zoom-pack' }
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { phone, message, name, senderName } = parsePayload(req.body);
    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await db.from('messages').insert({
      phone, direction: 'in', body: message
    });

    if (isOptOut(message)) {
      await db.from('leads').upsert(
        { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await notifyMaddy(
        'Medical/Sensitive flag',
        `Phone: ${maskPhone(phone)}\nMessage: ${message.slice(0, 200)}`
      );
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .single();

    if (existingClient && existingClient.status === 'active') {
      return res.status(200).json({ action: 'active_client_msg_logged' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: senderName || name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market
      });

      const welcomeParams = hinglish
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        body: welcomeParams[0],
        params: welcomeParams
      });

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString()
    }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    const program = detectProgram(message);
    if (program) {
      const info = PROGRAM_INFO[program];
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program
      }).eq('phone', phone);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${info.slug}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const replyBody = hinglish
        ? `Great choice! ${info.name} (${info.price}) bilkul sahi hai tere liye.\n\nCheckout: ${checkoutUrl}\n\nPehle ye short form bhar de:\n${intakeUrl}`
        : `Great choice! ${info.name} (${info.price}) is perfect for you.\n\nCheckout: ${checkoutUrl}\n\nPlease fill this quick form first:\n${intakeUrl}`;

      await sendWhatsApp({
        phone,
        templateName: 'program_recommendation',
        body: replyBody,
        params: [info.name, info.price, checkoutUrl, intakeUrl]
      });

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parsePayload(body) {
  if (!body) return {};
  if (body.phone && body.message) return body;
  if (body.payload) {
    const p = body.payload;
    return {
      phone: p.sender?.phone || p.from || p.wa_id,
      message: p.text?.body || p.body || p.message,
      senderName: p.sender?.name || p.profile?.name
    };
  }
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    return {
      phone: msg?.from ? '+' + msg.from : null,
      message: msg?.text?.body || '',
      senderName: contact?.profile?.name
    };
  }
  return {
    phone: body.from || body.wa_id || body.sender,
    message: body.text || body.body || body.message,
    senderName: body.name || body.senderName
  };
}
