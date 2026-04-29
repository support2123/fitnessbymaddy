const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_preference, training_days, equipment,
      medical_conditions, schedule_preference
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name, email, phone: phone || lead.phone,
      age: parseInt(age) || null,
      gender, height, weight: parseFloat(weight) || null,
      goal, injuries, diet_preference, training_days,
      equipment, medical_conditions, schedule_preference,
      submitted_at: new Date().toISOString()
    };

    const { error } = await db.from('leads').update({
      name: name || lead.name,
      program_interest: mapGoalToProgram(goal) || lead.program_interest,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    if (error) {
      console.error('Intake save error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ ok: true, message: 'Intake submitted successfully' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function mapGoalToProgram(goal) {
  if (!goal) return null;
  const lower = goal.toLowerCase();
  if (lower.includes('fat') || lower.includes('weight loss')) return '6wk_gym';
  if (lower.includes('pcos') || lower.includes('hormonal')) return 'pcos';
  if (lower.includes('40') || lower.includes('menopause')) return '40plus';
  if (lower.includes('muscle') || lower.includes('strength') || lower.includes('custom')) return '12wk';
  return null;
}
