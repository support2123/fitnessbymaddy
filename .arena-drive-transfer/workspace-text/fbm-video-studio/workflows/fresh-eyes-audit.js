export const meta = {
  name: 'fresh-eyes-audit',
  description: 'Independent creative-director + compliance audit of a FINISHED reel from contact sheets + transcript (the builder is biased — these agents are not)',
  whenToUse: 'After final render + qc_sweep.sh. args = {video, sheets_dir, transcript, extra?}. Run BEFORE delivering to Maddy.',
  phases: [{ title: 'Audit' }],
}

const V = args?.video, SD = args?.sheets_dir, TR = args?.transcript || ''
if (!V || !SD) throw new Error('args.video and args.sheets_dir required')

phase('Audit')
const brief = (role) => `${role}

THE FILM: a DECODE-series designed-animation reel for FitnessByMaddy (2.1M, science-based, NASM-credible, anti-guru).
VIEW the timestamped contact sheets in ${SD} (Read tool, files sheet*.png; timestamps burned top-left).
Pull at least 3 full-res frames yourself for anything you want to judge properly:
  ffmpeg -y -ss <t> -i "${V}" -frames:v 1 /tmp/f.png   (then Read /tmp/f.png)

NARRATION WITH TIMINGS:
${TR}

${args?.extra || ''}
Be adversarial and specific — timestamps on every finding. Do not flatter. End with: SCORE /10 (5=average edited fitness reel, 7=strong branded content, 9=best-in-class science reel), your 3 highest-impact improvements, and a verdict line: SHIP AS IS / SHIP WITH TWEAKS / REBUILD.`

const out = await parallel([
  () => agent(brief(`You are a world-class short-form creative director (Cleo Abram / Johnny Harris tier). Audit: HOOK latency (does a motion payoff land in the first 3s?), visual craft (best/worst frames), clarity at every beat, pacing and dead stretches, retention-risk timestamps, CTA setup (does the viewer know exactly what to type, and does the comment ask visually dominate the funnel pill?), and anything broken/misaligned/illegible/amateur.`),
    { label: 'creative-director', phase: 'Audit', effort: 'high' }),
  () => agent(brief(`You are the brand + claims compliance auditor. Check every on-screen text in the sheets: forbidden vocabulary (Hindi/Sanskrit/spiritual/the word "AI"), pronouns, medical or guaranteed-result claims, citation presence on every stat, NASM credential presence, honest bounding of thin evidence, Instagram safe zones (nothing critical in the bottom ~330px or over the top-left username area), typos, and number consistency between narration and on-screen figures.`),
    { label: 'compliance', phase: 'Audit', effort: 'high' }),
])
return out.filter(Boolean)

