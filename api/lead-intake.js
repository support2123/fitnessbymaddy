const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const supabase = getSupabase();
  const {
    lead_id, name, email, phone, age, gender,
    goal, injuries, diet_preference, schedule,
    current_weight, height, experience_level
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found' });

  await supabase
    .from('leads')
    .update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead_id);

  const intakeData = {
    age, gender, goal, injuries, diet_preference, schedule,
    current_weight, height, experience_level, email
  };

  const { error: metaErr } = await supabase
    .from('leads')
    .update({
      name: name || lead.name,
      program_interest: lead.program_interest || mapGoalToProgram(goal)
    })
    .eq('id', lead_id);

  if (metaErr) {
    return res.status(500).json({ error: 'Failed to save intake' });
  }

  return res.status(200).json({ success: true, lead_id });
};

function mapGoalToProgram(goal) {
  if (!goal) return null;
  const lower = goal.toLowerCase();
  if (lower.includes('fat') || lower.includes('weight')) return '6wk_gym';
  if (lower.includes('pcos') || lower.includes('hormonal')) return 'pcos';
  if (lower.includes('40') || lower.includes('menopause')) return '40plus';
  if (lower.includes('custom') || lower.includes('serious')) return '12wk';
  return '6wk_gym';
}
