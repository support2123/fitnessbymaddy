const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      diet_pref, schedule, medical_conditions, current_activity
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
      status: 'qualified'
    }).eq('id', lead_id);

    const { error: clientErr } = await db.from('clients').insert({
      lead_id,
      phone: lead.phone,
      name: name || lead.name,
      email,
      program: lead.program_interest || '6wk_gym',
      status: 'active',
      intake_data: {
        age, gender, goal, injuries, diet_pref,
        schedule, medical_conditions, current_activity
      }
    });

    if (clientErr && clientErr.code !== '23505') {
      throw clientErr;
    }

    if (injuries || medical_conditions) {
      const { notifyMaddy } = require('./lib/whatsapp');
      await notifyMaddy(
        'New intake - medical flag',
        `${name} reported: ${injuries || ''} ${medical_conditions || ''}`
      );
    }

    await sendWhatsApp(lead.phone, 'intake_received', {
      name: name || 'there',
      templateParams: [name || 'there']
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
