import supabase from '../lib/supabase.js';
import { detectMarket, isHinglish, maskPhone } from '../lib/market.js';
import { checkEscalation, isOptOut, detectProgram } from '../lib/escalation.js';
import { sendTemplate, sendText, notifyMaddy } from '../lib/whatsapp.js';

export default async function handler(req, res) {
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
    if (!message) return res.status(200).json({ ok: true });

    const { phone, text, name } = message;
    const market = detectMarket(phone);

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text?.slice(0, 2000),
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    const escalation = checkEscalation(text);
    if (escalation) {
      await notifyMaddy(
        'Lead needs human review',
        `Phone: ${maskPhone(phone)}\nTriggers: ${escalation.join(', ')}\nMessage: ${text?.slice(0, 300)}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await handleNewLead(phone, text, name, market);
    } else if (existingLead.status === 'new') {
      await handleQualification(existingLead, text, market);
    } else if (existingLead.status === 'dropped') {
      console.log(`Dropped lead messaged: ${maskPhone(phone)}`);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
}

function extractMessage(payload) {
  try {
    if (payload?.message) {
      return {
        phone: payload.message.from || payload.from,
        text: payload.message.text || payload.message.body,
        name: payload.message.sender_name || payload.sender?.name,
      };
    }
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (!msg) return null;
    const contact = change?.contacts?.[0];
    return {
      phone: msg.from,
      text: msg.text?.body || '',
      name: contact?.profile?.name,
    };
  } catch {
    return null;
  }
}

async function handleNewLead(phone, text, name, market) {
  await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text?.slice(0, 500),
    last_msg_at: new Date().toISOString(),
    market,
  });

  const hinglish = isHinglish(market);
  if (hinglish) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there',
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there',
    ]);
  }

  const program = detectProgram(text);
  if (program) {
    await handleQualificationMatch(phone, program, market);
  }
}

async function handleQualification(lead, text, market) {
  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const program = detectProgram(text);
  if (!program) return;

  await handleQualificationMatch(lead.phone, program, market);
  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: program.program,
    })
    .eq('id', lead.id);
}

async function handleQualificationMatch(phone, program, market) {
  const hinglish = isHinglish(market);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program.program}`;
  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('phone', phone)
    .single();
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead?.id || ''}`;

  const msg = hinglish
    ? `${program.name} — yeh program aapke liye perfect hai!\n\nCheckout: ${checkoutUrl}\n\nPehle yeh form fill karo: ${intakeUrl}`
    : `${program.name} — this program is perfect for you!\n\nCheckout: ${checkoutUrl}\n\nPlease fill out this form first: ${intakeUrl}`;

  await sendText(phone, msg);
}
