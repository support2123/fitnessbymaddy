const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { checkEscalation, matchProgram, isOptOut } = require('../lib/escalation');

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Shred',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Flagship Program',
  'zoom_trial': '$20 Zoom Trial'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const message = extractMessage(payload);
    if (!message) return res.status(200).json({ status: 'no_message' });

    const { phone, text, name } = message;
    const db = getSupabase();

    await db.from('messages').insert({
      phone, direction: 'in', body: text
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ status: 'opted_out' });
    }

    const escalationFlags = checkEscalation(text);
    if (escalationFlags) {
      await notifyMaddy(
        'Escalation trigger detected',
        `Phone: ${maskPhone(phone)}\nKeywords: ${escalationFlags.join(', ')}\nMessage: ${text.slice(0, 200)}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, text, name, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ status: 'lead_dropped' });
    }

    if (existingLead.status === 'converted') {
      return res.status(200).json({ status: 'already_converted' });
    }

    return await handleExistingLead(db, existingLead, text, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(200).json({ status: 'error_handled' });
  }
};

async function handleNewLead(db, phone, text, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone, name, source: 'whatsapp', status: 'new',
    first_msg: text, last_msg_at: new Date().toISOString(), market
  }).select().single();

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1_hi', [name || 'there']);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
  }

  const program = matchProgram(text);
  if (program) {
    await db.from('leads').update({
      status: 'qualified', program_interest: program
    }).eq('id', lead.id);

    await sendProgramInfo(phone, program, lead.id, market);
  }

  return res.status(200).json({ status: 'new_lead', id: lead.id });
}

async function handleExistingLead(db, lead, text, res) {
  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

  const program = matchProgram(text);
  if (program) {
    await db.from('leads').update({
      status: 'qualified', program_interest: program
    }).eq('id', lead.id);

    await sendProgramInfo(lead.phone, program, lead.id, lead.market);
    return res.status(200).json({ status: 'qualified', program });
  }

  return res.status(200).json({ status: 'message_logged' });
}

async function sendProgramInfo(phone, program, leadId, market) {
  const programName = PROGRAM_NAMES[program] || program;
  const checkoutLink = CHECKOUT_LINKS[program];
  const intakeLink = `https://www.fitnessbymaddy.com/intake.html?lead=${leadId}`;

  if (isHinglish(market)) {
    await sendTemplate(phone, 'program_info_hi', [
      programName, checkoutLink || '', intakeLink
    ]);
  } else {
    await sendTemplate(phone, 'program_info_en', [
      programName, checkoutLink || '', intakeLink
    ]);
  }
}

function extractMessage(payload) {
  try {
    if (payload?.message?.text && payload?.sender?.phone) {
      return {
        phone: payload.sender.phone,
        text: payload.message.text,
        name: payload.sender.name || null
      };
    }
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (!msg?.text?.body) return null;
    const contact = change?.contacts?.[0];
    return {
      phone: msg.from,
      text: msg.text.body,
      name: contact?.profile?.name || null
    };
  } catch {
    return null;
  }
}
