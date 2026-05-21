const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender,
      goal, injuries, diet_preference,
      schedule, medical_conditions, photos,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads').select('*').eq('id', lead_id).single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status,
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      age: parseInt(age) || null,
      gender,
      goal,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      photos: photos || [],
      submitted_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        program_interest: lead.program_interest || mapGoalToProgram(goal),
      })
      .eq('id', lead_id);

    if (error) throw error;

    return res.json({ ok: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapGoalToProgram(goal) {
  if (!goal) return null;
  const lower = goal.toLowerCase();
  if (lower.includes('fat') || lower.includes('weight') || lower.includes('shred')) return '6wk_gym';
  if (lower.includes('pcos') || lower.includes('hormonal')) return 'pcos';
  if (lower.includes('40') || lower.includes('menopause')) return '40plus';
  if (lower.includes('custom') || lower.includes('12')) return '12wk';
  return '6wk_gym';
}
