const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { checkEscalation, triggerEscalation, routeProgram, isOptOut } = require('../lib/escalation');

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': '$20 Zoom Trial',
  'zoom_pack': 'Zoom Session Pack'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderPhone;
    const messageBody = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: messageBody
    });

    if (isOptOut(messageBody)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = checkEscalation(messageBody);
    if (escalationKeyword) {
      await triggerEscalation(phone, escalationKeyword, messageBody);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, messageBody, senderName, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    if (existingLead.status === 'converted') {
      return res.status(200).json({ action: 'already_converted' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return await handleQualification(existingLead, messageBody, res);

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, messageBody, name, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: messageBody,
      market
    })
    .select()
    .single();

  if (hinglish) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there'
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there'
    ]);
  }

  const programKey = routeProgram(messageBody);
  if (programKey) {
    await supabase
      .from('leads')
      .update({ status: 'qualified', program_interest: programKey })
      .eq('id', lead.id);

    await sendQualificationReply(phone, programKey, lead.id, hinglish);
  }

  return res.status(200).json({ action: 'new_lead', id: lead.id, program: programKey });
}

async function handleQualification(lead, messageBody, res) {
  const programKey = routeProgram(messageBody);
  if (!programKey) {
    return res.status(200).json({ action: 'no_program_match' });
  }

  const hinglish = isHinglish(lead.market);

  await supabase
    .from('leads')
    .update({ status: 'qualified', program_interest: programKey })
    .eq('id', lead.id);

  await sendQualificationReply(lead.phone, programKey, lead.id, hinglish);

  return res.status(200).json({ action: 'qualified', program: programKey });
}

async function sendQualificationReply(phone, programKey, leadId, hinglish) {
  const programName = PROGRAM_NAMES[programKey];
  const checkoutLink = CHECKOUT_LINKS[programKey];
  const intakeLink = `https://fitnessbymaddy.com/intake.html?lead=${leadId}`;

  if (hinglish) {
    await sendText(phone,
      `Perfect choice! 🔥 ${programName} aapke liye best rahega.\n\n` +
      `Yahan se enroll karo:\n${checkoutLink}\n\n` +
      `Aur yeh intake form bhi fill kardo taaki hum aapka plan bana sake:\n${intakeLink}\n\n` +
      `Koi bhi sawaal ho toh poochho — hum yahan hain!`
    );
  } else {
    await sendText(phone,
      `Great choice! 🔥 The ${programName} is perfect for your goals.\n\n` +
      `Enroll here:\n${checkoutLink}\n\n` +
      `Please also fill out this intake form so we can build your plan:\n${intakeLink}\n\n` +
      `Any questions? Just ask — we're here to help!`
    );
  }
}
