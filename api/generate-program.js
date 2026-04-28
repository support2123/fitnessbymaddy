const { generateWeeklyProgram } = require('../lib/program-generator');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { getSupabase } = require('../lib/supabase');
const { maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: existing } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      return res.status(200).json({ ok: true, already_exists: true });
    }

    const result = await generateWeeklyProgram(client_id, week_no);

    if (result.flagged) {
      const { data: client } = await db
        .from('clients')
        .select('name, phone')
        .eq('id', client_id)
        .single();

      await notifyMaddy(
        'Program flagged for review',
        `Client: ${client?.name} (${maskPhone(client?.phone)})\nWeek: ${week_no}\nReason: Claude flagged this program for human review before sending.`
      );

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: result.data.workout_plan,
        nutrition_plan: result.data.nutrition_plan,
        notes: 'FLAGGED: ' + (result.data.coach_notes || 'Awaiting Maddy review'),
      });

      return res.status(200).json({ ok: true, flagged: true });
    }

    const { data: client } = await db
      .from('clients')
      .select('phone, name')
      .eq('id', client_id)
      .single();

    if (client) {
      await sendWhatsApp({
        phone: client.phone,
        body: `Hey ${client.name || ''}! 💪 Your Week ${week_no} program is ready.\n\n📄 ${result.pdfUrl}\n\nCheck it out and let us know if you have any questions!`,
      });

      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', week_no);
    }

    return res.status(200).json({ ok: true, pdf_url: result.pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
