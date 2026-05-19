const { supabase } = require('./_lib/supabase');
const { sendTemplate, canSendMessage, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', weight: '6wk_gym', shred: '6wk_gym',
  pcos: 'pcos', hormonal: 'pcos',
  '40': '40plus', menopause: '40plus', joints: '40plus',
  custom: '12wk', '12 week': '12wk', serious: '12wk',
  trial: 'zoom_trial', zoom: 'zoom_trial', 'not sure': 'zoom_trial',
  home: '6wk_home',
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  pcos: 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  zoom_trial: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  zoom_pack: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const messageText = (message || '').trim();
    const market = detectMarket(phone);

    await supabase.from('messages').insert({
      phone, direction: 'in', body: messageText,
    });

    if (/^(stop|unsubscribe)$/i.test(messageText)) {
      await supabase.from('leads').update({ status: 'dropped', opted_out: true }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageText)) {
      await escalateToMaddy(
        'Flagged keyword in message',
        `Phone: ${maskPhone(phone)}, Msg: ${messageText.slice(0, 200)}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead && existingLead.opted_out) {
      return res.status(200).json({ action: 'opted_out_ignored' });
    }

    if (!existingLead) {
      const { data: lead } = await supabase.from('leads').insert({
        phone, name: name || null, source: 'whatsapp',
        status: 'new', first_msg: messageText, market,
      }).select().single();

      const hinglish = isHinglish(market);
      await sendTemplate(phone, 'welcome_v1', [
        name || (hinglish ? 'there' : 'there'),
      ]);

      return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = matchProgram(messageText);
      if (program) {
        await supabase.from('leads').update({
          status: 'qualified', program_interest: program,
        }).eq('phone', phone);

        const canSend = await canSendMessage(phone, false);
        if (canSend) {
          const checkoutUrl = CHECKOUT_URLS[program] || CHECKOUT_URLS['zoom_trial'];
          const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;
          await sendTemplate(phone, 'program_checkout', [
            name || existingLead.name || 'there',
            checkoutUrl,
            intakeUrl,
          ]);
        }

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (!body) return {};
  if (body.phone) return body;
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    return {
      phone: msg?.from || '',
      message: msg?.text?.body || '',
      name: contact?.profile?.name || '',
    };
  }
  if (body.data) {
    return {
      phone: body.data.phone || body.data.from || '',
      message: body.data.message || body.data.text || '',
      name: body.data.name || '',
    };
  }
  return {};
}
