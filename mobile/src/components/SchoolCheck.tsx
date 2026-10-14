import { CameraView } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  type Extra, type Fix, type Nearby, type School, type SchoolAnswers, issueCaptureToken, nearbySchools, rules as loadRules,
  schoolBlocks, schoolsIn, submitSchoolCheck,
} from '../api';
import { errorText, st, t } from '../i18n';
import { FIX_MAX_AGE_MS, watchFix } from '../location';
import { snap } from '../shot';
import { AppError } from '../supabase';
import { Caps, PopButton, PopChip } from './Pop';
import { C, T } from './theme';

// Same questions, order and answer rules as kasa.js: five yes/no, two that may be "can't tell", teachers, building.
const YN = ['water', 'toilets', 'boundary', 'electricity', 'mdm'] as const;
const MAYBE = ['girls_toilet', 'meal_today'] as const;
const km = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

type Ans = Partial<Record<(typeof YN)[number], boolean>> & Partial<Record<(typeof MAYBE)[number], boolean | null>>;

/* The website's school check, natively: stand at the school, pick it (nearby first, else block
   and search), answer, one live photo. The server applies the same photo and location checks. */
export function SchoolCheck({ onClose }: { onClose: () => void }) {
  const camera = useRef<CameraView>(null);
  const token = useRef<Promise<string | null>>(issueCaptureToken());
  const [fix, setFix] = useState<Fix | null>(null);
  const [maxAcc, setMaxAcc] = useState(60);
  const [district, setDistrict] = useState('purulia');
  const [blocks, setBlocks] = useState<{ block: string; schools: number }[]>([]);
  const [block, setBlock] = useState('');
  const [schools, setSchools] = useState<School[]>([]);
  const [near, setNear] = useState<Nearby[] | null>(null);
  const [school, setSchool] = useState<{ udise_code: string; name: string } | null>(null);
  const [q, setQ] = useState('');
  const [ans, setAns] = useState<Ans>({});
  const [building, setBuilding] = useState<SchoolAnswers['building'] | null>(null);
  const [teachers, setTeachers] = useState('');
  const [shot, setShot] = useState<Extra | null>(null);
  const [sending, setSending] = useState(false);
  const asked = useRef(false);

  useEffect(() => watchFix(setFix), []);
  useEffect(() => { loadRules().then((r) => setMaxAcc(r.max_gps_accuracy_m)); }, []);
  useEffect(() => { schoolBlocks(district).then(setBlocks).catch(() => setBlocks([])); }, [district]);
  useEffect(() => { if (block) schoolsIn(district, block).then(setSchools).catch(() => setSchools([])); }, [district, block]);

  const fresh = !!fix && Date.now() - fix.at <= FIX_MAX_AGE_MS;
  const locOk = fresh && !fix!.mocked && fix!.accuracy <= maxAcc;

  // Once GPS is in: the district, block and listed schools around you (same RPC as the site).
  useEffect(() => {
    if (!fix || !fresh || asked.current) return;
    asked.current = true;
    nearbySchools(fix).then((n) => {
      if (n.district) setDistrict(n.district);
      if (n.block) setBlock((b) => b || n.block!);
      setNear(n.near);
    }).catch(() => setNear([]));
  }, [fix, fresh]);

  // The nearby block name may differ in spelling from the list; match it the way the site does.
  useEffect(() => {
    if (!block || !blocks.length || blocks.some((b) => b.block === block)) return;
    const key = (b: string) => b.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/II/g, '2').replace(/I/g, '1');
    const hit = blocks.find((b) => key(b.block) === key(block));
    setBlock(hit ? hit.block : '');
  }, [blocks, block]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return schools.filter((s) => !needle || `${s.name} ${s.village ?? ''} ${s.panchayat ?? ''}`.toLowerCase().includes(needle)).slice(0, 40);
  }, [schools, q]);

  const answered = YN.every((k) => typeof ans[k] === 'boolean') && MAYBE.every((k) => k in ans) && !!building;
  const ready = !!school && answered && locOk && !!shot;

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
    if (!ready || !fix || !school || !shot || !building) return;
    setSending(true);
    try {
      const n = teachers.trim() === '' ? null : Math.round(Number(teachers));
      const out = await submitSchoolCheck(school.udise_code, {
        water: ans.water!, toilets: ans.toilets!, boundary: ans.boundary!, electricity: ans.electricity!, mdm: ans.mdm!,
        girls_toilet: ans.girls_toilet ?? null, meal_today: ans.meal_today ?? null, building,
        teachers: n != null && Number.isFinite(n) && n >= 0 && n <= 200 ? n : null,
      }, shot, fix);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert(st(out?.moderation_status === 'approved' ? 'sc_done' : 'sc_done_review'));
      onClose();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Alert.alert(e instanceof AppError ? errorText(e.key, e.vars) : errorText('generic'));
    }
    setSending(false);
  };

  const locText = !fix || !fresh ? st('ev_loc_wait', { a: '…' })
    : fix.mocked ? t('gps_mocked')
    : fix.accuracy > maxAcc ? st('ev_loc_weak', { a: Math.round(fix.accuracy) })
    : st('sc_loc_ok', { a: Math.round(fix.accuracy) });

  const yn = (k: (typeof YN)[number] | (typeof MAYBE)[number], maybe: boolean) => (
    <View key={k} style={{ gap: 8 }}>
      <Text style={s.text}>{st('sc_q_' + k)}</Text>
      <View style={s.chips}>
        <PopChip label={st('sc_yes')} on={ans[k] === true} onPress={() => setAns((a) => ({ ...a, [k]: true }))} />
        <PopChip label={st('sc_no')} on={ans[k] === false} onPress={() => setAns((a) => ({ ...a, [k]: false }))} />
        {maybe ? <PopChip label={st('sc_cant_tell')} on={k in ans && ans[k] === null} onPress={() => setAns((a) => ({ ...a, [k]: null }))} /> : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={s.fill}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={s.head}>
          <Text style={[s.title, { flex: 1 }]}>{st('sc_title')}</Text>
          <Pressable onPress={onClose} hitSlop={10}><Text style={s.link}>{t('cancel')}</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text style={s.text}>{st('sc_sub')}</Text>
          <Text style={[T.caps, { color: locOk ? C.accent : C.warn }]}>{locText}</Text>

          <Caps>{st('sc_which')}</Caps>
          {school ? (
            <Pressable onPress={() => setSchool(null)} style={s.picked}>
              <Text style={s.h}>✓ {school.name}</Text>
              <Text style={s.small}>UDISE {school.udise_code}</Text>
            </Pressable>
          ) : (
            <View style={{ gap: 12 }}>
              <Text style={s.small}>{near === null ? st('sc_near_wait') : near.length ? st('sc_near_title') : st('sc_near_none')}</Text>
              {(near ?? []).slice(0, 8).map((n) => (
                <Pressable key={n.udise_code} style={s.row} onPress={() => setSchool({ udise_code: n.udise_code, name: n.name })}>
                  <Text style={s.h}>{n.name}</Text>
                  <Text style={s.small}>{st(n.learned ? 'sc_near_seen' : 'sc_near_dist', { d: km(n.distance_m) })}{n.village ? ` · ${n.village}` : ''}</Text>
                </Pressable>
              ))}
              <Text style={s.small}>{st('sc_block_pick')}</Text>
              <View style={s.chips}>
                {blocks.map((b) => <PopChip key={b.block} label={`${b.block} (${b.schools})`} on={block === b.block} onPress={() => setBlock(b.block)} />)}
              </View>
              {block ? (
                <>
                  <TextInput value={q} onChangeText={setQ} placeholder={st('sc_find_ph')} placeholderTextColor={C.dim} style={s.input} />
                  {list.map((x) => (
                    <Pressable key={x.udise_code} style={s.row} onPress={() => setSchool({ udise_code: x.udise_code, name: x.name })}>
                      <Text style={s.h}>{x.name}</Text>
                      <Text style={s.small}>{[x.village, x.panchayat].filter(Boolean).join(', ')}</Text>
                    </Pressable>
                  ))}
                </>
              ) : null}
            </View>
          )}

          {school ? (
            <>
              <Caps>{st('sc_questions')}</Caps>
              {YN.map((k) => yn(k, false))}
              {MAYBE.map((k) => yn(k, true))}
              <View style={{ gap: 8 }}>
                <Text style={s.text}>{st('sc_q_teachers')}</Text>
                <TextInput value={teachers} onChangeText={(x) => setTeachers(x.replace(/\D/g, ''))} maxLength={3} keyboardType="number-pad"
                  placeholder={st('sc_teachers_ph')} placeholderTextColor={C.dim} style={s.input} />
              </View>
              <View style={{ gap: 8 }}>
                <Text style={s.text}>{st('sc_q_building')}</Text>
                <View style={s.chips}>
                  <PopChip label={st('sc_good')} on={building === 'good'} onPress={() => setBuilding('good')} />
                  <PopChip label={st('sc_repair')} on={building === 'needs_repair'} onPress={() => setBuilding('needs_repair')} />
                  <PopChip label={st('sc_unsafe')} on={building === 'unsafe'} onPress={() => setBuilding('unsafe')} />
                </View>
              </View>

              <Caps>{st('sc_photo')}</Caps>
              <Text style={s.small}>{st('sc_photo_hint')}</Text>
              <View style={s.cam}>
                {shot ? <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} />
                  : <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" animateShutter />}
              </View>
              {shot ? <PopButton kind="ghost" size="medium" label={t('retake')} onPress={() => setShot(null)} />
                : <PopButton kind="primary" size="medium" label={st('ev_photo_btn')} onPress={capture} />}
              <PopButton kind="accent" label={st('sc_submit')} onPress={send} disabled={!ready} busy={sending} />
            </>
          ) : null}
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
  small: { ...T.small, color: C.dim },
  link: { color: C.text, textDecorationLine: 'underline' },
  cam: { width: '100%', aspectRatio: 4 / 3, backgroundColor: C.raised, overflow: 'hidden' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { ...T.body, minHeight: 48, color: C.text, borderWidth: 1, borderColor: C.line, padding: 12 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line, gap: 2 },
  picked: { borderWidth: 1, borderColor: C.accent, padding: 12, gap: 2 },
});
