const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { generateProgramPDF } = require('./lib/pdf');
const { maskPhone } = require('./lib/helpers');

const BANNED_SUBSTANCES = [
  'steroid', 'anabolic', 'sarm', 'clenbuterol', 'dnp',
  'ephedra', 'hgh', 'testosterone injection', 'trenbolone',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const expectedSecret = process.env.INTERNAL_API_SECRET;
  if (expectedSecret) {
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token !== expectedSecret) return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  try {
    const { client_id, week_no } = req.body || {};
    if (!client_id || !week_no) return res.status(400).json({ error: 'client_id and week_no are required' });

    const weekNum = parseInt(week_no, 10);

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, phone, name, email, program, lead_id')
      .eq('id', client_id)
      .maybeSingle();

    if (clientErr || !client) return res.status(404).json({ error: 'Client not found' });

    let leadDetails = {};
    if (client.lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('lead_details')
        .eq('id', client.lead_id)
        .maybeSingle();
      leadDetails = lead?.lead_details || {};
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('week_no, weight, waist, compliance_score, energy, issues')
      .eq('client_id', client_id)
      .not('form_submitted_at', 'is', null)
      .order('week_no', { ascending: false })
      .limit(2);

    const clientProfile = {
      name: client.name,
      program: client.program,
      goal: leadDetails.goal || 'general fitness',
      age: leadDetails.age || 'unknown',
      gender: leadDetails.gender || 'unknown',
      injuries: leadDetails.injuries || 'none reported',
      diet_preference: leadDetails.diet_preference || 'no preference',
      medical_conditions: leadDetails.medical_conditions || 'none reported',
      schedule: leadDetails.schedule || '5 days',
      equipment: leadDetails.equipment || 'Full Gym',
    };

    const checkinSummary = (recentCheckins || []).map((c) => ({
      week: c.week_no, weight: c.weight, waist: c.waist,
      compliance: c.compliance_score, energy: c.energy, issues: c.issues,
    }));

    // Call Claude API via fetch
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: `You are a certified fitness and nutrition program architect for FitnessByMaddy.

RULES:
- Never recommend calorie targets below 1200 kcal/day
- Never recommend banned or illegal substances
- Account for reported injuries and medical conditions
- Be progressive: each week builds on the previous
- Consider compliance and energy scores from check-ins
- Provide specific sets, reps, and rest periods
- Include warm-up and cool-down

Respond with valid JSON ONLY.`,
        messages: [{
          role: 'user',
          content: `Generate week ${weekNum} program:

CLIENT: ${JSON.stringify(clientProfile, null, 2)}

RECENT CHECK-INS: ${checkinSummary.length > 0 ? JSON.stringify(checkinSummary, null, 2) : 'None (first week)'}

JSON structure:
{
  "workout_plan": {
    "title": "Week focus title",
    "days": [
      { "day": "Day 1 - Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": "4", "reps": "8-10", "notes": "2 min rest" }
      ]}
    ]
  },
  "nutrition_plan": {
    "title": "1800 cal High Protein",
    "calories": 1800,
    "meals": [
      { "meal": "Breakfast", "items": "Oats with banana and peanut butter", "calories": 400 }
    ]
  },
  "coach_notes": "Brief note about the week's focus"
}`,
        }],
      }),
    });

    if (!claudeRes.ok) {
      console.error(`Claude API error: ${claudeRes.status}`, await claudeRes.text());
      return res.status(502).json({ error: 'Claude API error' });
    }

    const claudeData = await claudeRes.json();
    const rawContent = claudeData.content?.[0]?.text || '';

    let programData;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error(`Program parse error [client ${client_id}]:`, parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const { workout_plan, nutrition_plan, coach_notes } = programData;

    // Safety: reject low calories
    if (nutrition_plan?.calories && nutrition_plan.calories < 1200) {
      const { notifyMaddy } = require('./lib/escalation');
      await notifyMaddy('Unsafe program generated', `Client ${maskPhone(client.phone)}: calories ${nutrition_plan.calories} < 1200`);
      return res.status(422).json({ error: 'Safety check failed: calories too low' });
    }

    // Safety: reject banned substances
    const fullText = JSON.stringify(programData).toLowerCase();
    const bannedFound = BANNED_SUBSTANCES.filter((s) => fullText.includes(s));
    if (bannedFound.length > 0) {
      const { notifyMaddy } = require('./lib/escalation');
      await notifyMaddy('Unsafe program generated', `Client ${maskPhone(client.phone)}: banned substances [${bannedFound.join(', ')}]`);
      return res.status(422).json({ error: 'Safety check failed: banned substances' });
    }

    // Generate branded HTML
    const html = generateProgramPDF(client.name || 'Client', weekNum, workout_plan, nutrition_plan);

    // Upload to Supabase Storage
    const filePath = `clients/${client_id}/week_${weekNum}.html`;
    await supabase.storage
      .from('client-files')
      .upload(filePath, Buffer.from(html, 'utf-8'), { contentType: 'text/html', upsert: true });

    const { data: urlData } = supabase.storage.from('client-files').getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || '';

    // Save to programs table
    await supabase.from('programs').upsert({
      client_id, week_no: weekNum,
      workout_plan, nutrition_plan,
      notes: coach_notes || null,
      pdf_url: pdfUrl,
      generated_at: new Date().toISOString(),
    }, { onConflict: 'client_id,week_no' });

    // Send via WhatsApp
    if (client.phone) {
      const sent = await sendWhatsApp(client.phone, 'program_delivery', {
        templateParams: [client.name || 'there', String(weekNum), pdfUrl],
      });
      if (sent.success) {
        await supabase.from('programs')
          .update({ whatsapp_sent_at: new Date().toISOString() })
          .eq('client_id', client_id).eq('week_no', weekNum);
      }
    }

    return res.status(200).json({ success: true, pdf_url: pdfUrl, week_no: weekNum, client_id });
  } catch (err) {
    console.error(`generate-program error [client ${req.body?.client_id}]:`, err.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
