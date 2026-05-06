const { getSupabase } = require('./_lib/supabase');
const { corsHeaders } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body || {};
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      goal,
      injuries,
      diet_pref,
      schedule,
      current_weight,
      height,
      training_experience,
    } = body;

    if (!lead_id) return res.status(400).json({ error: 'missing lead_id' });

    const supabase = getSupabase();

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'lead not found' });

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeData = {
      name: name || lead.name,
      email,
      phone: phone || lead.phone,
      age: age ? parseInt(age) : null,
      goal,
      injuries,
      diet_pref,
      schedule,
    };

    await supabase
      .from('leads')
      .update({
        name: intakeData.name,
        program_interest: lead.program_interest || detectGoalProgram(goal),
      })
      .eq('id', lead_id);

    return res.status(200).json({
      success: true,
      message: 'Intake form received! We\'ll be in touch shortly.',
      lead_id,
    });
  } catch (err) {
    console.error('[INTAKE ERROR]', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
};

function detectGoalProgram(goal) {
  if (!goal) return null;
  const g = goal.toLowerCase();
  if (g.includes('fat') || g.includes('weight') || g.includes('slim')) return '6wk_gym';
  if (g.includes('pcos')) return 'pcos';
  if (g.includes('40') || g.includes('menopause')) return '40plus';
  if (g.includes('muscle') || g.includes('strength') || g.includes('custom')) return '12wk';
  return '6wk_gym';
}
