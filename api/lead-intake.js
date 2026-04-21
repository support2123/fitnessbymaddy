const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name,
      email,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      medical_conditions,
      current_weight,
      target_weight,
      experience_level,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id is required' });

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .maybeSingle();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await supabase
        .from('leads')
        .update({ name, last_msg_at: new Date().toISOString() })
        .eq('id', lead_id);
    }

    const intakeData = {
      age: parseInt(age) || null,
      gender,
      goal,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      current_weight: parseFloat(current_weight) || null,
      target_weight: parseFloat(target_weight) || null,
      experience_level: experience_level || null,
      email: email || null,
    };

    const { error: updateErr } = await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead_id);

    if (updateErr) {
      console.error('Lead update error:', updateErr.message);
    }

    // Store extended intake data as a checkin week 0 (baseline)
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .maybeSingle();

    if (existingClient) {
      await supabase.from('checkins').upsert({
        client_id: existingClient.id,
        week_no: 0,
        weight: intakeData.current_weight,
        compliance_score: null,
        energy: null,
        issues: JSON.stringify(intakeData),
        next_week_focus: intakeData.goal,
      }, { onConflict: 'client_id,week_no' });
    }

    return res.status(200).json({
      success: true,
      message: 'Intake form received',
    });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
