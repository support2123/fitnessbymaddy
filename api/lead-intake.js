const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      experience_level, current_weight, target_weight,
      medical_conditions, supplements
    } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Name, email, and phone are required' });
    }

    const db = getSupabase();

    if (lead_id) {
      await db.from('leads').update({
        name,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead_id);
    }

    const intakeData = {
      lead_id: lead_id || null,
      name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      experience_level, current_weight, target_weight,
      medical_conditions, supplements,
      submitted_at: new Date().toISOString()
    };

    // Store intake in a jsonb field or create intake records
    // For now, update the lead with this information
    if (lead_id) {
      const { data: lead } = await db.from('leads').select('*').eq('id', lead_id).single();
      if (lead) {
        await db.from('leads').update({
          name,
          program_interest: lead.program_interest || mapGoalToProgram(goal)
        }).eq('id', lead_id);
      }
    } else {
      // Create a new lead from the form
      await db.from('leads').upsert({
        phone,
        name,
        source: 'intake_form',
        status: 'qualified',
        program_interest: mapGoalToProgram(goal),
        last_msg_at: new Date().toISOString()
      }, { onConflict: 'phone' });
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Submission failed' });
  }
};

function mapGoalToProgram(goal) {
  if (!goal) return 'zoom_trial';
  const g = goal.toLowerCase();
  if (g.includes('fat loss') || g.includes('weight loss') || g.includes('shred')) return '6wk_gym';
  if (g.includes('pcos') || g.includes('hormonal')) return 'pcos';
  if (g.includes('40+') || g.includes('menopause')) return '40plus';
  if (g.includes('custom') || g.includes('12 week') || g.includes('muscle')) return '12wk';
  return 'zoom_trial';
}
