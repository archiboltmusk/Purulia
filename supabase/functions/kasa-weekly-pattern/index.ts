// Supabase Edge Function: SQL-based weekly pattern digest
//
// Every Monday 6am, analyze last week's reports for patterns and clusters.
// No ML needed — pure SQL finds what matters for moderators and officials.
//
// Deploy:  supabase functions deploy kasa-weekly-pattern
// Secrets: RESEND_API_KEY      (required; shared with other alerts)
//          PATTERN_DIGEST_TO    (optional; email recipients, comma-sep)
//          PATTERN_DIGEST_FROM  (optional; default "Parishkar Bengal <onboarding@resend.dev>")
//          SITE_URL             (optional; default https://archiboltmusk.github.io/Purulia)

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const TO = (Deno.env.get('PATTERN_DIGEST_TO') || '').split(',').map(s => s.trim()).filter(Boolean);
const FROM = Deno.env.get('PATTERN_DIGEST_FROM') || 'Parishkar Bengal <onboarding@resend.dev>';
const SITE = (Deno.env.get('SITE_URL') || 'https://archiboltmusk.github.io/Purulia').replace(/\/$/, '');

interface Pattern {
  type: string;
  ward: number | null;
  category: string;
  count: number;
  detail: string;
  link: string;
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Subscriber {
  email: string;
  unsubscribe_token: string;
}

async function getPatterns(admin: any): Promise<Pattern[]> {
  const patterns: Pattern[] = [];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Category clusters by ward (5+ reports same category in one ward)
  const { data: clusters } = await admin.rpc('kasa_weekly_clusters', { p_days: 7 });
  if (clusters) {
    for (const c of clusters) {
      patterns.push({
        type: 'cluster',
        ward: c.ward_no,
        category: c.category,
        count: c.count,
        detail: `${c.count} ${c.category.replace(/_/g, ' ')} reports in Ward ${c.ward_no} this week`,
        link: `${SITE}/kasa.html?category=${c.category}&ward=${c.ward_no}`,
      });
    }
  }

  // 2. High-overdue (past SLA)
  const { data: overdue } = await admin.rpc('kasa_weekly_overdue', { p_limit: 5 });
  if (overdue) {
    for (const o of overdue) {
      patterns.push({
        type: 'overdue',
        ward: o.ward_no,
        category: o.category,
        count: o.count_overdue,
        detail: `${o.count_overdue} reports in Ward ${o.ward_no} past ${o.sla_days}-day SLA (oldest: ${o.oldest_days} days)`,
        link: `${SITE}/kasa.html?ward=${o.ward_no}&sort=oldest`,
      });
    }
  }

  // 3. Low resolution rate by chain (engineering, sanitation, etc.)
  const { data: resolution } = await admin.rpc('kasa_weekly_resolution', { p_days: 7 });
  if (resolution) {
    for (const r of resolution) {
      const rate = Math.round((r.resolved / (r.opened || 1)) * 100);
      if (rate < 50) {
        patterns.push({
          type: 'resolution',
          ward: null,
          category: r.chain,
          count: r.opened,
          detail: `${r.chain}: only ${rate}% of this week's reports resolved (${r.resolved}/${r.opened})`,
          link: `${SITE}/analytics.html`,
        });
      }
    }
  }

  // 4. Recurrence hotspots (same issue, re-reported)
  const { data: recurrence } = await admin.rpc('kasa_weekly_recurrence', { p_days: 60 });
  if (recurrence) {
    for (const rec of recurrence) {
      patterns.push({
        type: 'recurrence',
        ward: rec.ward_no,
        category: rec.category,
        count: rec.recurrence_count,
        detail: `${rec.landmark || 'Spot in Ward ' + rec.ward_no}: same ${rec.category} re-reported ${rec.recurrence_count} times in 60 days`,
        link: `${SITE}/kasa.html?report=${rec.id}`,
      });
    }
  }

  return patterns;
}

async function getSubscribers(admin: any): Promise<Subscriber[]> {
  const { data, error } = await admin.rpc('kasa_private.digest_subscribers_for_send', { p_limit: 5000 });
  if (error) {
    console.error('Error fetching subscribers:', error);
    return [];
  }
  return data || [];
}

function renderEmail(patterns: Pattern[], isPreview: boolean, unsubscribeToken?: string): { subject: string; text: string } {
  const week = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

  const lines: string[] = [];
  if (isPreview) lines.push('PREVIEW — sent only to the Parishkar team.\n');

  lines.push(`Parishkar Bengal — weekly patterns for ${week}\n`);

  if (!patterns.length) {
    lines.push('No notable patterns this week. Reports are flowing normally.');
  } else {
    const grouped: Record<string, Pattern[]> = {};
    for (const p of patterns) {
      if (!grouped[p.type]) grouped[p.type] = [];
      grouped[p.type].push(p);
    }

    if (grouped.cluster) {
      lines.push('⚠ CLUSTERS (5+ same issue, same ward):');
      for (const p of grouped.cluster) {
        lines.push(`  • ${p.detail}`);
        lines.push(`    ${p.link}`);
      }
      lines.push('');
    }

    if (grouped.overdue) {
      lines.push('⏰ OVERDUE (past SLA):');
      for (const p of grouped.overdue) {
        lines.push(`  • ${p.detail}`);
        lines.push(`    ${p.link}`);
      }
      lines.push('');
    }

    if (grouped.resolution) {
      lines.push('📉 LOW RESOLUTION:');
      for (const p of grouped.resolution) {
        lines.push(`  • ${p.detail}`);
      }
      lines.push('');
    }

    if (grouped.recurrence) {
      lines.push('🔄 RECURRING ISSUES (same spot, multiple reports):');
      for (const p of grouped.recurrence.slice(0, 3)) {
        lines.push(`  • ${p.detail}`);
        lines.push(`    ${p.link}`);
      }
      lines.push('');
    }
  }

  lines.push(
    'Action: Click links to filter the map and coordinate with departments.',
    `All data: ${SITE}/analytics.html`,
    '',
    'This is a SQL-based pattern summary, not verified fact. Every pattern needs on-site confirmation.',
    ''
  );

  if (unsubscribeToken) {
    lines.push(`Unsubscribe: ${SITE}/kasa-unsubscribe?token=${unsubscribeToken}`);
  }

  return {
    subject: `Purulia weekly patterns — ${patterns.length} finding${patterns.length === 1 ? '' : 's'}`,
    text: lines.join('\n'),
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!RESEND_KEY) return reply(503, { error: 'email not configured (RESEND_API_KEY missing)' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Get patterns
  const patterns = await getPatterns(admin);

  // Get municipal recipients
  const officialRecipients = TO.length ? TO : [];

  // Get community subscribers
  const subscribers = await getSubscribers(admin);

  const isPreview = !officialRecipients.length && !subscribers.length;

  if (!officialRecipients.length && !subscribers.length) {
    return reply(200, {
      sent: false,
      reason: 'no recipients (set PATTERN_DIGEST_TO or wait for community subscribers)',
      patterns: patterns.length,
      subscribers: 0,
    });
  }

  // Send to all recipients
  let sentCount = 0;
  let failCount = 0;

  // Send to officials (no unsubscribe token)
  const { subject, text: officialText } = renderEmail(patterns, isPreview);

  for (const email of officialRecipients) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject,
        text: officialText,
      }),
    }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }) as Response);

    if (res.ok) {
      sentCount++;
    } else {
      failCount++;
    }
  }

  // Send to community subscribers (with unsubscribe token)
  for (const subscriber of subscribers) {
    const { text: subscriberText } = renderEmail(patterns, isPreview, subscriber.unsubscribe_token);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [subscriber.email],
        subject,
        text: subscriberText,
      }),
    }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }) as Response);

    if (res.ok) {
      sentCount++;
    } else {
      failCount++;
    }
  }

  return reply(200, {
    sent: sentCount > 0,
    patterns: patterns.length,
    recipients: officialRecipients.length + subscribers.length,
    sent_count: sentCount,
    fail_count: failCount,
    community_subscribers: subscribers.length,
    officials: officialRecipients.length,
  });
});
