import AsyncStorage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import {
  addDocket, type Docket, DOCKET_PORTALS, type EvidenceMode, type Fix, markSeen, rateReport, type Reply, type Report, reportById,
  reportDockets, reportEvents, type ReportEvent, reportPhotos, reportReplies, reportWarranty, rules as loadRules, type Rules, type Warranty,
} from '../api';
import { reportLink } from '../config';
import { ago, catLabel, duration, errorText, fmtDate, type Key, st, t } from '../i18n';
import { fixUsable, watchFix } from '../location';
import { AppError } from '../supabase';
import { FlagDialog } from './FlagDialog';
import { openSite } from './MoreSheet';
import { Caps, EDGES, PopButton, PopCard, PopChip } from './Pop';
import { C, T } from './theme';

const SEEN_KEY = 'seen_reports';
const RATED_KEY = 'my_ratings';
const DAY = 86400000;

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
const statusOf = (r: Report) => (r.status === 'pending_verification' ? 'claimed' : ['open', 'claimed', 'resolved'].includes(r.status) ? r.status : 'open');
const failText = (e: unknown) => (e instanceof AppError ? errorText(e.key, e.vars) : errorText('generic'));

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  try { const v = await AsyncStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

type Props = {
  id: string | null;
  refresh: number;
  onClose: () => void;
  onEvidence: (mode: EvidenceMode, r: Report, rules: Rules) => void;
};

/* kasa.js report sheet, natively: photos, status and cleanup progress, "I saw it too",
   rating, official replies, filed-officially numbers, public works warranty, timeline,
   and the claim / confirm / dispute actions (live photo at the spot, EvidenceCamera). */
export function ReportSheet({ id, refresh, onClose, onEvidence }: Props) {
  const { width } = useWindowDimensions();
  const [r, setR] = useState<Report | null | undefined>(undefined);
  const [rules, setRules] = useState<Rules | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [events, setEvents] = useState<ReportEvent[] | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [dockets, setDockets] = useState<Docket[]>([]);
  const [warranty, setWarranty] = useState<Warranty | null>(null);
  const [seen, setSeen] = useState(false);
  const [mine, setMine] = useState<{ a?: number; s?: number }>({});
  const [busy, setBusy] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const fix = useRef<Fix | null>(null);

  const load = useCallback(async (rid: string) => {
    setR(undefined); setEvents(null); setPhotos([]); setReplies([]); setDockets([]); setWarranty(null);
    const [row, rl, seenIds, rated] = await Promise.all([
      reportById(rid).catch(() => null), loadRules(), readJSON<string[]>(SEEN_KEY, []), readJSON<Record<string, { a?: number; s?: number }>>(RATED_KEY, {}),
    ]);
    setR(row); setRules(rl); setSeen(seenIds.includes(rid)); setMine(rated[rid] ?? {});
    if (!row) return;
    reportPhotos(rid).then(setPhotos);
    reportEvents(rid).then(setEvents);
    reportDockets(rid).then(setDockets);
    reportWarranty(rid).then(setWarranty).catch(() => {});
    if (row.reply_count) reportReplies(rid).then(setReplies);
  }, []);

  useEffect(() => { if (id) load(id); }, [id, refresh, load]);
  // Seen and rating send the position when there is one; on the spot counts for more.
  // Kept in a ref: a new fix every second must not redraw the sheet.
  useEffect(() => (id ? watchFix((f) => { fix.current = f; }) : undefined), [id]);
  const here = () => (fixUsable(fix.current, 100) ? fix.current : null);

  const doSeen = async () => {
    if (!r || seen) return;
    setBusy(true);
    try {
      const res = await markSeen(r.id, here());
      const ids = await readJSON<string[]>(SEEN_KEY, []);
      AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...ids, r.id])])).catch(() => {});
      setSeen(true);
      if (res.counted) setR({ ...r, upvotes: (r.upvotes ?? 0) + 1 });
      Alert.alert(st(res.counted ? 'seen_done' : res.reason === 'own_report' ? 'seen_own' : 'seen_dup'));
    } catch (e) { Alert.alert(failText(e)); }
    setBusy(false);
  };

  const doRate = async (kind: 'a' | 's', value: number) => {
    if (!r) return;
    const next = { ...mine, [kind]: value };
    setBusy(true);
    try {
      const res = await rateReport(r.id, next.a ?? null, next.s ?? null, here());
      const all = await readJSON<Record<string, { a?: number; s?: number }>>(RATED_KEY, {});
      AsyncStorage.setItem(RATED_KEY, JSON.stringify({ ...all, [r.id]: next })).catch(() => {});
      setMine(next);
      setR({ ...r, rating_count: res.rating_count, onsite_rating_count: res.onsite_rating_count, authenticity_avg: res.authenticity_avg, severity_avg: res.severity_avg, neighbour_status: res.neighbour_status });
      Alert.alert(st(res.on_site ? 'rate_done_site' : 'rate_done'));
    } catch (e) { Alert.alert(failText(e)); }
    setBusy(false);
  };

  const share = () => {
    if (!r) return;
    const days = daysSince(r.created_at);
    const text = r.ward_no
      ? st('share_text', { cat: catLabel(r.category), ward: r.ward_no, days })
      : r.block_name ? st('share_text_rural', { cat: catLabel(r.category), block: r.block_name, days })
      : st('pl_share', { cat: catLabel(r.category), place: r.local_body ?? '', days });
    Share.share({ message: `${text} ${reportLink(r.id)}` }).catch(() => {});
  };

  return (
    <Modal visible={!!id} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.wrap}>
        {r === undefined ? <ActivityIndicator color={C.accent} style={{ marginTop: 60 }} />
          : r === null ? (
            <View style={{ padding: 20, gap: 16 }}>
              <Text style={s.dim}>{t('nearby_empty')}</Text>
              <Pressable onPress={onClose}><Text style={s.link}>{t('close')}</Text></Pressable>
            </View>
          ) : (
            <Body r={r} rules={rules} width={width} photos={photos} events={events} replies={replies} dockets={dockets}
              warranty={warranty} seen={seen} mine={mine} busy={busy}
              onSeen={doSeen} onRate={doRate} onShare={share} onClose={onClose} onFlag={() => setFlagging(true)}
              onEvidence={(m) => rules && onEvidence(m, r, rules)}
              onDocket={async (portal, number) => {
                try {
                  await addDocket(r.id, portal, number);
                  setDockets(await reportDockets(r.id));
                  Alert.alert(st('dk_saved'));
                  return true;
                } catch (e) { Alert.alert(failText(e)); return false; }
              }} />
          )}
      </View>
      <FlagDialog reportId={flagging && r ? r.id : null} onClose={() => setFlagging(false)} />
    </Modal>
  );
}

type BodyProps = {
  r: Report; rules: Rules | null; width: number; photos: string[]; events: ReportEvent[] | null; replies: Reply[]; dockets: Docket[];
  warranty: Warranty | null; seen: boolean; mine: { a?: number; s?: number }; busy: boolean;
  onSeen: () => void; onRate: (k: 'a' | 's', v: number) => void; onShare: () => void; onClose: () => void; onFlag: () => void;
  onEvidence: (m: EvidenceMode) => void; onDocket: (portal: string, number: string) => Promise<boolean>;
};

function Body(p: BodyProps) {
  const { r } = p;
  const status = statusOf(r);
  const resolved = status === 'resolved';
  const days = daysSince(r.created_at);
  const sla = r.sla_days ?? 7;
  const overdue = !resolved && days > sla;
  const fixDays = r.resolved_at ? Math.max(0, Math.round((new Date(r.resolved_at).getTime() - new Date(r.created_at).getTime()) / DAY)) : null;
  const people = (r.upvotes ?? 0) + 1;
  const head = resolved ? st(r.resolution_method === 'legacy_unverified' ? 'head_resolved_legacy' : 'head_resolved')
    : status === 'claimed' ? st('head_claimed') : st('head_open');
  const place = [r.ward_no ? st('acc_ward', { n: r.ward_no }) : null, r.local_body, r.block_name].filter(Boolean).join(' · ');
  const gallery = [r.photo_url, ...p.photos].filter((u): u is string => !!u);
  const footStatus = resolved ? (fixDays != null ? st('foot_fixed', { d: fixDays }) : t('status_resolved'))
    : overdue ? st('foot_unresolved_overdue', { d: days, sla }) : st('foot_unresolved', { d: days });

  return (
    <>
      <View style={s.head}>
        <Text style={s.headText}>{[r.severity ? st('sev_' + r.severity) : null, head].filter(Boolean).join(' · ')}</Text>
        <View style={{ flexDirection: 'row', gap: 18 }}>
          <Pressable onPress={p.onShare} hitSlop={10}><Text style={s.link}>{st('sheet_share')}</Text></Pressable>
          <Pressable onPress={p.onClose} hitSlop={10}><Text style={s.link}>{t('close')}</Text></Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} >
          {gallery.map((u) => <Image key={u} source={{ uri: u }} style={{ width: p.width - 32, height: (p.width - 32) * 0.75, backgroundColor: '#222' }} />)}
        </ScrollView>
        {gallery.length > 1 ? <Text style={s.dim}>{`1 / ${gallery.length} →`}</Text> : null}
        {!resolved ? (
          <PopButton kind={p.seen ? 'ghost' : 'primary'} label={st(p.seen ? 'sheet_seen_done' : 'sheet_seen_btn')}
            onPress={p.onSeen} disabled={p.seen} busy={p.busy && !p.seen} />
        ) : null}

        <View style={{ gap: 4 }}>
          <Text style={s.cat}>{catLabel(r.category)}{r.waste_type ? ' · ' + st('waste_' + r.waste_type) : ''}
            {r.neighbour_status === 'verified' ? ' ✓ ' + st('nb_verified') : r.neighbour_status === 'doubted' ? ' ? ' + st('nb_doubted') : ''}</Text>
          {r.landmark ? <Text style={s.title}>{r.landmark}</Text> : null}
          {place ? <Text style={s.dim}>{place}</Text> : null}
          {r.description ? <Text style={s.body}>{r.description}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 18, marginTop: 4 }}>
            <Pressable onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`)}>
              <Text style={s.link}>{st('sheet_directions')}</Text>
            </Pressable>
            {r.gps_verified ? <Text style={s.dim}>📍 {st('sheet_gps')}</Text> : null}
          </View>
        </View>
        <Text style={s.small}>{st('sheet_anonymous')} {st('sheet_allegation')}</Text>

        <View style={s.cards}>
          <Card n={people} label={st('stat_people')} />
          <Card n={resolved && fixDays != null ? fixDays : days} warn={overdue}
            label={st(resolved && fixDays != null ? 'stat_days_fix' : overdue ? 'stat_days_overdue' : 'stat_days_open')} />
        </View>

        <StatusPanel r={r} rules={p.rules} status={status} fixDays={fixDays} />
        {!resolved ? <Rating r={r} mine={p.mine} busy={p.busy} onRate={p.onRate} /> : null}
        {p.replies.length ? (
          <Section title={st('reply_title')}>
            {p.replies.map((x) => (
              <View key={x.id} style={[s.box, s.reply]}>
                <Text style={s.bold}>{x.responder_name} <Text style={s.dim}>{x.responder_role} · {fmtDate(x.created_at)}</Text></Text>
                <Text style={s.body}>{x.body}</Text>
                {x.verified_note ? <Text style={s.ok}>✓ {x.verified_note}</Text> : null}
              </View>
            ))}
            <Text style={s.small}>{st('reply_note')}</Text>
          </Section>
        ) : null}
        <Dockets dockets={p.dockets} warranty={p.warranty} onAdd={p.onDocket} />
        <Pressable onPress={() => openSite(`kasa.html?report=${encodeURIComponent(r.id)}`)}>
          <Text style={s.link}>{t('who_site')}</Text>
        </Pressable>
        <Timeline events={p.events} />
      </ScrollView>
      <View style={s.foot}>
        <Text style={s.dim}>{st('foot_line', { ago: ago(r.created_at), n: people, status: footStatus })}</Text>
        <View style={s.actions}>
          {status === 'open' ? <Act label={st('act_verify')} primary onPress={() => p.onEvidence('claim')} /> : null}
          {status === 'claimed' && r.claim_id ? (
            <>
              <Act label={'✓ ' + st('act_confirm')} primary onPress={() => p.onEvidence('verify')} />
              <Act label={'✗ ' + st('act_dispute')} onPress={() => p.onEvidence('dispute')} />
            </>
          ) : null}
          {resolved ? <Act label={'↻ ' + st('act_again')} onPress={p.onClose} /> : null}
          {status !== 'claimed' || !r.claim_id ? <Act label={st('act_flag')} onPress={p.onFlag} /> : null}
        </View>
      </View>
    </>
  );
}

function Card({ n, label, warn }: { n: number; label: string; warn?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <PopCard edges={warn ? { right: C.bad, bottom: '#802138' } : EDGES.dark} style={{ padding: 12, gap: 2 }}>
        <Text style={[s.cardN, warn && { color: C.bad }]}>{n}</Text>
        <Text style={[T.capsS, { color: C.dim }]}>{label}</Text>
      </PopCard>
    </View>
  );
}

function Act({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return <PopButton kind={primary ? 'accent' : 'secondary'} size="medium" label={label} onPress={onPress} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={{ gap: 8 }}><Caps>{title}</Caps>{children}</View>;
}

function BeforeAfter({ before, after }: { before: string | null; after: string | null }) {
  if (!after) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {[[before, st('pn_before')], [after, st('pn_after')]].map(([u, l], i) => (
        <View key={i} style={{ flex: 1, gap: 4 }}>
          {u ? <Image source={{ uri: u }} style={s.ba} /> : <View style={s.ba} />}
          <Text style={[s.small, i === 1 && { color: C.accent }]}>{l}</Text>
        </View>
      ))}
    </View>
  );
}

function StatusPanel({ r, rules, status, fixDays }: { r: Report; rules: Rules | null; status: string; fixDays: number | null }) {
  const notes: [string, string][] = [];
  if (r.moderation_status === 'flagged') notes.push([C.warn, '⚑ ' + st('pn_flagged', { n: r.flags ?? 0 })]);
  if (r.recurrence_count) notes.push([C.warn, '↻ ' + st('pn_recurring', { n: r.recurrence_count })]);
  if (r.rejected_claims) notes.push([C.bad, '✗ ' + st('pn_rejected', { n: r.rejected_claims })]);
  const q = r.verify_needed || rules?.verify_quorum || 3;
  const dq = rules?.dispute_quorum ?? 2;
  let panel: React.ReactNode = null;
  if (status === 'claimed' && r.claim_id) {
    const v = r.claim_verify_count ?? 0;
    const timing = r.claim_finalize_after
      ? st('pn_final_in', { h: Math.max(0, Math.ceil((new Date(r.claim_finalize_after).getTime() - Date.now()) / 3600000)) })
      : st('pn_needs_more', { n: Math.max(0, q - v) }) + ' ' +
        st('pn_expires', { date: fmtDate(new Date(r.claim_created_at ?? r.created_at).getTime() + (rules?.claim_expiry_days ?? 14) * DAY) });
    panel = (
      <PopCard edges={EDGES.white} style={s.box}>
        <Text style={s.bold}>{st('pn_claim_title')}</Text>
        <BeforeAfter before={r.photo_url} after={r.claim_photo_url} />
        {r.claim_created_at ? <Text style={s.dim}>{r.claim_distance_m != null
          ? st('pn_claim_meta', { ago: ago(r.claim_created_at), d: r.claim_distance_m }) : st('pn_claim_meta_short', { ago: ago(r.claim_created_at) })}</Text> : null}
        <Text style={s.body}>{st('pn_progress', { v, q, d: r.claim_dispute_count ?? 0, dq })}</Text>
        <Text style={s.dim}>{timing}</Text>
        {r.claim_needs_review ? <Text style={{ color: C.warn }}>⏸ {st('pn_claim_held')}</Text> : null}
      </PopCard>
    );
  } else if (status === 'resolved' && r.resolution_method === 'legacy_unverified') {
    panel = (
      <PopCard style={s.box}>
        <Text style={s.bold}>{st('pn_legacy_title')}</Text>
        <BeforeAfter before={r.photo_url} after={r.resolved_photo_url} />
        <Text style={s.dim}>{st('pn_legacy_body')}</Text>
      </PopCard>
    );
  } else if (status === 'resolved') {
    panel = (
      <PopCard edges={EDGES.accent} style={s.box}>
        <Text style={[s.bold, { color: C.accent }]}>✓ {st(r.resolution_method === 'photo_check' ? 'pn_resolved_photo_title' : r.resolution_method === 'moderator' ? 'pn_resolved_mod_title' : 'pn_resolved_title')}</Text>
        <BeforeAfter before={r.photo_url} after={r.resolved_photo_url} />
        {r.resolved_at ? <Text style={s.dim}>{st('pn_resolved_meta', { date: fmtDate(r.resolved_at), days: fixDays ?? 0 })}</Text> : null}
      </PopCard>
    );
  }
  return (
    <>
      {notes.map(([c, x]) => <Text key={x} style={{ color: c, fontSize: 14 }}>{x}</Text>)}
      {panel}
    </>
  );
}

function Rating({ r, mine, busy, onRate }: { r: Report; mine: { a?: number; s?: number }; busy: boolean; onRate: (k: 'a' | 's', v: number) => void }) {
  const summary = r.rating_count
    ? st('rate_summary', { n: r.rating_count, site: r.onsite_rating_count ?? 0, a: r.authenticity_avg?.toFixed(1) ?? '–', s: r.severity_avg?.toFixed(1) ?? '–' })
    : st('rate_none');
  const row = (kind: 'a' | 's', label: string) => (
    <View style={s.rateRow}>
      <Text style={[s.body, { flex: 1 }]}>{label}</Text>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} disabled={busy} onPress={() => onRate(kind, n)} hitSlop={4} accessibilityLabel={`${n}/5`}>
          <Text style={[s.star, n <= (mine[kind] ?? 0) && { color: C.warn }]}>★</Text>
        </Pressable>
      ))}
    </View>
  );
  return (
    <Section title={st('rate_title')}>
      <Text style={s.dim}>{summary}</Text>
      {row('a', st('rate_real'))}
      {row('s', st('rate_serious'))}
      <Text style={s.small}>{st('rate_hint', { n: 3 })}</Text>
    </Section>
  );
}

function Dockets({ dockets, warranty, onAdd }: { dockets: Docket[]; warranty: Warranty | null; onAdd: (portal: string, number: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [portal, setPortal] = useState<string>(DOCKET_PORTALS[0]);
  const [number, setNumber] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      {warranty ? (
        <Pressable onPress={() => openSite(`works.html#work-${warranty.id}`)}>
          <Text style={s.body}>🛠 {st('wk_under', { d: fmtDate(warranty.warranty_until) })}</Text>
        </Pressable>
      ) : null}
      {dockets.length ? (
        <Section title={st('dk_title')}>
          {dockets.map((d) => (
            <Text key={d.portal + d.number} style={s.body}>
              <Text style={s.bold}>{st('dk_' + d.portal)}</Text> {d.number} <Text style={s.small}>{st('dk_added', { d: fmtDate(d.added) })}</Text>
            </Text>
          ))}
        </Section>
      ) : null}
      <Pressable onPress={() => setOpen(!open)}><Text style={s.link}>{st('dk_add')}</Text></Pressable>
      {open ? (
        <View style={{ gap: 8 }}>
          <View style={s.chips}>
            {DOCKET_PORTALS.map((x) => (
              <PopChip key={x} label={st('dk_' + x)} on={portal === x} onPress={() => setPortal(x)} />
            ))}
          </View>
          <TextInput value={number} onChangeText={setNumber} maxLength={40} autoCapitalize="characters" autoCorrect={false}
            placeholder={st('dk_number')} placeholderTextColor={C.dim} style={s.input} />
          <PopButton kind="primary" size="medium" label={st('dk_save')} disabled={!number.trim()} busy={saving} onPress={async () => {
            setSaving(true);
            if (await onAdd(portal, number.trim())) { setNumber(''); setOpen(false); }
            setSaving(false);
          }} />
        </View>
      ) : null}
    </View>
  );
}

/* Same lines as kasa.js renderTimelineHTML, from kasa_public_events only. */
function eventBits(e: ReportEvent) {
  const d = e.detail ?? {};
  const bits: string[] = [];
  if (e.actor_tag) bits.push(st('tl_by', { tag: 'C-' + e.actor_tag }));
  if (e.distance_m != null) bits.push(st('tl_dist', { d: e.distance_m }));
  if (e.kind === 'reported' && d.gps) bits.push(st('tl_gps', { a: d.accuracy_m }));
  if (e.kind === 'claim_rejected' && d.reason) bits.push(d.reason === 'disputed_on_site' ? st('rej_disputed_on_site') : String(d.reason));
  if (e.kind === 'claim_held' && d.reason) bits.push(st('held_' + d.reason));
  if (e.kind === 'resolved') bits.push(st('tl_counts', { v: d.verify_count ?? '?', d: d.dispute_count ?? 0 }));
  if (e.kind === 'resolved' && d.by === 'moderator' && d.reason) bits.push(String(d.reason));
  if (e.kind === 'flagged' && d.reason) bits.push(t(('fr_' + d.reason) as Key) + (d.suggested_category ? ' → ' + catLabel(d.suggested_category) : ''));
  if ((e.kind === 'recategorized' || e.kind === 'auto_recategorized') && d.to) bits.push(`${catLabel(d.from)} → ${catLabel(d.to)}${d.reason ? ' · ' + d.reason : ''}`);
  if (['reported', 'claimed', 'verified', 'disputed'].includes(e.kind)) {
    if (d.capture === 'live') bits.push(st('tl_live'));
    else if (d.capture === 'file') bits.push(st('tl_file'));
    if (d.taken_minutes_ago >= 60) bits.push(st('tl_taken', { t: duration(d.taken_minutes_ago) }));
    if (d.flag === 'gps_far' && d.exif_distance_m != null) bits.push(st('tl_exif_far', { d: d.exif_distance_m }));
    if (d.ai_edited) bits.push(st('tl_ai'));
    if (d.needs_review) bits.push(st('tl_held'));
  }
  if (['moderated', 'vote_voided', 'reply_hidden', 'vote_cleared', 'claim_cleared'].includes(e.kind) && d.reason) bits.push(String(d.reason));
  if (e.kind === 'official_reply' && d.name) bits.push(`${d.name}${d.role ? ' · ' + d.role : ''}`);
  if ((e.kind === 'neighbours_verified' || e.kind === 'neighbours_doubted') && d.ratings) bits.push(st('tl_ratings', { n: d.ratings, a: d.average }));
  return bits;
}

function Timeline({ events }: { events: ReportEvent[] | null }) {
  return (
    <Section title={st('tl_title')}>
      {events === null ? <Text style={s.dim}>{st('tl_loading')}</Text>
        : !events.length ? <Text style={s.dim}>{st('tl_empty')}</Text>
        : events.map((e) => {
          const d = e.detail ?? {};
          const kind = e.kind === 'resolved' && d.by === 'photo_check' ? 'ev_resolved_photo' : e.kind === 'resolved' && d.by === 'moderator' ? 'ev_resolved_mod' : 'ev_' + e.kind;
          const bits = eventBits(e);
          return (
            <View key={e.id} style={s.tl}>
              <View style={s.tlDot} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.body}>{st(kind)} <Text style={s.small}>{ago(e.created_at)}</Text></Text>
                {bits.length ? <Text style={s.small}>{bits.join(' · ')}</Text> : null}
              </View>
              {e.photo_url && /^https:\/\//.test(e.photo_url) && e.kind !== 'reported' ? <Image source={{ uri: e.photo_url }} style={s.tlPhoto} /> : null}
            </View>
          );
        })}
    </Section>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
  headText: { ...T.caps, color: C.text, flexShrink: 1 },
  cat: { ...T.caps, color: C.accent },
  title: { ...T.h2, color: C.text },
  body: { ...T.body, color: C.text },
  bold: { ...T.h3, fontSize: 16, color: C.text },
  dim: { ...T.small, color: C.dim },
  small: { ...T.small, fontSize: 12, color: C.dim },
  ok: { color: C.accent, fontSize: 13 },
  link: { color: C.text, textDecorationLine: 'underline', fontSize: 15 },
  cards: { flexDirection: 'row', gap: 10 },
  cardN: { ...T.h1, color: C.text },
  box: { padding: 14, gap: 8 },
  reply: { borderLeftWidth: 3, borderLeftColor: C.accent, backgroundColor: C.raised },
  ba: { width: '100%', aspectRatio: 0.75, backgroundColor: '#222' },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  star: { color: '#3D3D3D', fontSize: 28 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { minHeight: 44, color: C.text, borderWidth: 1, borderColor: C.line, padding: 12, fontSize: 15 },
  tl: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  tlDot: { width: 8, height: 8, backgroundColor: C.accent, marginTop: 7 },
  tlPhoto: { width: 48, height: 64, backgroundColor: '#222' },
  foot: { padding: 16, paddingBottom: 28, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
});
