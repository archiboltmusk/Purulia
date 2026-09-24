/* ══════════════════════════════════════════════════════════
   PURULIA KASA — Auto-Escalation
   - Auto-tweet at 10 reports per ward
   - Weekly digest email to Municipality
   - Auto-tag MLA on X when report filed
   ══════════════════════════════════════════════════════════ */

const ESCALATION_THRESHOLD = 10;   /* Reports per ward to trigger auto-tweet */
const MLA_TWITTER_HANDLE = 'SudipKMukherjee';   /* Verify this handle */
const MUNICIPALITY_EMAIL = 'puruliamunicipality@gmail.com';
const DIGEST_ENDPOINT = window.KASA_CONFIG?.DIGEST_ENDPOINT || '';

/* ── Auto-tag MLA when a report is filed ── */
function buildTweetText(report, ward){
  const councillor = ward?.councillor_name || 'Ward Councillor';
  const lines = [
    `🗑️ New garbage report in Ward ${report.ward_no}, Purulia`,
    `Councillor: ${councillor}`,
    `Severity: ${report.severity}`,
    report.description ? `"${report.description.slice(0, 80)}"` : '',
    `Reported via @PuruliaKasa — puruliavision2040.vercel.app`
  ].filter(Boolean);
  return lines.join('\n');
}

function openTweetComposer(report, ward){
  const text = buildTweetText(report, ward);
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&via=${MLA_TWITTER_HANDLE}`;
  window.open(url, '_blank');
}

/* ── Cumulative pressure: check if a ward crossed threshold ── */
async function checkEscalation(wardNo){
  if (!sb) return;
  const { data, error } = await sb
    .from('reports')
    .select('id, auto_tweeted_at')
    .eq('ward_no', wardNo)
    .eq('status', 'open')
    .in('moderation_status', ['approved', 'pending'])
    .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());

  if (error || !data) return;

  const count = data.length;
  const alreadyTweeted = data.some(r => r.auto_tweeted_at);

  if (count >= ESCALATION_THRESHOLD && !alreadyTweeted){
    /* Mark all reports in this ward as auto-tweeted */
    await sb
      .from('reports')
      .update({ auto_tweeted_at: new Date().toISOString() })
      .eq('ward_no', wardNo)
      .eq('status', 'open');

    /* Trigger composer with cumulative message */
    const text = `🚨 Ward ${wardNo}, Purulia has ${count} open garbage reports this week.\n\nThe Municipality has not responded. Time to act.\n\n@${MLA_TWITTER_HANDLE} @PuruliaKasa`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
  }
}

/* ── Weekly digest builder ── */
async function buildWeeklyDigest(){
  const { data: reports } = await sb
    .from('reports')
    .select('*')
    .eq('status', 'open')
    .in('moderation_status', ['approved', 'pending'])
    .order('created_at', { ascending: false });

  if (!reports || !reports.length) return null;

  const byWard = {};
  reports.forEach(r => {
    if (!byWard[r.ward_no]) byWard[r.ward_no] = [];
    byWard[r.ward_no].push(r);
  });

  const lines = [
    'PURULIA KASA — WEEKLY DIGEST',
    `Generated: ${new Date().toLocaleString('en-IN')}`,
    `Total open reports: ${reports.length}`,
    `Wards affected: ${Object.keys(byWard).length}`,
    '',
    '═══════════════════════════════════'
  ];

  Object.entries(byWard)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([ward, items]) => {
      lines.push(`\nWard ${ward} — ${items.length} open report(s)`);
      items.slice(0, 5).forEach(r => {
        const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
        lines.push(`  • ${r.severity || 'minor'} · ${days}d ago · ${r.description || 'No description'}`);
        lines.push(`    Map: https://www.google.com/maps?q=${r.lat},${r.lng}`);
      });
      if (items.length > 5) {
        lines.push(`  ... and ${items.length - 5} more`);
      }
    });

  lines.push('\n═══════════════════════════════════');
  lines.push('\nPurulia Kasa — puruliavision2040.vercel.app');

  return lines.join('\n');
}

async function sendWeeklyDigest(){
  const digest = await buildWeeklyDigest();
  if (!digest) return;

  /* Option 1: mailto: (opens user's email client) */
  const mailto = `mailto:${MUNICIPALITY_EMAIL}?subject=${encodeURIComponent('Purulia Kasa — Weekly Digest')}&body=${encodeURIComponent(digest)}`;

  /* Option 2: POST to a serverless function (if DIGEST_ENDPOINT configured) */
  if (DIGEST_ENDPOINT){
    try {
      await fetch(DIGEST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: MUNICIPALITY_EMAIL, subject: 'Purulia Kasa — Weekly Digest', body: digest })
      });
      showToast('Weekly digest sent to Municipality');
      return;
    } catch(e){
      console.warn('Digest endpoint failed, falling back to mailto', e);
    }
  }

  window.location.href = mailto;
}

/* ── Auto-run weekly digest check on load ── */
async function checkWeeklyDigest(){
  const lastSent = localStorage.getItem('kasa_digest_sent');
  const now = Date.now();
  const weekMs = 7 * 86400000;

  if (!lastSent || (now - parseInt(lastSent)) > weekMs){
    /* Only prompt if there are unresolved reports */
    const { count } = await sb
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open');

    if (count && count > 0){
      /* Show a subtle prompt after 5 seconds */
      setTimeout(() => {
        if (confirm(`There are ${count} open reports this week. Send the weekly digest to Purulia Municipality?`)){
          sendWeeklyDigest();
          localStorage.setItem('kasa_digest_sent', String(now));
        }
      }, 5000);
    }
  }
}
