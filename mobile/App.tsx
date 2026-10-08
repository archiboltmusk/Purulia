import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Location from 'expo-location';
import AsyncStorage from 'expo-sqlite/kv-store';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { type Draft, type Filed, type Fix, fileReport, issueCaptureToken, newClientId, OfflineError, publicReport, type PublicReport } from './src/api';
import { NearbySheet } from './src/components/NearbySheet';
import { ResultCard } from './src/components/ResultCard';
import { ReviewSheet } from './src/components/ReviewSheet';
import { LangSwitch, TermsGate } from './src/components/TermsGate';
import { C } from './src/components/theme';
import { CAPTURE_TOKEN_TTL_MS, MAX_GPS_ACCURACY_M } from './src/config';
import { errorText, loadLang, onLang, t } from './src/i18n';
import { fixUsable, watchFix } from './src/location';
import { drain, enqueue, onQueue, onRefused, pendingCount, startQueue } from './src/queue';
import { AppError } from './src/supabase';

type Shot = { uri: string; takenAt: string; token: string | null; fix: Fix | null };

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Root />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Root() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [ready, setReady] = useState(false);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    const off = onLang(rerender);
    Promise.all([loadLang(), AsyncStorage.getItem('terms_ok')])
      .then(([, ok]) => setAgreed(ok === '1'))
      .finally(() => setReady(true));
    return off;
  }, []);

  if (!ready) return <View style={s.fill} />;
  if (!agreed) {
    return <TermsGate onAgree={() => { AsyncStorage.setItem('terms_ok', '1').catch(() => {}); setAgreed(true); }} />;
  }
  return <Permissions />;
}

function Permissions() {
  const [cam, requestCam] = useCameraPermissions();
  const [loc, requestLoc] = Location.useForegroundPermissions();

  if (!cam || !loc) return <View style={s.fill} />;
  if (cam.granted && loc.granted) return <Reporter />;

  const blocked = (!cam.granted && !cam.canAskAgain) || (!loc.granted && !loc.canAskAgain);
  return (
    <SafeAreaView style={[s.fill, s.center]}>
      <Text style={s.permTitle}>{t('perm_title')}</Text>
      <Text style={s.permBody}>{t('perm_body')}</Text>
      <Pressable style={s.btn} onPress={async () => {
        if (blocked) return Linking.openSettings();
        if (!cam.granted) await requestCam();
        if (!loc.granted) await requestLoc();
      }}>
        <Text style={s.btnText}>{blocked ? t('perm_settings') : t('perm_allow')}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function Reporter() {
  const camera = useRef<CameraView>(null);
  const token = useRef<{ value: string | null; at: number }>({ value: null, at: 0 });
  const [fix, setFix] = useState<Fix | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ filed: Filed; row: PublicReport | null } | null>(null);
  const [queued, setQueued] = useState(0);
  const [nearby, setNearby] = useState(false);

  // GPS and a camera token warm up with the viewfinder, so the shutter waits on neither.
  useEffect(() => watchFix(setFix), []);
  const refreshToken = useCallback(() => {
    if (Date.now() - token.current.at < CAPTURE_TOKEN_TTL_MS && token.current.value) return;
    issueCaptureToken().then((v) => { token.current = { value: v, at: Date.now() }; });
  }, []);
  useEffect(() => { refreshToken(); }, [refreshToken]);

  useEffect(() => {
    const stop = startQueue();
    const refresh = () => pendingCount().then(setQueued).catch(() => {});
    const off = onQueue(refresh);
    refresh();
    return () => { stop(); off(); };
  }, []);

  // The fix at the moment of the shot is what the report uses; a better one that
  // arrives while the sheet is open replaces it only if it is still close in time.
  const reportFix = shot?.fix && fixUsable(shot.fix, MAX_GPS_ACCURACY_M) ? shot.fix : fix;
  const fixOk = fixUsable(reportFix, MAX_GPS_ACCURACY_M);
  const fixMessage = !reportFix ? t('gps_waiting')
    : reportFix.mocked ? t('gps_mocked')
    : reportFix.accuracy > MAX_GPS_ACCURACY_M ? t('gps_weak', { a: Math.round(reportFix.accuracy) })
    : t('gps_ok', { a: Math.round(reportFix.accuracy) });

  const capture = async () => {
    if (!camera.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    const fixAtShot = fix;
    const capturedToken = token.current.value;
    token.current = { value: null, at: 0 }; // one token per photo
    try {
      const pic = await camera.current.takePictureAsync({ quality: 0.8 });
      const takenAt = new Date().toISOString();
      const img = await ImageManipulator.manipulate(pic.uri)
        .resize(pic.width >= pic.height ? { width: 1600 } : { height: 1600 })
        .renderAsync();
      const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
      setShot({ uri: out.uri, takenAt, token: capturedToken, fix: fixAtShot });
    } catch {
      Alert.alert(errorText('generic'));
    } finally {
      refreshToken();
    }
  };

  const reset = () => {
    setShot(null); setCategory(null); setNote(''); setResult(null);
    refreshToken();
  };

  const send = async () => {
    if (!shot || !reportFix || !fixOk) return;
    const draft: Draft = {
      clientId: newClientId(), photoUri: shot.uri, captureToken: shot.token, takenAt: shot.takenAt,
      fix: reportFix, category, note,
    };
    setSending(true);
    try {
      const filed = await fileReport(draft);
      const row = filed.moderation === 'approved' ? await publicReport(filed.duplicateOf ?? filed.id).catch(() => null) : null;
      setShot(null);
      setResult({ filed, row });
    } catch (e) {
      if (e instanceof OfflineError || !(e instanceof AppError)) {
        await enqueue(draft);
        Alert.alert(t('queued'));
        reset();
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        Alert.alert(errorText(e.key, e.vars));
      }
    } finally {
      setSending(false);
    }
  };

  useEffect(() => onRefused((x) => Alert.alert(t('queue_failed', { e: errorText(x.error.key, x.error.vars) }))), []);
  const retryQueue = () => { drain().catch(() => {}); };

  return (
    <View style={s.fill}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" animateShutter />
      <SafeAreaView style={s.top} edges={['top']}>
        <LangSwitch />
        <Pressable onPress={() => setNearby(true)} hitSlop={8} style={s.pill}><Text style={s.pillText}>{t('nearby')}</Text></Pressable>
      </SafeAreaView>

      {!shot && !result && (
        <SafeAreaView style={s.bottom} edges={['bottom']}>
          <Text style={[s.gps, { color: fixOk ? C.accent : fix?.mocked ? C.bad : C.warn }]}>{fixMessage}</Text>
          {queued > 0 && (
            <Pressable onPress={retryQueue} hitSlop={8}><Text style={s.queue}>{t('queue_n', { n: queued })}</Text></Pressable>
          )}
          <Pressable onPress={capture} style={s.shutterOuter} accessibilityRole="button" accessibilityLabel={t('shutter_hint')}>
            <View style={s.shutterInner} />
          </Pressable>
          <Text style={s.hint}>{t('shutter_hint')}</Text>
        </SafeAreaView>
      )}

      {shot && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <ReviewSheet photoUri={shot.uri} fix={reportFix} fixOk={fixOk} fixMessage={fixMessage}
            category={category} note={note} sending={sending}
            onCategory={(c) => setCategory((p) => (p === c ? null : c))} onNote={setNote}
            onRetake={reset} onSend={send} />
        </KeyboardAvoidingView>
      )}

      {result && <ResultCard filed={result.filed} row={result.row} onDone={reset} />}
      <NearbySheet visible={nearby} onClose={() => setNearby(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { justifyContent: 'center', padding: 28, gap: 16 },
  permTitle: { color: C.text, fontSize: 24, fontWeight: '800' },
  permBody: { color: C.text, fontSize: 16, lineHeight: 24 },
  btn: { paddingVertical: 16, borderRadius: 28, backgroundColor: C.accent, alignItems: 'center' },
  btnText: { color: '#06281A', fontSize: 17, fontWeight: '800' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.45)' },
  pillText: { color: C.text, fontSize: 14, fontWeight: '600' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 12, paddingBottom: 28 },
  gps: { fontSize: 14, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, overflow: 'hidden' },
  queue: { color: C.text, fontSize: 13, textDecorationLine: 'underline' },
  shutterOuter: { width: 82, height: 82, borderRadius: 41, borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.accent },
  hint: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
});
