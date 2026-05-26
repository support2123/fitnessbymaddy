const { supabase } = require('./_lib/supabase');
const { notifyMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

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
      experience,
      medical_conditions,
    } = req.body || {};

    // Validate required fields
    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id is required' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }

    // Verify lead exists
    const { data: lead, error: fetchErr } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('id', lead_id)
      .single();

    if (fetchErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Update lead with intake data
    const { error: updateErr } = await supabase
      .from('leads')
      .update({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        age: age || null,
        goal: goal || null,
        injuries: injuries || null,
        diet_pref: diet_pref || null,
        schedule: schedule || null,
        experience: experience || null,
        medical_conditions: medical_conditions || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead_id);

    if (updateErr) {
      console.error('[lead-intake] Update error:', updateErr.message);
      return res.status(500).json({ error: 'Failed to save intake data' });
    }

    console.log(`[lead-intake] Intake completed for lead ${lead_id}, phone ${maskPhone(lead.phone)}`);

    // Escalate if medical conditions are present
    if (medical_conditions && medical_conditions.trim()) {
      await notifyMaddy(
        'Medical conditions reported on intake form',
        lead.phone,
        `Name: ${name}, Medical conditions: ${medical_conditions}`
      );
      console.log(`[lead-intake] Escalation triggered for lead ${lead_id} — medical conditions`);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[lead-intake] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
