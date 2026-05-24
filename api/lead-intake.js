const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      training_days,
      equipment_access,
      medical_conditions,
      current_weight,
      target_weight,
      height,
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

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead.id);
    }

    const intakeData = {
      age, gender, goal, injuries, diet_preference,
      training_days, equipment_access, medical_conditions,
      current_weight, target_weight, height, email,
    };

    const { error } = await supabase.from('leads').update({
      name: name || lead.name,
      program_interest: lead.program_interest || detectGoalToProgram(goal),
    }).eq('id', lead.id);

    if (error) {
      return res.status(500).json({ error: 'Failed to update lead' });
    }

    return res.status(200).json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectGoalToProgram(goal) {
  if (!goal) return null;
  const lower = goal.toLowerCase();
  if (lower.includes('fat') || lower.includes('weight')) return '6wk_gym';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('menopause')) return '40plus';
  if (lower.includes('custom') || lower.includes('muscle')) return '12wk';
  return '6wk_gym';
}
