const { supabase } = require('../lib/supabase');
const { maskPhone } = require('../lib/whatsapp');

const ALLOWED_ORIGIN = 'https://fitnessbymaddy.com';

const REQUIRED_FIELDS = ['lead_id', 'name', 'goal', 'phone'];

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
    const {
      lead_id,
      name,
      age,
      email,
      goal,
      injuries,
      diet_pref,
      schedule,
      experience,
      phone
    } = req.body || {};

    // Validate required fields
    const missing = REQUIRED_FIELDS.filter((f) => !req.body[f]);
    if (missing.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        fields: missing
      });
    }

    // Verify the lead exists
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('id, status, phone')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Build the intake metadata
    const intakeData = {
      age: age || null,
      email: email || null,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      experience: experience || null,
      submitted_at: new Date().toISOString()
    };

    // Update lead record with name and metadata
    const { error: updateErr } = await supabase
      .from('leads')
      .update({
        name,
        metadata: intakeData,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    if (updateErr) {
      console.error(`Failed to update lead ${lead_id} for ${maskPhone(phone)}:`, updateErr.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    // If lead has been converted, update client record with email
    if (lead.status === 'converted' && email) {
      const { error: clientErr } = await supabase
        .from('clients')
        .update({ email })
        .eq('lead_id', lead_id);

      if (clientErr) {
        // Non-fatal: log but don't fail the request
        console.error(
          `Failed to update client email for lead ${lead_id}:`,
          clientErr.message
        );
      }
    }

    console.log(`Intake form submitted for lead ${lead_id}, ${maskPhone(phone)}`);

    return res.status(200).json({
      status: 'ok',
      lead_id,
      message: 'Intake form submitted successfully'
    });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
