const { supabase } = require('../lib/supabase');
const { parseBody } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const {
      lead_id, name, email, phone, age, goal, injuries,
      diet_pref, schedule, experience, medical_conditions
    } = body;

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id is required' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    if (medical_conditions || injuries) {
      const { escalateToMaddy } = require('../lib/escalate');
      await escalateToMaddy(
        lead.phone,
        'Medical/injury info submitted in intake form',
        `Injuries: ${injuries || 'none'} | Medical: ${medical_conditions || 'none'}`,
        null
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Intake form received. We will reach out shortly!'
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
