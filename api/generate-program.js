const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendDocument } = require('../lib/whatsapp');
const { generateProgramPDF } = require('../lib/pdf');
const { buildProgramPrompt, checkSafety } = require('../lib/program-prompt');
const { escalate } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: existing } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const prompt = buildProgramPrompt(client, checkins || [], parseInt(week_no));

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawOutput = response.content[0].text;
    let programData;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : rawOutput);
    } catch {
      await escalate(client.phone, 'program_parse_error', rawOutput.slice(0, 500));
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const safety = checkSafety(programData);
    if (!safety.safe) {
      await escalate(client.phone, `safety_flag: ${safety.reason}`, JSON.stringify(programData).slice(0, 500));
      return res.status(422).json({ error: 'Program flagged for review', reason: safety.reason });
    }

    const pdfBuffer = await generateProgramPDF(
      client,
      parseInt(week_no),
      programData.workout,
      programData.nutrition,
      programData.notes
    );

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || '';

    const { error: insertError } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: programData.workout,
      nutrition_plan: programData.nutrition,
      notes: programData.notes,
    });

    if (insertError) throw insertError;

    const caption = `Week ${week_no} program is ready! 💪 Check it out and let me know if you have any questions.`;
    await sendDocument(client.phone, pdfUrl, caption);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', parseInt(week_no));

    return res.json({ ok: true, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
