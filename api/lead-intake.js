const { supabase } = require('./_lib/supabase');
const { checkAndEscalate } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/pii');

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async function handler(req, res) {
  corsHeaders(res);

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
      goal,
      injuries,
      diet_preference,
      schedule,
      medical_conditions,
    } = req.body || {};

    // Validate required fields
    const missing = [];
    if (!lead_id) missing.push('lead_id');
    if (!name) missing.push('name');
    if (!age) missing.push('age');
    if (!goal) missing.push('goal');

    if (missing.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        fields: missing,
      });
    }

    // Verify the lead exists
    const { data: lead, error: lookupErr } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('id', lead_id)
      .single();

    if (lookupErr || !lead) {
      console.warn(`[intake] Lead not found: ${lead_id}`);
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Update lead record with name
    const { error: updateErr } = await supabase
      .from('leads')
      .update({ name })
      .eq('id', lead_id);

    if (updateErr) {
      console.error(`[intake] Failed to update lead ${lead_id}:`, updateErr.message);
      return res.status(500).json({ error: 'Failed to update lead' });
    }

    console.log(`[intake] Lead ${maskPhone(lead.phone)} updated — name="${name}", age=${age}, goal="${goal}"`);

    // Check medical conditions for escalation
    if (medical_conditions && medical_conditions.trim().length > 0) {
      const esc = await checkAndEscalate(lead.phone, medical_conditions, {
        source: 'intake_form',
        lead_id,
      });
      if (esc.escalated) {
        console.warn(`[intake] Medical escalation for lead ${lead_id}: ${esc.keywords.join(', ')}`);
      }
      // Even if checkAndEscalate doesn't trigger, filled medical_conditions
      // should be flagged for coach review
      console.warn(`[intake] Medical conditions noted for lead ${lead_id}: "${medical_conditions.slice(0, 100)}"`);
    }

    return res.status(200).json({
      success: true,
      message: 'Intake form submitted successfully. Our coach will review your details shortly!',
    });
  } catch (err) {
    console.error('[intake] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
