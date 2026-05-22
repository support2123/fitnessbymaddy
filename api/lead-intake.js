const { supabase } = require('../lib/supabase');
const { createEscalation } = require('../lib/escalation');

const INTAKE_FIELDS = [
  'age', 'gender', 'height_cm', 'current_weight', 'goal_weight',
  'primary_goal', 'injuries', 'medical_conditions', 'diet_preference',
  'meals_per_day', 'workout_days_per_week', 'equipment_access',
  'wake_time', 'sleep_time',
];

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
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
    const body = req.body || {};
    const leadId = body.lead_id || req.query.lead_id;

    if (!leadId) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    // Validate lead exists
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, phone, name')
      .eq('id', leadId)
      .maybeSingle();

    if (leadError || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Build the intake record from allowed fields
    const intake = { lead_id: leadId };

    for (const field of INTAKE_FIELDS) {
      if (body[field] !== undefined && body[field] !== null && body[field] !== '') {
        intake[field] = body[field];
      }
    }

    // Insert into intake_submissions
    const { data: submission, error: insertError } = await supabase
      .from('intake_submissions')
      .insert(intake)
      .select()
      .single();

    if (insertError) {
      console.error('[Intake] Insert failed:', insertError.message);
      return res.status(500).json({ error: 'Failed to save intake submission' });
    }

    console.log(`[Intake] Submission saved for lead ${leadId}`);

    // Update lead's last_msg_at
    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', leadId);

    // If medical conditions reported, create an escalation
    if (body.medical_conditions && body.medical_conditions.trim()) {
      await createEscalation({
        phone: lead.phone,
        clientId: null,
        reason: 'Medical conditions reported on intake form',
        messageBody: `Medical conditions: ${body.medical_conditions}`,
      });
      console.log(`[Intake] Escalation created for lead ${leadId} — medical conditions reported`);
    }

    return res.status(200).json({
      success: true,
      submission_id: submission.id,
      lead_id: leadId,
    });

  } catch (err) {
    console.error('[Intake] Unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
