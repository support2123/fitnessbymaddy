const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendMessage, logMessage, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, detectProgram, shouldEscalate, isOptOut, maskPhone, parseBody, handleCors, getLanguage, getProgramMeta } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const phone = body.phone || body.from || body.senderPhone || '';
  const message = body.message || body.text || body.body || '';
  const name = body.name || body.senderName || '';

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  const db = getSupabase();
  const market = detectMarket(phone);

  // Log incoming message
  await logMessage(phone, 'in', message, null);

  // Check opt-out
  if (isOptOut(message)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
    console.log(`Opt-out: ${maskPhone(phone)}`);
    return res.status(200).json({ action: 'opted_out' });
  }

  // Check escalation triggers
  const escalationTrigger = shouldEscalate(message);
  if (escalationTrigger) {
    await notifyMaddy(escalationTrigger, phone, message);
  }

  // Check if this is an existing lead or client
  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1);

  const { data: existingClient } = await db
    .from('clients')
    .select('*')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  // If active client, just log and acknowledge (they get support via escalation)
  if (existingClient && existingClient.length > 0) {
    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);
    return res.status(200).json({ action: 'client_message_logged' });
  }

  // Existing lead — try to qualify
  if (existingLead && existingLead.length > 0) {
    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_no_action' });
    }

    const program = detectProgram(message);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead.id);

      const meta = getProgramMeta(program);
      const lang = getLanguage(market);

      if (lang === 'hinglish') {
        await sendTemplate(phone, 'program_qualified_hi', [
          name || 'there',
          meta.name,
          `$${meta.price}`,
          `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`,
          `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`
        ]);
      } else {
        await sendTemplate(phone, 'program_qualified_en', [
          name || 'there',
          meta.name,
          `$${meta.price}`,
          `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`,
          `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`
        ]);
      }

      return res.status(200).json({ action: 'qualified', program });
    }

    // Update last message time
    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      first_msg: lead.first_msg || message
    }).eq('id', lead.id);

    return res.status(200).json({ action: 'existing_lead_updated' });
  }

  // New lead — insert and send welcome
  const { data: newLead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    market
  }).select().single();

  const lang = getLanguage(market);
  if (lang === 'hinglish') {
    await sendTemplate(phone, 'welcome_v1_hi', [
      name || 'there'
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there'
    ]);
  }

  console.log(`New lead: ${maskPhone(phone)} market=${market}`);
  return res.status(200).json({ action: 'new_lead_created', id: newLead?.id });
};
