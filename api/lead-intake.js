const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_preference, training_experience,
      days_per_week, equipment_access, medical_conditions, photos
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      diet_preference, training_experience, days_per_week,
      equipment_access, medical_conditions
    };

    const { error } = await supabase.from('leads').update({
      name: name || lead.name,
      program_interest: mapGoalToProgram(goal) || lead.program_interest
    }).eq('id', lead_id);

    if (error) {
      console.error('Intake update error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    const hasEscalationFlag = checkIntakeEscalation({ injuries, medical_conditions });
    if (hasEscalationFlag) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy({
        reason: 'intake_medical_flag',
        phone: lead.phone,
        clientName: name || lead.name,
        message: `Injuries: ${injuries || 'None'}. Medical: ${medical_conditions || 'None'}`
      });
    }

    return res.json({ ok: true, lead_id });
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
  if (lower.includes('custom') || lower.includes('12')) return '12wk';
  return null;
}

function checkIntakeEscalation({ injuries, medical_conditions }) {
  const flags = ['surgery', 'pregnant', 'heart', 'diabetes', 'thyroid', 'hernia', 'slipped disc', 'fracture'];
  const combined = ((injuries || '') + ' ' + (medical_conditions || '')).toLowerCase();
  return flags.some(f => combined.includes(f));
}
