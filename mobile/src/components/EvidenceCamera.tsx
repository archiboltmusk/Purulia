import { CameraView } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { distanceM, type EvidenceMode, type Extra, type Fix, issueCaptureToken, OfflineError, type Report, type Rules, submitEvidence } from '../api';
import { errorText, st, t } from '../i18n';
import { FIX_MAX_AGE_MS, watchFix } from '../location';
import { snap } from '../shot';
import { AppError } from '../supabase';
import { PopButton } from './Pop';
import { C, T } from './theme';

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
        <PopButton kind="secondary" size="small" label={t('cancel')} onPress={() => onClose(false)} />
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
                <PopButton kind="ghost" label={t('retake')} onPress={() => setShot(null)} disabled={sending} style={{ flex: 1 }} />
                <PopButton kind="accent" label={st('ev_submit_' + mode)} onPress={send} disabled={!loc[0]} busy={sending} style={{ flex: 2 }} />
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
  panel: { alignSelf: 'stretch', padding: 14, gap: 8, backgroundColor: C.card },
  title: { ...T.h3, color: C.text },
  body: { ...T.small, color: C.text },
  small: { ...T.small, fontSize: 12, color: C.dim },
  bottomWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bottom: { alignItems: 'center', gap: 12, padding: 12, paddingBottom: 28 },
  hint: { ...T.small, color: C.text, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden' },
  shutterOuter: { width: 82, height: 82, borderRadius: 41, borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.accent },
  input: { minHeight: 48, color: C.text, borderWidth: 1, borderColor: C.line, padding: 12, fontSize: 15 },
});
