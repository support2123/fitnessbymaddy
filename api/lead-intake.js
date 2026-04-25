const db = require('./_lib/supabase');
const { cors } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, goal,
      injuries, diet_pref, schedule, experience,
      instagram, message: userMessage,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead = null;
    if (lead_id) {
      const leads = await db.query('leads', `id=eq.${lead_id}&select=*`);
      lead = leads[0];
    } else if (phone) {
      const leads = await db.query('leads', `phone=eq.${phone}&select=*`);
      lead = leads[0];
    }

    if (!lead) {
      lead = (await db.insert('leads', {
        phone: phone || 'unknown',
        name,
        source: 'intake_form',
        status: 'new',
        first_msg: goal || userMessage || '',
      }))[0];
    }

    if (name) {
      await db.update('leads', { id: lead.id }, { name });
    }

    const existing = await db.query('clients', `lead_id=eq.${lead.id}&select=id`);

    if (existing.length > 0) {
      await db.update('clients', { id: existing[0].id }, {
        name: name || undefined,
        email: email || undefined,
        age: age ? parseInt(age) : undefined,
        goal: goal || undefined,
        injuries: injuries || undefined,
        diet_pref: diet_pref || undefined,
        schedule: schedule || undefined,
      });
      return res.status(200).json({ ok: true, client_id: existing[0].id, updated: true });
    }

    const client = (await db.insert('clients', {
      lead_id: lead.id,
      phone: lead.phone,
      name: name || lead.name,
      email,
      age: age ? parseInt(age) : null,
      goal,
      injuries,
      diet_pref,
      schedule,
      status: 'active',
    }))[0];

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
