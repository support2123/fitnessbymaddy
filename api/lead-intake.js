const { getSupabase } = require('../lib/supabase');
const { needsEscalation, maskPhone } = require('../lib/helpers');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions, diet_preference,
      workout_location, schedule, experience_level,
      current_weight, target_weight, height,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(', ');
    if (needsEscalation(medicalText)) {
      await sendWhatsApp(
        process.env.MADDY_PHONE || '+917082478374',
        'escalation_alert',
        ['medical_intake', maskPhone(lead.phone), medicalText.substring(0, 200)]
      );
    }

    const intakeData = {
      age, gender, goal, injuries, medical_conditions,
      diet_preference, workout_location, schedule,
      experience_level, current_weight, target_weight, height,
      email, submitted_at: new Date().toISOString(),
    };

    await db.from('leads').update({
      program_interest: lead.program_interest || mapGoalToProgram(goal, workout_location),
    }).eq('id', lead_id);

    return res.status(200).json({ ok: true, message: 'Intake submitted successfully' });

  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function mapGoalToProgram(goal, location) {
  if (!goal) return null;
  const lower = goal.toLowerCase();
  if (lower.includes('pcos') || lower.includes('hormonal')) return 'pcos';
  if (lower.includes('40') || lower.includes('menopause')) return '40plus';
  if (lower.includes('fat') || lower.includes('weight') || lower.includes('shred')) {
    return location === 'home' ? '6wk_home' : '6wk_gym';
  }
  if (lower.includes('custom') || lower.includes('serious')) return '12wk';
  return '6wk_gym';
}
