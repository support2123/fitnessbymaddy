const Anthropic = require('@anthropic-ai/sdk');
const { getClient } = require('../lib/supabase');
const { sendText, notifyMaddy } = require('../lib/whatsapp');
const { generatePDF } = require('../lib/program-pdf');
const { maskPhone } = require('../lib/market');

var DANGEROUS_PATTERNS = [
  /under\s*\d{3,4}\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarms|steroids/i,
  /lose\s*\d+\s*kg\s*in\s*\d+\s*day/i,
  /extreme\s*(cut|deficit|fast)/i
];

function buildPrompt(client, intake, checkins, weekNo) {
  var lastCheckin = checkins[0];
  var prevCheckin = checkins[1];

  var lines = [
    'Generate a Week ' + weekNo + ' personalized fitness program for this client.',
    '',
    'CLIENT PROFILE:',
    '- Name: ' + client.name,
    '- Program: ' + client.program
  ];

  if (client.program_started_at) lines.push('- Started: ' + client.program_started_at);
  if (intake.age) lines.push('- Age: ' + intake.age);
  if (intake.goal) lines.push('- Goal: ' + intake.goal);
  if (intake.injuries) lines.push('- Injuries/Limitations: ' + intake.injuries);
  if (intake.diet_pref) lines.push('- Diet Preference: ' + intake.diet_pref);
  if (intake.experience) lines.push('- Experience Level: ' + intake.experience);
  if (intake.schedule) lines.push('- Schedule: ' + intake.schedule);
  if (intake.equipment) lines.push('- Equipment: ' + intake.equipment);

  if (lastCheckin) {
    lines.push('');
    lines.push('LATEST CHECK-IN (Week ' + lastCheckin.week_no + '):');
    lines.push('- Weight: ' + (lastCheckin.weight || 'N/A') + ' kg');
    lines.push('- Waist: ' + (lastCheckin.waist || 'N/A') + ' cm');
    lines.push('- Compliance: ' + (lastCheckin.compliance_score || 'N/A') + '/10');
    lines.push('- Energy: ' + (lastCheckin.energy || 'N/A') + '/10');
    lines.push('- Issues: ' + (lastCheckin.issues || 'None'));
    if (lastCheckin.next_week_focus) lines.push('- Focus area: ' + lastCheckin.next_week_focus);
  }

  if (prevCheckin) {
    lines.push('');
    lines.push('PREVIOUS CHECK-IN (Week ' + prevCheckin.week_no + '):');
    lines.push('- Weight: ' + (prevCheckin.weight || 'N/A') + ' kg');
    lines.push('- Waist: ' + (prevCheckin.waist || 'N/A') + ' cm');
    lines.push('- Compliance: ' + (prevCheckin.compliance_score || 'N/A') + '/10');
  }

  lines.push('');
  lines.push('Output JSON with this exact structure:');
  lines.push('{');
  lines.push('  "workout_plan": {');
  lines.push('    "days": [');
  lines.push('      { "day": "Monday", "focus": "Upper Body", "exercises": [');
  lines.push('        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }');
  lines.push('      ]}');
  lines.push('    ],');
  lines.push('    "cardio": { "type": "...", "frequency": "...", "duration": "..." }');
  lines.push('  },');
  lines.push('  "nutrition_plan": {');
  lines.push('    "calories": 2000,');
  lines.push('    "protein_g": 150,');
  lines.push('    "carbs_g": 200,');
  lines.push('    "fats_g": 70,');
  lines.push('    "meals": [');
  lines.push('      { "meal": "Breakfast", "options": ["...", "..."] }');
  lines.push('    ],');
  lines.push('    "supplements": ["...", "..."]');
  lines.push('  },');
  lines.push('  "notes": "Brief coach note to the client"');
  lines.push('}');

  return lines.join('\n');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var client_id = req.body.client_id;
    var week_no = req.body.week_no;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    var db = getClient();

    var clientResult = await db.from('clients').select('*, leads(*)').eq('id', client_id).single();
    if (!clientResult.data) return res.status(404).json({ error: 'Client not found' });
    var client = clientResult.data;

    // Get last 2 check-ins
    var checkinsResult = await db.from('checkins').select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);
    var checkins = checkinsResult.data || [];

    var intake = (client.leads && client.leads.intake_data) || {};
    var prompt = buildPrompt(client, intake, checkins, week_no);

    // Call Claude API
    var anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    var response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: 'You are an expert fitness program architect for FitnessByMaddy. Generate evidence-based, safe, personalized workout and nutrition plans. Output valid JSON only. Never recommend extreme calorie deficits (<1200 for women, <1500 for men), banned substances, or unrealistic timelines.',
      messages: [{ role: 'user', content: prompt }]
    });

    var content = response.content[0].text;

    // Safety check
    for (var i = 0; i < DANGEROUS_PATTERNS.length; i++) {
      if (DANGEROUS_PATTERNS[i].test(content)) {
        await notifyMaddy('Program Safety Flag',
          'Client: ' + client.name + ' (Week ' + week_no + ')\nFlagged pattern found. Manual review required.');
        return res.status(200).json({ ok: false, reason: 'safety_review_required' });
      }
    }

    // Parse JSON from response
    var programData;
    try {
      var jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        programData = JSON.parse(jsonMatch[1]);
      } else {
        var braceMatch = content.match(/\{[\s\S]*\}/);
        programData = JSON.parse(braceMatch ? braceMatch[0] : content);
      }
    } catch (parseErr) {
      console.error('Failed to parse program JSON for', maskPhone(client.phone));
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    // Generate branded PDF
    var pdfBuffer = await generatePDF(client, week_no, programData);

    // Upload to Supabase Storage
    var pdfPath = 'clients/' + client_id + '/week_' + week_no + '.pdf';
    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    var urlData = db.storage.from('client-files').getPublicUrl(pdfPath);
    var pdfUrl = urlData.data.publicUrl;

    // Save to programs table (audit trail)
    await db.from('programs').insert({
      client_id: client_id,
      week_no: week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan || programData.workouts || {},
      nutrition_plan: programData.nutrition_plan || programData.nutrition || {},
      notes: programData.notes || ''
    });

    // Send via WhatsApp
    var contextNote = checkins.length > 0
      ? 'Based on your Week ' + checkins[0].week_no + ' check-in \u2014 here\'s your updated plan \uD83D\uDCAA'
      : 'Here\'s your Week ' + week_no + ' program \u2014 let\'s get started! \uD83D\uDCAA';

    await sendText(client.phone, contextNote + '\n\n\uD83D\uDCCB Your program: ' + pdfUrl, true);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};
