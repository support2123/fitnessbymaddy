const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText, canSendMessage, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, escalate } = require('./_lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym',
  weight: '6wk_gym',
  shred: '6wk_gym',
  slim: '6wk_gym',
  pcos: 'pcos',
  hormonal: 'pcos',
  hormone: 'pcos',
  '40': '40plus',
  menopause: '40plus',
  joints: '40plus',
  custom: '12wk',
  '12 week': '12wk',
  serious: '12wk',
  trial: 'zoom_trial',
  zoom: 'zoom_trial',
  'not sure': 'zoom_trial',
  try: 'zoom_trial',
  home: '6wk_home',
  'no gym': '6wk_home',
  'ghar pe': '6wk_home',
  strength: '6wk_gym',
};

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build-gym',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  pcos: 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  zoom_trial: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  zoom_pack: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  pcos: 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  zoom_trial: 'Zoom Trial Session ($20)',
  zoom_pack: 'Zoom Session Pack',
};

function routeToProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { mobile, message, name } = req.body;
    const phone = (mobile || '').replace(/\D/g, '');

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message || '',
    });

    const lower = (message || '').toLowerCase().trim();

    if (lower === 'stop' || lower === 'unsubscribe') {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(message);
    if (escalationKeyword) {
      await escalate(phone, escalationKeyword, message);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: name || null,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          market,
        })
        .select()
        .single();

      await sendTemplate(phone, 'welcome_v1', [name || 'there']);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const program = routeToProgram(message);
    if (program) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', existingLead.id);

      const checkoutUrl = CHECKOUT_URLS[program];
      const programName = PROGRAM_NAMES[program];
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      if (hinglish) {
        await sendTemplate(phone, 'program_match_hi', [
          name || existingLead.name || 'there',
          programName,
          checkoutUrl,
          intakeUrl,
        ]);
      } else {
        await sendTemplate(phone, 'program_match_en', [
          name || existingLead.name || 'there',
          programName,
          checkoutUrl,
          intakeUrl,
        ]);
      }

      return res.status(200).json({ action: 'qualified', program, lead_id: existingLead.id });
    }

    if (existingLead.status === 'new' && !existingLead.program_interest) {
      const allowed = await canSendMessage(phone, false);
      if (allowed) {
        if (hinglish) {
          await sendText(
            phone,
            `Hey ${existingLead.name || 'there'}! Mujhe thoda aur batao — kya goal hai tumhara? Fat loss, PCOS management, 40+ fitness, ya full custom 12-week program? Ya pehle ek trial session try karna hai? 😊`
          );
        } else {
          await sendText(
            phone,
            `Hey ${existingLead.name || 'there'}! Tell me more about your goal — are you looking for fat loss, PCOS management, 40+ fitness, or a fully custom 12-week program? Or would you like to try a trial session first?`
          );
        }
      }
    }

    return res.status(200).json({ action: 'replied', lead_id: existingLead.id });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
};
