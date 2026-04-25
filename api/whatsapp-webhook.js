const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendText, logMessage, canSend } = require('./_lib/whatsapp');
const { checkAndEscalate } = require('./_lib/escalation');
const {
  handleCors, cleanPhone, detectMarket, isHinglish,
  detectProgram, needsEscalation, isOptOut, maskPhone
} = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body || {};
    const phone = cleanPhone(payload.senderPhone || payload.from || payload.waId || '');
    const name = payload.senderName || payload.pushName || payload.name || null;
    const text = payload.text || payload.message || payload.body || '';
    const msgType = payload.type || 'text';

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    const db = getSupabase();

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`[WA] Opt-out from ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKw = needsEscalation(text);
    if (escalationKw) {
      await checkAndEscalate(phone, text, escalationKw);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, name, text, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      return await handleLeadQualification(db, existingLead, text, res);
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('[WA Webhook] Error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

async function handleNewLead(db, phone, name, text, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: text ? text.substring(0, 500) : null,
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  const hinglish = isHinglish(market);

  if (hinglish) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there'
    ], name);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there'
    ], name);
  }

  const detectedProgram = detectProgram(text);
  if (detectedProgram) {
    await db.from('leads')
      .update({ program_interest: detectedProgram, status: 'qualified' })
      .eq('id', lead.id);

    await sendProgramInfo(phone, detectedProgram, lead.id, hinglish);
    return res.status(200).json({ action: 'new_lead_qualified', program: detectedProgram });
  }

  return res.status(200).json({ action: 'new_lead', id: lead.id });
}

async function handleLeadQualification(db, lead, text, res) {
  const program = detectProgram(text);
  if (!program) {
    return res.status(200).json({ action: 'awaiting_qualification' });
  }

  await db.from('leads')
    .update({ program_interest: program, status: 'qualified' })
    .eq('id', lead.id);

  const hinglish = isHinglish(lead.market);
  await sendProgramInfo(lead.phone, program, lead.id, hinglish);

  return res.status(200).json({ action: 'qualified', program });
}

async function sendProgramInfo(phone, program, leadId, hinglish) {
  const siteBase = process.env.SITE_URL || 'https://www.fitnessbymaddy.com';

  const programInfo = {
    '6wk_gym': { name: '6-Week Burn & Build', price: '$45', checkoutSlug: '6wk-burn-build' },
    '6wk_home': { name: '6-Week Home Edition', price: '$45', checkoutSlug: '6wk-home' },
    'pcos': { name: 'PCOS Warrior', price: '$45', checkoutSlug: 'pcos-warrior' },
    '40plus': { name: '40+ Strong', price: '$50', checkoutSlug: '40plus-strong' },
    '12wk': { name: '12-Week Custom Flagship', price: '$200', checkoutSlug: '12wk-flagship' },
    'zoom_trial': { name: 'Zoom Trial Session', price: '$20', checkoutSlug: 'zoom-trial' }
  };

  const info = programInfo[program] || programInfo['zoom_trial'];
  const intakeUrl = `${siteBase}/intake?lead=${leadId}`;

  const allowed = await canSend(phone, false);
  if (!allowed) return;

  if (hinglish) {
    await sendText(phone,
      `Great choice! ${info.name} (${info.price}) perfect hai aapke liye.\n\n` +
      `Checkout: https://fitnessbymaddyy.exlyapp.com/checkout/${info.checkoutSlug}\n\n` +
      `Payment ke baad, ye form fill karo:\n${intakeUrl}\n\n` +
      `Koi bhi question ho toh pooch lo!`
    );
  } else {
    await sendText(phone,
      `Great choice! The ${info.name} (${info.price}) is perfect for your goals.\n\n` +
      `Checkout: https://fitnessbymaddyy.exlyapp.com/checkout/${info.checkoutSlug}\n\n` +
      `After payment, fill out your intake form:\n${intakeUrl}\n\n` +
      `Questions? Just reply here!`
    );
  }
}
