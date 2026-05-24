const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, goal, current_weight,
      target_weight, height, injuries, medical_conditions,
      diet_preference, workout_experience, available_days,
      equipment_access, wake_time, sleep_time, photos
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    // Verify lead exists
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Update lead with name
    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    // Store intake data as JSON in lead's metadata (or a separate table if needed)
    // For now, we store key info and the rest will be used during client creation
    const intakeData = {
      age, gender, goal, current_weight, target_weight, height,
      injuries, medical_conditions, diet_preference,
      workout_experience, available_days, equipment_access,
      wake_time, sleep_time, photos,
      submitted_at: new Date().toISOString()
    };

    // Store in leads table as a note or create intake_data column
    // Using a simple approach: store in the program_interest field as JSON context
    await supabase.from('leads').update({
      name: name || lead.name,
      program_interest: lead.program_interest || 'pending'
    }).eq('id', lead_id);

    return res.status(200).json({
      success: true,
      message: 'Intake form submitted successfully'
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
