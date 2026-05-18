const { supabase } = require('./_lib/supabase');
const { sendTemplate, canSendToLead, logMessage, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, classifyEscalation } = require('./_lib/escalation');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', weight: '6wk_gym', shred: '6wk_gym',
  pcos: 'pcos', hormonal: 'pcos',
  '40': '40plus', menopause: '40plus', joints: '40plus',
  custom: '12wk', '12 week': '12wk', serious: '12wk',
  trial: 'zoom_trial', zoom: 'zoom_trial', 'not sure': 'zoom_trial'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  pcos: 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  zoom_trial: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  zoom_pack: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.sender || payload.from || payload.waId;
    const text = payload.text || payload.body || payload.message?.text || '';
    const name = payload.senderName || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logMessage(phone, 'in', text, null);

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text.trim())) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const type = classifyEscalation(text);
      await notifyMaddy(`${type} — ${maskPhone(phone)}`, `Message: "${text.slice(0, 200)}"`);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: lead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const templateName = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1_en';
      await sendTemplate(phone, templateName, [name || 'there']);

      return res.json({ action: 'new_lead', lead_id: lead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = matchProgram(text);
      if (program) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: program
        }).eq('id', existingLead.id);

        const checkoutUrl = CHECKOUT_LINKS[program];
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;
        const market = existingLead.market || 'IN';

        if (isHinglish(market)) {
          await sendTemplate(phone, 'qualified_hi', [
            name || 'there',
            checkoutUrl,
            intakeUrl
          ]);
        } else {
          await sendTemplate(phone, 'qualified_en', [
            name || 'there',
            checkoutUrl,
            intakeUrl
          ]);
        }

        return res.json({ action: 'qualified', program });
      }
    }

    return res.json({ action: 'noted', lead_id: existingLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
