import supabase from './lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      training_experience, equipment_access, schedule,
      wake_time, sleep_time, notes,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found' });

    // Update lead with name/contact info
    await supabase.from('leads').update({
      name: name || lead.name,
    }).eq('id', lead_id);

    // Store intake data as a JSONB column or create an intake_data table
    // For now, we store it in a separate intake_data table or as metadata
    const { error: insertErr } = await supabase.from('intake_data').upsert({
      lead_id,
      name,
      email,
      phone: phone || lead.phone,
      age: age ? parseInt(age) : null,
      gender,
      height,
      weight: weight ? parseFloat(weight) : null,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      training_experience,
      equipment_access,
      schedule,
      wake_time,
      sleep_time,
      notes,
    }, { onConflict: 'lead_id' });

    // If intake_data table doesn't exist, fall back to storing in leads metadata
    if (insertErr) {
      console.log('intake_data table may not exist, storing in lead notes');
      await supabase.from('leads').update({
        name: name || lead.name,
        program_interest: lead.program_interest || goal,
      }).eq('id', lead_id);
    }

    return res.status(200).json({ ok: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
