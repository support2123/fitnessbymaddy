const { getSupabase } = require('./_utils/supabase');
const { detectMarket, isHinglish, maskPhone } = require('./_utils/market');
const { checkEscalation, checkOptOut } = require('./_utils/escalation');
const { qualifyLead } = require('./_utils/qualify');
const { sendTemplate, sendText, notifyMaddy } = require('./_utils/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.from || payload.senderMobile || '');
    const message = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (checkOptOut(message)) {
      await db.from('leads').update({ status: 'dropped', opted_out: true }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.json({ action: 'opted_out' });
    }

    const esc = checkEscalation(message);
    if (esc.escalate) {
      await db.from('escalations').insert({
        phone,
        reason: esc.reason,
        message_body: message
      });
      await notifyMaddy(esc.reason, `From: ${maskPhone(phone)}\nMsg: ${message.slice(0, 200)}`);
      return res.json({ action: 'escalated', reason: esc.reason });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (existingLead) {
      if (existingLead.opted_out) {
        return res.json({ action: 'opted_out_lead' });
      }

      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

      if (existingLead.status === 'new' || existingLead.status === 'dropped') {
        return await handleQualification(db, existingLead, message, res);
      }

      return res.json({ action: 'existing_lead', status: existingLead.status });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: senderName || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      market
    }).select().single();

    const hinglish = isHinglish(market);

    if (hinglish) {
      await sendTemplate(phone, 'welcome_v1', [
        senderName || 'there'
      ]);
    } else {
      await sendTemplate(phone, 'welcome_v1_en', [
        senderName || 'there'
      ]);
    }

    const qualification = qualifyLead(message);
    if (qualification.matched) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: qualification.program
      }).eq('id', newLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${qualification.checkout}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${newLead.id}`;

      if (hinglish) {
        await sendText(phone,
          `${qualification.label} perfect hai aapke liye!\n\n` +
          `Price: $${qualification.price}\n` +
          `Checkout: ${checkoutUrl}\n\n` +
          `Pehle ye form bhi fill kar do:\n${intakeUrl}`
        );
      } else {
        await sendText(phone,
          `${qualification.label} sounds perfect for you!\n\n` +
          `Price: $${qualification.price}\n` +
          `Checkout: ${checkoutUrl}\n\n` +
          `Please also fill out this quick form:\n${intakeUrl}`
        );
      }
    }

    return res.json({ action: 'new_lead', lead_id: newLead.id, qualified: qualification.matched });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleQualification(db, lead, message, res) {
  const qualification = qualifyLead(message);
  const hinglish = isHinglish(lead.market);

  if (!qualification.matched) {
    if (hinglish) {
      await sendText(lead.phone,
        'Koi baat nahi! Batao kaun sa goal hai:\n' +
        '1. Fat loss / shred\n' +
        '2. PCOS / hormonal\n' +
        '3. 40+ fitness\n' +
        '4. 12-week custom program\n' +
        '5. $20 trial pehle try karna hai'
      );
    } else {
      await sendText(lead.phone,
        'No worries! What\'s your main goal?\n' +
        '1. Fat loss / shred\n' +
        '2. PCOS / hormonal balance\n' +
        '3. 40+ fitness\n' +
        '4. 12-week custom program\n' +
        '5. $20 trial session first'
      );
    }
    return res.json({ action: 'asked_goal' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: qualification.program
  }).eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${qualification.checkout}`;
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  if (hinglish) {
    await sendText(lead.phone,
      `${qualification.label} — ye raha aapka plan!\n\n` +
      `Price: $${qualification.price}\n` +
      `Checkout: ${checkoutUrl}\n\n` +
      `Ye form bhi fill karo:\n${intakeUrl}`
    );
  } else {
    await sendText(lead.phone,
      `${qualification.label} — here's your plan!\n\n` +
      `Price: $${qualification.price}\n` +
      `Checkout: ${checkoutUrl}\n\n` +
      `Please fill this form too:\n${intakeUrl}`
    );
  }

  return res.json({ action: 'qualified', program: qualification.program });
}

function normalizePhone(phone) {
  let p = phone.replace(/[^0-9+]/g, '');
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}
