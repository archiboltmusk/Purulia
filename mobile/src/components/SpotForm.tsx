import { CameraView } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type Extra, type Fix, issueCaptureToken, rules as loadRules, spotPhoto, spotRpc } from '../api';
import { errorText, st, t } from '../i18n';
import { FIX_MAX_AGE_MS, watchFix } from '../location';
import { snap } from '../shot';
import { AppError } from '../supabase';
import { openSite } from './MoreSheet';
import { Caps, PopButton, PopCard, PopChip } from './Pop';
import { C, T } from './theme';

export type SpotFormId = 'adopt' | 'feed' | 'snake' | 'rescuer' | 'pandal' | 'work';

type Field = {
  key: string; label: string; ph?: string; max?: number;
  kind?: 'text' | 'tel' | 'number' | 'toggle' | 'choice' | 'date';
  options?: [string, string][];
};
type Rescuer = { name: string; km: number | string; note?: string | null; phone: string; whatsapp?: boolean };
type Done = { message?: string; rescuers?: Rescuer[] };
type Spec = {
  title: string; sub: string; note?: string; submit: string; photo?: string; fields: Field[];
  ready?: (v: Record<string, any>) => boolean;
  send: (v: Record<string, any>, fix: Fix, photoPath: string | null) => Promise<Done>;
};

const at = (f: Fix) => ({ p_lat: f.lat, p_lng: f.lng, p_accuracy: f.accuracy });
const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (txt(v) ? Number(v) || null : null);

/* The same fields, limits and RPCs as the kasa.html forms (?adopt=1, ?feed=1, ?snake=1,
   ?rescuer=1, ?pandal=1, ?work=1), worded from kasa-i18n.js. */
function spec(id: SpotFormId): Spec {
  switch (id) {
    case 'adopt': return {
      title: st('ad_title'), sub: st('ad_sub'), note: st('ad_note'), submit: st('ad_submit'),
      fields: [
        { key: 'name', label: st('ad_name'), ph: st('ad_name_ph'), max: 60 },
        { key: 'role', label: st('ad_role'), kind: 'choice', options: ['shop', 'club', 'school', 'family', 'other'].map((r) => [r, st('ad_role_' + r)]) },
      ],
      send: async (v, f) => {
        const d = await spotRpc<{ joined?: boolean; with?: string }>('kasa_adopt_spot', { p_name: v.name ?? '', ...at(f), p_role: v.role ?? 'shop' });
        return { message: d?.joined ? st('ad_joined', { name: d.with ?? '' }) : st('ad_done') };
      },
    };
    case 'feed': return {
      title: st('fd_title'), sub: st('fd_sub'), note: st('fd_note'), submit: st('fd_submit'),
      fields: [
        { key: 'name', label: st('fd_name'), ph: st('fd_name_ph'), max: 60 },
        { key: 'time', label: st('fd_time'), ph: st('fd_time_ph'), max: 40 },
        { key: 'dogs', label: st('fd_dogs'), kind: 'number', max: 2 },
        { key: 'abc', label: st('fd_abc'), kind: 'toggle' },
      ],
      send: async (v, f) => {
        await spotRpc('kasa_register_feeding_spot', {
          p_name: v.name ?? '', ...at(f), p_feed_time: v.time ?? '', p_dogs: num(v.dogs), p_helps_abc: !!v.abc, p_note: null,
        });
        return { message: st('fd_done') };
      },
    };
    case 'snake': return {
      title: st('sn_title'), sub: st('sn_sub'), submit: st('sn_submit'), photo: st('sn_photo_hint'),
      fields: [{ key: 'note', label: st('sn_note'), ph: st('sn_note_ph'), max: 140 }],
      send: async (v, f, path) => {
        const d = await spotRpc<{ rescuers?: Rescuer[] }>('kasa_report_snake', { ...at(f), p_photo_path: path, p_note: txt(v.note) });
        return { rescuers: d?.rescuers ?? [] };
      },
    };
    case 'rescuer': return {
      title: st('sr_title'), sub: st('sr_sub'), note: st('sr_privacy'), submit: st('sr_submit'),
      fields: [
        { key: 'name', label: st('sr_name'), ph: st('sr_name_ph'), max: 60 },
        { key: 'phone', label: st('sr_phone'), kind: 'tel', max: 16 },
        { key: 'wa', label: st('sr_wa'), kind: 'toggle' },
        { key: 'range', label: st('sr_range'), kind: 'number', max: 2 },
        { key: 'note', label: st('sr_note_l'), ph: st('sr_note_ph'), max: 280 },
      ],
      send: async (v, f) => {
        await spotRpc('kasa_register_snake_rescuer', {
          p_name: v.name ?? '', p_phone: v.phone ?? '', p_whatsapp: !!v.wa, ...at(f), p_range_km: num(v.range), p_note: txt(v.note),
        });
        return { message: st('sr_done') };
      },
    };
    case 'pandal': return {
      title: st('pd_title'), sub: st('pd_sub'), note: st('pd_note'), submit: st('pd_submit'),
      fields: [
        { key: 'name', label: st('pd_name'), ph: st('pd_name_ph'), max: 80 },
        { key: 'club', label: st('pd_club'), ph: st('pd_club_ph'), max: 80 },
      ],
      send: async (v, f) => {
        await spotRpc('kasa_add_pandal', { p_name: v.name ?? '', p_club: v.club ?? '', ...at(f) });
        return { message: st('pd_done') };
      },
    };
    case 'work': return {
      title: st('wk_title'), sub: st('wk_sub'), note: st('wk_note'), submit: st('wk_submit'), photo: st('wk_photo_hint'),
      fields: [
        { key: 'name', label: st('wk_copy'), ph: st('wk_name_ph'), max: 200 },
        { key: 'agency', label: '', ph: st('wk_agency_ph'), max: 120 },
        { key: 'contractor', label: '', ph: st('wk_contractor_ph'), max: 120 },
        { key: 'order', label: '', ph: st('wk_order_ph'), max: 80 },
        { key: 'cost', label: '', ph: st('wk_cost_ph'), max: 60 },
        { key: 'done', label: st('wk_done_on'), kind: 'date', ph: 'YYYY-MM-DD', max: 10 },
        { key: 'dlp', label: st('wk_dlp'), kind: 'choice', options: [['', st('wk_dlp_none')], ['0.25', st('wk_dlp_3m')], ['0.5', st('wk_dlp_6m')],
          ['1', st('wk_dlp_1')], ['2', st('wk_dlp_2')], ['3', st('wk_dlp_3')], ['5', st('wk_dlp_5')]] },
      ],
      // Same minimum as the site: a work name and an agency read off the board.
      ready: (v) => (txt(v.name)?.length ?? 0) >= 5 && (txt(v.agency)?.length ?? 0) >= 2
        && (!txt(v.done) || /^\d{4}-\d{2}-\d{2}$/.test(v.done.trim())),
      send: async (v, f, path) => {
        await spotRpc('kasa_add_public_work', {
          p_work_name: txt(v.name), p_agency: txt(v.agency), p_contractor: txt(v.contractor), p_work_order: txt(v.order),
          p_cost: txt(v.cost), p_completed_on: txt(v.done), p_dlp_years: txt(v.dlp) ? Number(v.dlp) : null, ...at(f), p_photo_path: path,
        });
        return { message: st('wk_sent') };
      },
    };
  }
}

/* One full-screen form for everything the site files "from where you stand": a good,
   real GPS fix is required, and the photo (snake, works board) comes from the live camera. */
export function SpotForm({ id, onClose }: { id: SpotFormId; onClose: () => void }) {
  const sp = spec(id);
  const camera = useRef<CameraView>(null);
  const token = useRef<Promise<string | null> | null>(sp.photo ? issueCaptureToken() : null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [maxAcc, setMaxAcc] = useState(60);
  const [values, setValues] = useState<Record<string, any>>({ role: 'shop', dlp: '' });
  const [shot, setShot] = useState<Extra | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => watchFix(setFix), []);
  useEffect(() => { loadRules().then((r) => setMaxAcc(r.max_gps_accuracy_m)); }, []);

  const fresh = !!fix && Date.now() - fix.at <= FIX_MAX_AGE_MS;
  const locOk = fresh && !fix!.mocked && fix!.accuracy <= maxAcc;
  const locText = !fix || !fresh ? st('ev_loc_wait', { a: '…' })
    : fix.mocked ? t('gps_mocked')
    : fix.accuracy > maxAcc ? st('ev_loc_weak', { a: Math.round(fix.accuracy) })
    : st('sc_loc_ok', { a: Math.round(fix.accuracy) });
  const ready = locOk && (!sp.photo || !!shot) && (sp.ready ? sp.ready(values) : true);

  const set = (k: string, v: unknown) => setValues((o) => ({ ...o, [k]: v }));

  const capture = async () => {
    if (!camera.current) return;
    const pending = token.current;
    token.current = issueCaptureToken();
    try {
      const pic = await snap(camera.current);
      setShot({ ...pic, token: (await pending) ?? null });
    } catch { Alert.alert(errorText('generic')); }
  };

  const send = async () => {
    if (!ready || !fix) return;
    setSending(true);
    try {
      const path = sp.photo && shot ? await spotPhoto(shot, fix) : null;
      const res = await sp.send(values, fix, path);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (res.rescuers) setDone({ ...res, message: undefined });
      else { Alert.alert(res.message ?? ''); onClose(); }
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Alert.alert(e instanceof AppError ? errorText(e.key, e.vars) : errorText('generic'));
    }
    setSending(false);
  };

  if (done?.rescuers && fix) {
    const map = `https://maps.google.com/?q=${fix.lat.toFixed(6)},${fix.lng.toFixed(6)}`;
    const msg = encodeURIComponent(st('sn_wa_msg', { map }) + (txt(values.note) ? ' ' + values.note.trim() : ''));
    return (
      <SafeAreaView style={s.fill}>
        <ScrollView contentContainerStyle={s.body}>
          <Text style={s.title}>{st('sn_title')}</Text>
          <Text style={s.text}>{done.rescuers.length ? st('sn_found', { n: done.rescuers.length }) : st('sn_none')}</Text>
          {done.rescuers.map((r) => (
            <PopCard key={r.phone} style={{ gap: 10 }}>
              <Text style={s.h}>{r.name} <Text style={s.dim}>{r.km} km</Text></Text>
              {r.note ? <Text style={s.dim}>{r.note}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <PopButton kind="accent" size="medium" label={st('sn_call')} onPress={() => Linking.openURL(`tel:+91${r.phone}`)} />
                {r.whatsapp ? <PopButton kind="secondary" size="medium" label="WhatsApp" onPress={() => Linking.openURL(`https://wa.me/91${r.phone}?text=${msg}`)} /> : null}
              </View>
            </PopCard>
          ))}
          <Pressable onPress={() => openSite('snakes.html#bite')}>
            <Text style={s.small}>{st('sn_after')} <Text style={s.link}>{st('sn_bite_link')}</Text></Text>
          </Pressable>
          <PopButton kind="primary" label={t('done')} onPress={onClose} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.fill}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={s.head}>
          <Text style={[s.title, { flex: 1 }]}>{sp.title}</Text>
          <Pressable onPress={onClose} hitSlop={10}><Text style={s.link}>{t('cancel')}</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text style={s.text}>{sp.sub}</Text>
          <Text style={[T.caps, { color: locOk ? C.accent : C.warn }]}>{locText}</Text>

          {sp.photo ? (
            <View style={{ gap: 8 }}>
              <Text style={s.small}>{sp.photo}</Text>
              <View style={s.cam}>
                {shot ? <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} />
                  : <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" animateShutter />}
              </View>
              {shot ? <PopButton kind="ghost" size="medium" label={t('retake')} onPress={() => setShot(null)} />
                : <PopButton kind="primary" size="medium" label={st('ev_photo_btn')} onPress={capture} />}
            </View>
          ) : null}

          {sp.fields.map((f) => (
            <View key={f.key} style={{ gap: 8 }}>
              {f.label ? <Caps>{f.label}</Caps> : null}
              {f.kind === 'toggle' ? (
                <Switch value={!!values[f.key]} onValueChange={(x) => set(f.key, x)} trackColor={{ true: C.accent, false: C.line }} thumbColor={C.white} />
              ) : f.kind === 'choice' ? (
                <View style={s.chips}>
                  {f.options!.map(([v, l]) => <PopChip key={v} label={l} on={(values[f.key] ?? '') === v} onPress={() => set(f.key, v)} />)}
                </View>
              ) : (
                <TextInput value={values[f.key] ?? ''} onChangeText={(x) => set(f.key, x)} placeholder={f.ph} placeholderTextColor={C.dim}
                  maxLength={f.max} style={s.input}
                  keyboardType={f.kind === 'tel' ? 'phone-pad' : f.kind === 'number' ? 'number-pad' : f.kind === 'date' ? 'numbers-and-punctuation' : 'default'} />
              )}
            </View>
          ))}

          {sp.note ? <Text style={s.small}>{sp.note}</Text> : null}
          <PopButton kind="accent" label={sp.submit} onPress={send} disabled={!ready} busy={sending} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  body: { padding: 16, gap: 16, paddingBottom: 48 },
  title: { ...T.h2, color: C.text },
  h: { ...T.h3, color: C.text },
  text: { ...T.body, color: C.text },
  dim: { ...T.small, color: C.dim },
  small: { ...T.small, color: C.dim },
  link: { color: C.text, textDecorationLine: 'underline' },
  cam: { width: '100%', aspectRatio: 4 / 3, backgroundColor: C.raised, overflow: 'hidden' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { ...T.body, minHeight: 48, color: C.text, borderWidth: 1, borderColor: C.line, padding: 12 },
});
