// api/lead-intake.js — Intake form submission handler

const { supabase } = require('./_lib/supabase');
const { sendText } = require('./_lib/whatsapp');
const { checkEscalation, notifyMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/utils');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://fitnessbymaddy.com',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    return res.end();
  }

  res.setHeader('Content-Type', 'application/json');
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id,
      name,
      email,
      age,
      goal,
      injuries,
      diet_pref,
      schedule,
      medical_conditions,
    } = req.body || {};

    // ── Validate required fields ────────────────────────────────────
    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id is required' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }

    // ── Verify lead exists ──────────────────────────────────────────
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const masked = maskPhone(lead.phone);
    console.log(`[intake] Processing intake for lead ${lead.id} (${masked})`);

    // ── Update lead name ────────────────────────────────────────────
    await supabase
      .from('leads')
      .update({
        name: name.trim(),
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead_id);

    // ── Store intake data as a message record ───────────────────────
    const intakeData = {
      name: name.trim(),
      email: email.trim(),
      age: age || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      submitted_at: new Date().toISOString(),
    };

    await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: JSON.stringify(intakeData),
      template_name: 'intake_form',
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    // ── Medical conditions escalation check ─────────────────────────
    const conditionsText = [
      medical_conditions || '',
      injuries || '',
    ].join(' ');

    const escalation = checkEscalation(conditionsText);
    if (escalation.shouldEscalate) {
      console.log(`[intake] Medical escalation for ${masked}: ${escalation.reason}`);

      await notifyMaddy(
        `Intake form medical flag: ${escalation.reason}`,
        {
          phone: lead.phone,
          messageBody: `Medical conditions: ${medical_conditions || 'N/A'}, Injuries: ${injuries || 'N/A'}`,
        }
      );
    }

    // ── Send confirmation WhatsApp ──────────────────────────────────
    await sendText(
      lead.phone,
      `Thanks ${name.trim()}! We've got your details. You'll receive your program within 24 hours of payment.`
    );

    console.log(`[intake] Intake processed for lead ${lead.id}`);

    return res.status(200).json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('[intake] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
