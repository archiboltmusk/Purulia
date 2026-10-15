import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { spotRpc } from '../api';
import { errorText, t } from '../i18n';
import { AppError } from '../supabase';
import { PopButton } from './Pop';
import { C, T } from './theme';

export type FeedbackKind = 'bug' | 'fix';

/* "Report a bug" (kasa_bug_submit) and "Suggest a correction" (kasa_suggest_data_fix):
   the same RPCs and the same moderator queues as bug-report.js and source-fix.js. */
export function FeedbackForm({ kind, onClose }: { kind: FeedbackKind; onClose: () => void }) {
  const [what, setWhat] = useState('');
  const [fix, setFix] = useState('');
  const [src, setSrc] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const bug = kind === 'bug';
  const ready = bug ? what.trim().length >= 5 : what.trim().length >= 3 && fix.trim().length >= 3;

  const send = async () => {
    setBusy(true);
    try {
      if (bug) {
        await spotRpc('kasa_bug_submit', {
          p_what: what.trim(), p_email: email.trim() || null, p_page_url: 'app', p_user_agent: `Parishkar app ${Platform.OS} ${Platform.Version}`,
          p_device: `${Platform.OS} ${Platform.Version}`, p_errors: [],
        });
      } else {
        await spotRpc('kasa_suggest_data_fix', {
          p_what: what.trim(), p_correction: fix.trim(), p_source_url: src.trim() || null, p_note: null, p_email: email.trim() || null, p_page: 'app',
        });
      }
      setDone(true);
    } catch (e) {
      Alert.alert(e instanceof AppError ? errorText(e.key, e.vars) : errorText('generic'));
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: string, set: (v: string) => void, opts: { multiline?: boolean; max: number; kb?: 'email-address' | 'url' }) => (
    <View style={{ gap: 6 }}>
      <Text style={s.dim}>{label}</Text>
      <TextInput value={value} onChangeText={set} maxLength={opts.max} multiline={opts.multiline} autoCapitalize="none"
        keyboardType={opts.kb ?? 'default'} placeholderTextColor={C.dim} style={[s.input, opts.multiline && { minHeight: 110, textAlignVertical: 'top' }]} />
    </View>
  );

  return (
    <SafeAreaView style={s.fill}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <View style={s.head}>
            <Text style={s.title}>{bug ? t('fb_bug') : t('fb_fix')}</Text>
            <PopButton kind="secondary" size="small" label={t('close')} onPress={onClose} />
          </View>
          {done ? (
            <>
              <Text style={s.text}>{t('fb_thanks')}</Text>
              <PopButton kind="accent" label={t('done')} onPress={onClose} />
            </>
          ) : (
            <>
              <Text style={s.dim}>{bug ? t('fb_bug_sub') : t('fb_fix_sub')}</Text>
              {field(bug ? t('fb_what_bug') : t('fb_what_fix'), what, setWhat, { multiline: bug, max: bug ? 2000 : 300 })}
              {!bug && field(t('fb_right'), fix, setFix, { multiline: true, max: 1000 })}
              {!bug && field(t('fb_source'), src, setSrc, { max: 300, kb: 'url' })}
              {field(t('fb_email'), email, setEmail, { max: 200, kb: 'email-address' })}
              <PopButton kind="accent" label={t('fb_send')} onPress={send} busy={busy} disabled={!ready || busy} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  body: { padding: 16, gap: 16, paddingBottom: 48 },
  title: { ...T.h2, color: C.text, flex: 1 },
  text: { ...T.body, color: C.text },
  dim: { ...T.small, color: C.dim },
  input: { ...T.body, minHeight: 48, color: C.text, borderWidth: 1, borderColor: C.line, padding: 12 },
});
