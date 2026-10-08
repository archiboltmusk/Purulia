import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SITE_URL } from '../config';
import { getLang, LANG_NAMES, LANGS, setLang, t } from '../i18n';
import { PopButton, PopChip } from './Pop';
import { C, T } from './theme';

/* Shown once before the camera: the content rules and the full terms (needed for
   store review of an app with user-posted content). */
export function TermsGate({ onAgree }: { onAgree: () => void }) {
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={s.wrap}>
      <LangSwitch />
      <Text style={s.brand}>Parishkar</Text>
      <Text style={s.title}>{t('terms_title')}</Text>
      <Text style={s.body}>{t('terms_body')}</Text>
      <Pressable onPress={() => Linking.openURL(SITE_URL + 'terms.html')} hitSlop={8}><Text style={s.link}>{t('terms_read')}</Text></Pressable>
      <PopButton kind="accent" label={t('terms_agree')} onPress={onAgree} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

export function LangSwitch() {
  return (
    <View style={s.langs} accessibilityLabel={t('lang')}>
      {LANGS.map((l) => (
        <PopChip key={l} label={LANG_NAMES[l]} on={getLang() === l} onPress={() => setLang(l)} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 28, gap: 16 },
  brand: { ...T.h1, fontSize: 34, lineHeight: 40, color: C.accent },
  title: { ...T.h2, color: C.text },
  body: { ...T.body, color: C.text },
  link: { color: C.text, textDecorationLine: 'underline', fontSize: 15 },
  langs: { flexDirection: 'row', gap: 8 },
});
