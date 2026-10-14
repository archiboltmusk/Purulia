import { PopButton } from './src/components/Pop';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import AsyncStorage from 'expo-sqlite/kv-store';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { type Draft, type EvidenceMode, type Extra, type Filed, type Fix, fileReport, issueCaptureToken, mapReports, recentReports, rules, newClientId, OfflineError, publicReport, type PublicReport, type Report, reportWarranty, type Rules, type Warranty } from './src/api';
import { EvidenceCamera } from './src/components/EvidenceCamera';
import { MapScreen } from './src/components/MapScreen';
import { MoreSheet } from './src/components/MoreSheet';
import { NearbySheet } from './src/components/NearbySheet';
import { ReportSheet } from './src/components/ReportSheet';
import { SpotForm, type SpotFormId } from './src/components/SpotForm';
import { ResultCard } from './src/components/ResultCard';
import { ReviewSheet } from './src/components/ReviewSheet';
import { TermsGate } from './src/components/TermsGate';
import { C, T } from './src/components/theme';
import { CAPTURE_TOKEN_TTL_MS, MAX_GPS_ACCURACY_M } from './src/config';
import { errorText, loadLang, onLang, st, t } from './src/i18n';
import { fixUsable, watchFix } from './src/location';
import { drain, enqueue, onQueue, onRefused, pendingCount, startQueue } from './src/queue';
import { swr } from './src/cache';
import { snap } from './src/shot';
import { AppError } from './src/supabase';

type Shot = { uri: string; takenAt: string; token: string | null; fix: Fix | null; extras: Extra[] };

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
      <PopButton kind="accent" label={blocked ? t('perm_settings') : t('perm_allow')} onPress={async () => {
        if (blocked) return Linking.openSettings();
        if (!cam.granted) await requestCam();
        if (!loc.granted) await requestLoc();
      }} />
    </SafeAreaView>
  );
}

function Reporter() {
  const camera = useRef<CameraView>(null);
  const token = useRef<{ value: string | null; at: number }>({ value: null, at: 0 });
  const [fix, setFix] = useState<Fix | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [wasteType, setWasteType] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ filed: Filed; row: PublicReport | null; warranty: Warranty | null } | null>(null);
  const [queued, setQueued] = useState(0);
  const [nearby, setNearby] = useState(false);
  const [more, setMore] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [sheetRefresh, setSheetRefresh] = useState(0);
  const [spotForm, setSpotForm] = useState<SpotFormId | null>(null);
  const [evidence, setEvidence] = useState<{ mode: EvidenceMode; report: Report; rules: Rules } | null>(null);

  // GPS and a camera token warm up with the viewfinder, so the shutter waits on neither.
  useEffect(() => watchFix(setFix), []);

  // Warm what the next taps need while the camera is on screen: rules, and the lists
  // (cached on the phone) so Map and Recent open filled in.
  useEffect(() => {
    const idle = setTimeout(() => {
      rules().catch(() => {});
      swr('recent', recentReports, () => {}).catch(() => {});
      swr('map', mapReports, () => {}).catch(() => {});
    }, 1500);
    return () => clearTimeout(idle);
  }, []);
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
    const fixAtShot = fix;
    const capturedToken = token.current.value;
    token.current = { value: null, at: 0 }; // one token per photo
    try {
      const pic = await snap(camera.current);
      if (adding && shot) {
        setShot({ ...shot, extras: [...shot.extras, { ...pic, token: capturedToken }] });
        setAdding(false);
      } else {
        setShot({ ...pic, token: capturedToken, fix: fixAtShot, extras: [] });
      }
    } catch {
      Alert.alert(errorText('generic'));
    } finally {
      refreshToken();
    }
  };

  // iOS can't present a sheet while another one is still sliding away.
  const openReport = (id: string) => {
    setNearby(false);
    setResult(null);
    setTimeout(() => setSheetId(id), Platform.OS === 'ios' ? 450 : 0);
  };

  const reset = () => {
    setShot(null); setCategory(null); setWasteType(null); setAdding(false); setNote(''); setResult(null);
    refreshToken();
  };

  const send = async () => {
    if (!shot || !reportFix || !fixOk) return;
    const draft: Draft = {
      clientId: newClientId(), photoUri: shot.uri, captureToken: shot.token, takenAt: shot.takenAt,
      fix: reportFix, category, note, wasteType, extras: shot.extras,
    };
    setSending(true);
    try {
      const filed = await fileReport(draft);
      const shownId = filed.duplicateOf ?? filed.id;
      const [row, warranty] = filed.moderation === 'approved'
        ? await Promise.all([publicReport(shownId).catch(() => null), reportWarranty(shownId).catch(() => null)])
        : [null, null];
      setShot(null);
      setResult({ filed, row, warranty });
      if (filed.extraFailed) Alert.alert(st('photo_extra_failed', { n: filed.extraFailed }));
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
      {/* One camera at a time: the evidence camera takes over while it is open. */}
      {!evidence && !spotForm && !mapOpen && <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" animateShutter />}
      <SafeAreaView style={s.top} edges={['top']}>
        <View style={{ flexDirection: 'row', gap: 8, marginLeft: 'auto' }}>
          <PopButton kind="secondary" size="small" label={t('map')} onPress={() => setMapOpen(true)} />
          <PopButton kind="secondary" size="small" label={t('nearby')} onPress={() => setNearby(true)} />
          <PopButton kind="secondary" size="small" label={t('more')} onPress={() => setMore(true)} />
        </View>
      </SafeAreaView>

      {(!shot || adding) && !result && (
        <SafeAreaView style={s.bottom} edges={['bottom']}>
          <Text style={[s.gps, { color: fixOk ? C.accent : fix?.mocked ? C.bad : C.warn }]}>{fixMessage}</Text>
          {queued > 0 && (
            <Pressable onPress={retryQueue} hitSlop={8}><Text style={s.queue}>{t('queue_n', { n: queued })}</Text></Pressable>
          )}
          <Pressable onPress={capture} style={s.shutterOuter} accessibilityRole="button" accessibilityLabel={t('shutter_hint')}>
            <View style={s.shutterInner} />
          </Pressable>
          <Text style={s.hint}>{adding ? t('adding_hint') : t('shutter_hint')}</Text>
          {adding && <PopButton kind="secondary" size="small" label={t('adding_done')} onPress={() => setAdding(false)} />}
        </SafeAreaView>
      )}

      {shot && !adding && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <ReviewSheet photoUri={shot.uri} fix={reportFix} fixOk={fixOk} fixMessage={fixMessage}
            category={category} wasteType={wasteType} extras={shot.extras.map((x) => x.uri)} note={note} sending={sending}
            onCategory={(c) => setCategory((p) => (p === c ? null : c))} onWasteType={(w) => setWasteType((p) => (p === w ? null : w))}
            onAddPhoto={() => setAdding(true)} onNote={setNote}
            onRetake={reset} onSend={send} />
        </KeyboardAvoidingView>
      )}

      {result && <ResultCard filed={result.filed} row={result.row} warranty={result.warranty} onDone={reset}
        onOpen={() => openReport(result.filed.duplicateOf ?? result.filed.id)} />}
      {mapOpen && <MapScreen fix={fix} onOpen={setSheetId} onClose={() => setMapOpen(false)} />}
      <NearbySheet visible={nearby} onClose={() => setNearby(false)} onOpen={openReport} />
      <ReportSheet id={evidence ? null : sheetId} refresh={sheetRefresh} onClose={() => setSheetId(null)}
        onEvidence={(mode, report, rules) => setEvidence({ mode, report, rules })} />
      {evidence && <EvidenceCamera {...evidence} onClose={(changed) => {
        setEvidence(null);
        if (changed) setSheetRefresh((n) => n + 1);
      }} />}
      <MoreSheet visible={more} onClose={() => setMore(false)} onForm={(id) => {
        setMore(false);
        setTimeout(() => setSpotForm(id), Platform.OS === 'ios' ? 450 : 0);
      }} />
      {spotForm && <SpotForm id={spotForm} onClose={() => setSpotForm(null)} />}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { justifyContent: 'center', padding: 28, gap: 16 },
  permTitle: { ...T.h1, color: C.text },
  permBody: { ...T.body, color: C.text },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 12, paddingBottom: 28 },
  gps: { ...T.capsS, backgroundColor: 'rgba(13,13,13,0.85)', paddingHorizontal: 12, paddingVertical: 7, overflow: 'hidden' },
  queue: { color: C.text, fontSize: 13, textDecorationLine: 'underline' },
  shutterOuter: { width: 82, height: 82, borderRadius: 41, borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.accent },
  hint: { ...T.small, color: 'rgba(255,255,255,0.85)' },
});
