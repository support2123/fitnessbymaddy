const { getSupabase } = require('./_lib/supabase');
const { normalizePhone } = require('./_lib/phone');
const { checkEscalation } = require('./_lib/escalation');
const { notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/phone');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions, diet_pref,
      schedule, equipment, experience_level, current_weight,
      target_weight, height
    } = req.body;

    if (!phone && !lead_id) {
      return res.status(400).json({ error: 'Phone or lead_id required' });
    }

    const supabase = getSupabase();
    const normalizedPhone = phone ? normalizePhone(phone) : null;

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    const esc = checkEscalation(medicalText);
    if (esc.escalate) {
      await notifyMaddy(
        'Intake form: medical flag',
        `Lead: ${maskPhone(normalizedPhone || 'unknown')}\nTriggers: ${esc.triggers.join(', ')}\nDetails: ${medicalText.slice(0, 300)}`
      );
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else if (normalizedPhone) {
      const { data } = await supabase.from('leads').select('*').eq('phone', normalizedPhone).single();
      lead = data;
    }

    if (lead) {
      await supabase
        .from('leads')
        .update({
          name: name || lead.name,
          last_msg_at: new Date().toISOString()
        })
        .eq('id', lead.id);
    } else {
      const { data } = await supabase
        .from('leads')
        .insert({
          phone: normalizedPhone,
          name,
          source: 'intake_form',
          status: 'new',
          first_msg: `Intake form: ${goal}`,
          market: normalizedPhone ? require('./_lib/phone').detectMarket(normalizedPhone) : 'GLOBAL'
        })
        .select()
        .single();
      lead = data;
    }

    const clientProfile = {
      lead_id: lead.id,
      name, email, age, gender, goal, injuries,
      medical_conditions, diet_pref, schedule, equipment,
      experience_level, current_weight, target_weight, height
    };

    const { error: metaError } = await supabase
      .from('leads')
      .update({
        program_interest: mapGoalToProgram(goal),
        name: name || lead.name
      })
      .eq('id', lead.id);

    if (metaError) {
      console.error('Update error:', metaError.message);
    }

    return res.status(200).json({
      success: true,
      lead_id: lead.id,
      message: 'Intake form received. We\'ll be in touch shortly!'
    });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapGoalToProgram(goal) {
  if (!goal) return null;
  const g = goal.toLowerCase();
  if (g.includes('fat loss') || g.includes('shred') || g.includes('weight loss')) return '6wk_gym';
  if (g.includes('pcos') || g.includes('hormonal')) return 'pcos';
  if (g.includes('40+') || g.includes('menopause')) return '40plus';
  if (g.includes('custom') || g.includes('12 week') || g.includes('muscle')) return '12wk';
  return null;
}
