import { getSupabase } from './_lib/supabase.js';
import { handleCors, parseBody } from './_lib/utils.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const data = parseBody(req);

  const leadId = data.lead_id;
  if (!leadId) return res.status(400).json({ error: 'Missing lead_id' });

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  await db.from('leads').update({
    name: data.name || lead.name,
    program_interest: data.goal || lead.program_interest
  }).eq('id', leadId);

  const intakeData = {
    age: data.age,
    gender: data.gender,
    height: data.height,
    current_weight: data.current_weight,
    goal_weight: data.goal_weight,
    goal: data.goal,
    injuries: data.injuries,
    medical_conditions: data.medical_conditions,
    diet_preference: data.diet_preference,
    workout_schedule: data.workout_schedule,
    experience_level: data.experience_level,
    equipment_access: data.equipment_access
  };

  const { error } = await db.from('leads').update({
    first_msg: JSON.stringify(intakeData)
  }).eq('id', leadId);

  if (error) return res.status(500).json({ error: 'Failed to save intake' });

  return res.json({ ok: true, message: 'Intake saved' });
}
