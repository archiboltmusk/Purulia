import { CameraView } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { distanceM, type EvidenceMode, type Extra, type Fix, issueCaptureToken, OfflineError, type Report, type Rules, submitEvidence } from '../api';
import { errorText, st, t } from '../i18n';
import { FIX_MAX_AGE_MS, watchFix } from '../location';
import { snap } from '../shot';
import { AppError } from '../supabase';
import { C } from './theme';

type Props = { mode: EvidenceMode; report: Report; rules: Rules; onClose: (changed: boolean) => void };

/* Claim a cleanup, confirm it or dispute it, the way kasa.js openEvidence does: stand
   within the radius with a good fix, take a live photo now, send. No gallery, ever. */
export function EvidenceCamera({ mode, report, rules, onClose }: Props) {
  const camera = useRef<CameraView>(null);
  const token = useRef<Promise<string | null>>(issueCaptureToken());
  const [fix, setFix] = useState<Fix | null>(null);
  const [shot, setShot] = useState<Extra | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => watchFix(setFix), []);

  const radius = mode === 'claim' ? rules.claim_radius_m : rules.vote_radius_m;
  const q = report.verify_needed || rules.verify_quorum;
  const fresh = fix && Date.now() - fix.at <= FIX_MAX_AGE_MS;
  const d = fix ? Math.round(distanceM(fix.lat, fix.lng, report.lat, report.lng)) : null;
  const a = fix ? Math.round(fix.accuracy) : null;
  let loc: [boolean, string];
  if (!fix || !fresh) loc = [false, st('ev_loc_wait', { a: '…' })];
  else if (fix.mocked) loc = [false, t('gps_mocked')];
  else if (fix.accuracy > rules.max_gps_accuracy_m) loc = [false, st('ev_loc_weak', { a: a! })];
  else if (d! > radius) loc = [false, st('ev_loc_far', { d: d!, r: radius })];
  else loc = [true, st('ev_loc_ok', { d: d!, a: a! })];

  const capture = async () => {
    if (!camera.current) return;
    const pending = token.current;
    token.current = issueCaptureToken(); // one token per photo
    try {
      const pic = await snap(camera.current);
      setShot({ ...pic, token: await pending });
    } catch {
      Alert.alert(errorText('generic'));
    }
  };

  const send = async () => {
    if (!shot || !fix || !loc[0]) return;
    setSending(true);
    try {
      const res = await submitEvidence(mode, report, shot, fix, note);
      const dq = res.dispute_needed || rules.dispute_quorum;
      const need = res.verify_needed || q;
      const msg = mode === 'claim' ? st(res.needs_review ? 'ev_done_claim_held' : 'ev_done_claim', { q: need })
        : res.needs_review ? st('ev_done_held')
        : res.claim_status === 'rejected' ? st('ev_done_rejected')
        : res.claim_status === 'accepted' ? st('ev_resolved')
        : mode === 'verify' && res.final_after ? st('ev_done_quorum_at', { at: new Date(res.final_after).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) })
        : mode === 'verify' ? st('ev_done_verify', { v: res.verify_count ?? 0, q: need })
        : st('ev_done_dispute', { d: res.dispute_count ?? 0, dq });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert(msg);
      onClose(true);
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Alert.alert(e instanceof AppError ? errorText(e.key, e.vars) : e instanceof OfflineError ? errorText('upload') : errorText('generic'));
      setSending(false);
    }
  };

  return (
    <View style={s.fill}>
      {shot ? <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        : <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" animateShutter />}
      <SafeAreaView edges={['top']} style={s.top}>
        <View style={s.panel}>
          <Text style={s.title}>{st('ev_title_' + mode)}</Text>
          <Text style={s.body}>{st('ev_sub_' + mode, { q, r: radius, dq: rules.dispute_quorum })}</Text>
          <Text style={[s.body, { color: loc[0] ? C.accent : C.warn, fontWeight: '700' }]}>{loc[1]}</Text>
        </View>
        <Pressable onPress={() => onClose(false)} hitSlop={10} style={s.pill}><Text style={s.pillText}>{t('cancel')}</Text></Pressable>
      </SafeAreaView>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.bottomWrap} pointerEvents="box-none">
        <SafeAreaView edges={['bottom']} style={s.bottom}>
          {!shot ? (
            <>
              <Text style={s.hint}>{st('ev_photo_hint')}</Text>
              <Pressable onPress={capture} style={s.shutterOuter} accessibilityRole="button" accessibilityLabel={st('ev_photo_btn')}>
                <View style={s.shutterInner} />
              </Pressable>
            </>
          ) : (
            <View style={s.panel}>
              {mode === 'dispute' ? (
                <TextInput value={note} onChangeText={setNote} placeholder={st('ev_note')} placeholderTextColor={C.dim}
                  maxLength={300} multiline style={s.input} />
              ) : null}
              <Text style={s.small}>{st('ev_privacy')}</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable onPress={() => setShot(null)} disabled={sending} style={s.ghost}><Text style={s.pillText}>{t('retake')}</Text></Pressable>
                <Pressable onPress={send} disabled={!loc[0] || sending} style={[s.btn, (!loc[0] || sending) && { opacity: 0.5 }]}>
                  {sending ? <ActivityIndicator color="#06281A" /> : <Text style={s.btnText}>{st('ev_submit_' + mode)}</Text>}
                </Pressable>
              </View>
            </View>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg },
  top: { position: 'absolute', top: 0, left: 0, right: 0, padding: 12, gap: 8, alignItems: 'flex-end' },
  panel: { alignSelf: 'stretch', padding: 14, gap: 8, borderRadius: 18, backgroundColor: C.card },
  title: { color: C.text, fontSize: 18, fontWeight: '800' },
  body: { color: C.text, fontSize: 14, lineHeight: 20 },
  small: { color: C.dim, fontSize: 12, lineHeight: 17 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)' },
  pillText: { color: C.text, fontSize: 15, fontWeight: '600' },
  bottomWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bottom: { alignItems: 'center', gap: 12, padding: 12, paddingBottom: 28 },
  hint: { color: C.text, fontSize: 14, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, overflow: 'hidden' },
  shutterOuter: { width: 82, height: 82, borderRadius: 41, borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.accent },
  input: { minHeight: 48, color: C.text, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, fontSize: 15 },
  ghost: { flex: 1, paddingVertical: 14, borderRadius: 24, borderWidth: 1, borderColor: C.line, alignItems: 'center' },
  btn: { flex: 2, paddingVertical: 14, borderRadius: 24, backgroundColor: C.accent, alignItems: 'center' },
  btnText: { color: '#06281A', fontWeight: '800', fontSize: 15 },
});
