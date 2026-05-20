const { getSupabase } = require('../lib/supabase');
const { cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, goal,
      injuries, diet_pref, schedule, experience,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

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

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await db.from('clients').update({
        name, email, age: parseInt(age) || null,
        goal, injuries, diet_pref, schedule,
      }).eq('id', existingClient.id);
    }

    const hasEscalation = checkIntakeEscalation(injuries, goal);
    if (hasEscalation) {
      await db.from('escalations').insert({
        phone: phone || lead.phone,
        reason: 'intake_medical_flag',
        context: `Injuries: ${injuries || 'none'} | Goal: ${goal || 'none'}`,
      });
    }

    return res.json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function checkIntakeEscalation(injuries, goal) {
  const text = `${injuries || ''} ${goal || ''}`.toLowerCase();
  const flags = ['surgery', 'pregnant', 'heart', 'diabetes', 'medication', 'disc', 'hernia', 'fracture'];
  return flags.some(f => text.includes(f));
}
