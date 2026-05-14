import supabase from './lib/supabase.js';
import { sendText, sendTemplate } from './lib/whatsapp.js';
import { detectMarket, isHinglishMarket, maskPhone } from './lib/market.js';
import { needsEscalation, getEscalationReason, notifyMaddy } from './lib/escalation.js';
import {
  KEYWORD_ROUTES, OPT_OUT_KEYWORDS, PROGRAMS,
  WELCOME_MSG_HINGLISH, WELCOME_MSG_ENGLISH,
  BASE_URL, EXLY_BASE,
} from './lib/constants.js';

function extractPayload(body) {
  if (body.entry) {
    const changes = body.entry?.[0]?.changes?.[0]?.value;
    const msg = changes?.messages?.[0];
    if (!msg) return null;
    return {
      phone: msg.from,
      message: msg.text?.body || '',
      name: changes.contacts?.[0]?.profile?.name || '',
    };
  }
  return {
    phone: body.senderPhone || body.from || body.phone || '',
    message: body.message || body.text || body.body || '',
    name: body.senderName || body.name || '',
  };
}

function routeByKeywords(message) {
  const lower = message.toLowerCase();
  for (const route of KEYWORD_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge'];
    if (challenge) return res.status(200).send(challenge);
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = extractPayload(req.body);
    if (!payload || !payload.phone || !payload.message) {
      return res.status(200).json({ status: 'no_message' });
    }

    const { phone, message, name } = payload;

    await supabase.from('messages').insert({
      phone, direction: 'in', body: message.slice(0, 2000),
    });

    const lower = message.toLowerCase().trim();

    if (OPT_OUT_KEYWORDS.some(kw => lower.includes(kw))) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const reason = getEscalationReason(message);
      await notifyMaddy(phone, reason, message, (p, m) => sendText(p, m, true));
      return res.status(200).json({ action: 'escalated', reason });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const hinglish = isHinglishMarket(market);

      await supabase.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message.slice(0, 500),
        last_msg_at: new Date().toISOString(),
        market,
      });

      const welcomeMsg = hinglish ? WELCOME_MSG_HINGLISH : WELCOME_MSG_ENGLISH;
      await sendText(phone, welcomeMsg, true);

      const route = routeByKeywords(message);
      if (route) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: route.program,
        }).eq('phone', phone);

        const programInfo = PROGRAMS[route.program];
        const checkoutUrl = `${EXLY_BASE}/${route.program}`;
        const intakeUrl = `${BASE_URL}/intake.html?phone=${encodeURIComponent(phone)}`;

        const qualifyMsg = hinglish
          ? `${route.label} — bilkul sahi choice! 💪\nPrice: $${programInfo.price}\n\nCheckout: ${checkoutUrl}\nIntake form bhi bharo: ${intakeUrl}`
          : `${route.label} — great choice! 💪\nPrice: $${programInfo.price}\n\nCheckout: ${checkoutUrl}\nPlease fill the intake form too: ${intakeUrl}`;

        await sendText(phone, qualifyMsg, true);
      }

      return res.status(200).json({ action: 'new_lead' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    await supabase.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: existingLead.name || name || null,
    }).eq('id', existingLead.id);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const route = routeByKeywords(message);
      if (route) {
        const market = existingLead.market || detectMarket(phone);
        const hinglish = isHinglishMarket(market);

        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: route.program,
        }).eq('id', existingLead.id);

        const programInfo = PROGRAMS[route.program];
        const checkoutUrl = `${EXLY_BASE}/${route.program}`;
        const intakeUrl = `${BASE_URL}/intake.html?phone=${encodeURIComponent(phone)}`;

        const qualifyMsg = hinglish
          ? `${route.label} — bilkul sahi choice! 💪\nPrice: $${programInfo.price}\n\nCheckout: ${checkoutUrl}\nIntake form bhi bharo: ${intakeUrl}`
          : `${route.label} — great choice! 💪\nPrice: $${programInfo.price}\n\nCheckout: ${checkoutUrl}\nPlease fill the intake form too: ${intakeUrl}`;

        await sendText(phone, qualifyMsg);
        return res.status(200).json({ action: 'qualified', program: route.program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', maskPhone(req.body?.phone || ''), err.message);
    return res.status(200).json({ status: 'error_handled' });
  }
}
