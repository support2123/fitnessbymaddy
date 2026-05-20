const { supabase } = require('../lib/supabase');
const { generateProgram } = require('../lib/program-generator');
const { buildPDF, uploadPDF } = require('../lib/pdf');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-api-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const result = await generateProgram(client, checkins || []);

    if (result.flagged) {
      await escalateToMaddy(
        'Program flagged for safety review',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek ${week_no}\nFlag: ${result.reason}`
      );

      await supabase.from('programs').insert({
        client_id, week_no,
        workout_plan: result.raw?.workout || null,
        nutrition_plan: result.raw?.nutrition || null,
        notes: `FLAGGED: ${result.reason}. Awaiting Maddy review.`,
      });

      return res.json({ ok: false, flagged: true, reason: result.reason });
    }

    const pdfBuffer = await buildPDF(
      client, week_no,
      result.workout, result.nutrition, result.notes
    );

    const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id, week_no,
        pdf_url: pdfUrl,
        workout_plan: result.workout,
        nutrition_plan: result.nutrition,
        notes: result.notes,
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', String(week_no)],
    });

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.json({ ok: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};
