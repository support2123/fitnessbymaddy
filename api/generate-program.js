const { supabase } = require('../lib/supabase');
const { sendMedia } = require('../lib/whatsapp');
const { generateProgramPdf } = require('../lib/pdf');
const { notifyMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/helpers');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'crash diet', 'very low calorie'
];

function checkProgramSafety(text) {
  const lower = (text || '').toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return { safe: false, flag };
  }
  return { safe: true, flag: null };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Fetch last 2 check-ins
    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Fetch intake data from messages
    const { data: intakeMessages } = await supabase
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .like('body', '%[INTAKE FORM]%')
      .limit(1);

    let intakeData = {};
    if (intakeMessages && intakeMessages[0]) {
      try {
        const jsonStr = intakeMessages[0].body.replace('[INTAKE FORM] ', '');
        intakeData = JSON.parse(jsonStr);
      } catch (_) {}
    }

    // Build Claude API prompt
    const systemPrompt = `You are a certified fitness coach and nutritionist creating a weekly program for a client.
Output ONLY valid JSON with this structure:
{
  "workout_plan": { "Day 1 - Chest & Triceps": [{"exercise": "...", "sets": 3, "reps": "10-12", "rest": "60s"}], ... },
  "nutrition_plan": { "calories": 2000, "protein": 150, "carbs": 200, "fat": 65, "meals": [{"meal": "Breakfast", "items": ["..."]}, ...] },
  "notes": "Brief coach notes for this week"
}
Design safe, progressive, evidence-based programs. Never recommend extreme calorie restriction (below 1200 for women, 1500 for men), banned substances, or unrealistic timelines.`;

    const userPrompt = `Create Week ${week_no} program for:
Client: ${client.name || 'Client'}
Program: ${client.program}
${intakeData.goal ? `Goal: ${intakeData.goal}` : ''}
${intakeData.experience ? `Experience: ${intakeData.experience}` : ''}
${intakeData.current_weight ? `Weight: ${intakeData.current_weight}` : ''}
${intakeData.injuries ? `Injuries/Limitations: ${intakeData.injuries}` : 'No injuries reported'}
${intakeData.diet_pref ? `Diet preference: ${intakeData.diet_pref}` : ''}
${intakeData.schedule ? `Schedule: ${intakeData.schedule}` : ''}

${recentCheckins && recentCheckins.length > 0 ? `Recent check-ins:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10${c.issues ? `, Issues: ${c.issues}` : ''}`).join('\n')}` : 'No previous check-ins yet (first week).'}

Design a progressive, well-structured week. If this is Week 1, start with foundation. If later weeks, progress based on check-in data.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      console.error('Claude API error:', errBody);
      return res.status(502).json({ error: 'AI generation failed' });
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content[0].text;

    // Safety check
    const safety = checkProgramSafety(responseText);
    if (!safety.safe) {
      await notifyMaddy(
        'Program Safety Flag',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nFlag: "${safety.flag}"\n\nPlease review the generated program before it's sent.`
      );
      return res.status(200).json({ ok: false, reason: 'safety_flagged', flag: safety.flag });
    }

    // Parse JSON from response
    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Failed to parse program JSON:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    const { workout_plan, nutrition_plan, notes } = programData;

    // Generate PDF
    const pdfBuffer = await generateProgramPdf(client, week_no, workout_plan, nutrition_plan, notes);

    // Upload to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }

    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData.publicUrl;

    // Store in programs table (audit trail)
    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan,
        nutrition_plan,
        notes
      })
      .select()
      .single();

    // Send via WhatsApp
    const caption = notes
      ? `Week ${week_no} Program - ${notes.substring(0, 100)}`
      : `Your Week ${week_no} program is ready! Let's crush it.`;

    await sendMedia(client.phone, pdfUrl, caption, true);

    // Update sent timestamp
    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
