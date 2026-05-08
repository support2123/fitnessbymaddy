const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText, canSendMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, detectProgram, needsEscalation, isOptOut, programLabel, parseBody, corsHeaders } = require('../lib/helpers');
const { escalateLeadIssue } = require('../lib/escalate');

const SITE = 'https://www.fitnessbymaddy.com';
const EXLY = 'https://fitnessbymaddyy.exlyapp.com/checkout';

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const phone = body.phone || body.from || body.senderPhone || '';
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text
    });

    if (isOptOut(text)) {
      await supabase.from('leads').upsert({ phone, status: 'dropped', last_msg_at: new Date().toISOString() }, { onConflict: 'phone' });
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateLeadIssue(phone, text);
    }

    const { data: existingClient } = await supabase
      .from('clients').select('id, status').eq('phone', phone).single();

    if (existingClient && existingClient.status === 'active') {
      return res.status(200).json({ action: 'active_client_message_logged' });
    }

    const { data: existingLead } = await supabase
      .from('leads').select('*').eq('phone', phone).single();

    const market = detectMarket(phone);
    const isHinglish = market === 'IN';

    if (!existingLead) {
      await supabase.from('leads').insert({
        phone, name, source: 'whatsapp', status: 'new',
        first_msg: text, last_msg_at: new Date().toISOString(), market
      });

      const welcome = isHinglish
        ? 'Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Maddy\'s team here. What\'s your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial first?';

      await sendTemplate(phone, 'welcome_v1', [name || 'there']);

      return res.status(200).json({ action: 'new_lead_created' });
    }

    await supabase.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: name || existingLead.name
    }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_no_action' });
    }

    const program = detectProgram(text);
    if (program) {
      await supabase.from('leads').update({
        status: 'qualified', program_interest: program
      }).eq('phone', phone);

      const label = programLabel(program);
      const checkoutMsg = isHinglish
        ? `Great choice! ${label} ke liye checkout yahan se karo:\n${EXLY}/${existingLead.id}\n\nIntake form bhi fill karo:\n${SITE}/intake.html?lead=${existingLead.id}`
        : `Great choice! Here's your checkout link for ${label}:\n${EXLY}/${existingLead.id}\n\nPlease also fill out your intake form:\n${SITE}/intake.html?lead=${existingLead.id}`;

      if (await canSendMessage(phone, false)) {
        await sendText(phone, checkoutMsg);
      }

      return res.status(200).json({ action: 'lead_qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
