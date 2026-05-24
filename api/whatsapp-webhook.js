const { supabase } = require('../lib/supabase');
const { sendTemplate, logMessage, maskPhone, detectMarket } = require('../lib/whatsapp');
const { parseKeywords, needsEscalation, getProgramDetails } = require('../lib/utils');
const { notifyMaddy } = require('../lib/escalation');

const ALLOWED_ORIGIN = 'https://fitnessbymaddy.com';

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe'];

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return OPT_OUT_KEYWORDS.includes(lower);
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, message, name, timestamp } = req.body || {};

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Log incoming message
    await logMessage(phone, 'in', message, null);

    // Check for opt-out
    if (isOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);

      console.log(`Opt-out processed for ${maskPhone(phone)}`);
      return res.status(200).json({ status: 'opted_out' });
    }

    // Check for escalation keywords
    if (needsEscalation(message)) {
      // Look up lead for context
      const { data: lead } = await supabase
        .from('leads')
        .select('id, name')
        .eq('phone', phone)
        .single();

      const leadName = (lead && lead.name) || name || 'Unknown';
      await notifyMaddy(
        'Escalation keyword detected',
        `From: ${leadName} (${maskPhone(phone)})\nMessage: ${message}`
      );
    }

    // Look up the lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    // --- FLOW: Lead not found → create new lead (Flow A) ---
    if (!existingLead) {
      const market = detectMarket(phone);

      const { data: newLead, error: insertError } = await supabase
        .from('leads')
        .insert({
          phone,
          name: name || null,
          status: 'new',
          source: 'whatsapp',
          market,
          last_msg_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertError) {
        console.error(`Failed to create lead for ${maskPhone(phone)}:`, insertError.message);
        return res.status(500).json({ error: 'Internal server error' });
      }

      // Send welcome template with appropriate language
      const lang = market === 'IN' ? 'hi' : 'en';
      await sendTemplate(phone, 'welcome_v1', [newLead.name || 'there', lang]);

      console.log(`New lead created for ${maskPhone(phone)}, market: ${market}`);
      return res.status(200).json({ status: 'new_lead', lead_id: newLead.id });
    }

    // --- FLOW: Lead exists but status is 'dropped' → ignore ---
    if (existingLead.status === 'dropped') {
      console.log(`Ignoring message from dropped lead ${maskPhone(phone)}`);
      return res.status(200).json({ status: 'ignored' });
    }

    // Update last_msg_at for all active leads
    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    // --- FLOW: Lead exists with status='new' → qualify (Flow B) ---
    if (existingLead.status === 'new') {
      const programKey = parseKeywords(message);

      if (programKey) {
        const program = getProgramDetails(programKey);

        await supabase
          .from('leads')
          .update({
            program_interest: programKey,
            status: 'qualified',
            last_msg_at: new Date().toISOString()
          })
          .eq('id', existingLead.id);

        // Send checkout link + intake form link
        const checkoutUrl = `https://fitnessbymaddy.com${program.checkoutPath}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;
        await sendTemplate(phone, 'checkout_link', [
          existingLead.name || 'there',
          program.name,
          checkoutUrl,
          intakeUrl
        ]);

        console.log(`Lead ${maskPhone(phone)} qualified for ${programKey}`);
        return res.status(200).json({ status: 'qualified', program: programKey });
      }

      // No program match → send clarification
      await sendTemplate(phone, 'clarify_interest', [existingLead.name || 'there']);

      console.log(`Clarification sent to ${maskPhone(phone)}`);
      return res.status(200).json({ status: 'clarification_sent' });
    }

    // --- FLOW: Lead exists with status='qualified' → remind of checkout ---
    if (existingLead.status === 'qualified') {
      const programKey = existingLead.program_interest;
      const program = getProgramDetails(programKey);

      if (program) {
        const checkoutUrl = `https://fitnessbymaddy.com${program.checkoutPath}`;
        await sendTemplate(phone, 'checkout_reminder', [
          existingLead.name || 'there',
          program.name,
          checkoutUrl
        ]);
      }

      console.log(`Checkout reminder sent to ${maskPhone(phone)}`);
      return res.status(200).json({ status: 'reminder_sent' });
    }

    // Any other status (e.g. 'converted') — acknowledge
    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
