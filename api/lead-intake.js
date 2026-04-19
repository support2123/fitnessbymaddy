import supabase from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, goal, injuries,
      diet_pref, schedule, experience, instagram,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
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
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead_id);

    const intakeData = { age, goal, injuries, diet_pref, schedule, experience, instagram, email };
    const { error } = await supabase
      .from('leads')
      .update({ first_msg: JSON.stringify(intakeData) })
      .eq('id', lead_id);

    if (error) {
      console.error('Intake save error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ success: true, message: 'Intake form saved' });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
