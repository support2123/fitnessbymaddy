const { supabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    lead_id, name, email, age, gender, goal, injuries,
    medical_conditions, diet_preference, workout_schedule,
    equipment_access, current_fitness_level
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'lead_id is required' });

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const intakeText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
  if (needsEscalation(intakeText)) {
    await escalateToMaddy('Medical flag on intake form', {
      phone: lead.phone,
      details: `Injuries: ${injuries || 'none'}, Medical: ${medical_conditions || 'none'}`
    });
  }

  if (name) {
    await supabase.from('leads').update({ name }).eq('id', lead_id);
  }

  const { error } = await supabase.from('leads').update({
    name: name || lead.name,
    program_interest: lead.program_interest || goal
  }).eq('id', lead_id);

  if (error) {
    console.error('Intake save error:', error);
    return res.status(500).json({ error: 'Failed to save intake' });
  }

  return res.status(200).json({ ok: true, lead_id });
};
