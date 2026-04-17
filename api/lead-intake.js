const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const {
      lead_id, name, email, phone, age, gender,
      goal, experience, injuries, diet_pref,
      schedule, medical_conditions, current_weight,
      target_weight, height
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const normalized = phone.startsWith('+') ? phone : `+${phone}`;
      const { data } = await db.from('leads').select('*').eq('phone', normalized).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead.id);
    }

    const intakeData = {
      age, gender, goal, experience, injuries,
      diet_pref, schedule, medical_conditions,
      current_weight, target_weight, height,
      email, submitted_at: new Date().toISOString()
    };

    await db.from('leads').update({
      name: name || lead.name,
      program_interest: lead.program_interest || mapGoalToProgram(goal)
    }).eq('id', lead.id);

    // Store intake data as a JSON field or in a separate intake entry
    // For now, store in the lead's first_msg as JSON supplement
    const existing = lead.first_msg || '';
    await db.from('leads').update({
      first_msg: existing + '\n---INTAKE---\n' + JSON.stringify(intakeData)
    }).eq('id', lead.id);

    return res.status(200).json({ ok: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapGoalToProgram(goal) {
  if (!goal) return null;
  const lower = goal.toLowerCase();
  if (lower.includes('fat') || lower.includes('weight') || lower.includes('shred')) return '6wk_gym';
  if (lower.includes('pcos') || lower.includes('hormonal')) return 'pcos';
  if (lower.includes('40') || lower.includes('menopause')) return '40plus';
  if (lower.includes('custom') || lower.includes('serious')) return '12wk';
  return '6wk_gym';
}
