import supabase from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      workout_days, workout_location, wake_time, sleep_time,
      supplements, motivation, photos,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await supabase.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status,
    }).eq('id', lead.id);

    const { data: intakeData, error } = await supabase.from('intake_forms').insert({
      lead_id: lead.id,
      name,
      email,
      phone: phone || lead.phone,
      age: parseInt(age) || null,
      gender,
      height,
      weight: parseFloat(weight) || null,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_days: parseInt(workout_days) || null,
      workout_location,
      wake_time,
      sleep_time,
      supplements,
      motivation,
      photos: photos || [],
      submitted_at: new Date().toISOString(),
    }).select().single();

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake form' });
    }

    return res.status(200).json({ ok: true, intake_id: intakeData.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
