const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, phone, goal, injuries,
      diet_pref, schedule, medical_conditions, current_weight,
      target_weight, experience_level
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const supabase = getSupabase();

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const updates = {};
    if (name) updates.name = name;
    if (goal) updates.program_interest = goal;

    await supabase.from('leads').update(updates).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      age: age ? parseInt(age) : null,
      phone: phone || lead.phone,
      goal,
      injuries,
      diet_pref,
      schedule,
      medical_conditions,
      current_weight,
      target_weight,
      experience_level,
      submitted_at: new Date().toISOString()
    };

    // Store intake data as a note on the lead (using first_msg field for extended data)
    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        first_msg: JSON.stringify(intakeData)
      })
      .eq('id', lead_id);

    // Check for escalation triggers in medical conditions
    const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
    const medText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medText)) {
      await escalateToMaddy(
        'Medical/injury flag on intake form',
        lead.phone,
        medText.substring(0, 300)
      );
    }

    return res.status(200).json({ ok: true, message: 'Intake submitted' });
  } catch (err) {
    console.error('[Intake Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
