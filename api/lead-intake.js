const { supabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name,
      email,
      age,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      schedule,
      current_activity,
      phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      const leadPhone = phone || 'unknown';
      await escalateToMaddy(
        'Medical flag on intake form',
        leadPhone,
        `Injuries: ${injuries || 'none'}, Conditions: ${medical_conditions || 'none'}`
      );
    }

    let leadQuery = supabase.from('leads').select('*');
    if (lead_id) {
      leadQuery = leadQuery.eq('id', lead_id);
    } else {
      leadQuery = leadQuery.eq('phone', phone);
    }
    const { data: lead } = await leadQuery.single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    // Store intake data as metadata on the lead (using first_msg field for now)
    const intakeData = JSON.stringify({
      age,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      schedule,
      current_activity,
      email,
      submitted_at: new Date().toISOString(),
    });

    await supabase
      .from('leads')
      .update({ first_msg: intakeData })
      .eq('id', lead.id);

    return res.json({ ok: true, leadId: lead.id });
  } catch (err) {
    console.error('[LEAD-INTAKE ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
