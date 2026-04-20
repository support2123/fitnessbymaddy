import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await supabase
        .from('leads')
        .update({ name })
        .eq('id', lead_id);
    }

    const intakeData = {
      age: age || null,
      gender: gender || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      current_weight: current_weight || null,
      target_weight: target_weight || null,
      experience_level: experience_level || null,
      email: email || null,
      submitted_at: new Date().toISOString(),
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await supabase
        .from('clients')
        .update({ name, email, intake: intakeData })
        .eq('id', existingClient.id);
    }

    return res.status(200).json({ status: 'intake_saved', lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
