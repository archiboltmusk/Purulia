import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SITE_URL } from '../config';
import { getLang, LANG_NAMES, LANGS, setLang, t } from '../i18n';
import { C } from './theme';

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
      <Pressable onPress={onAgree} style={s.btn}><Text style={s.btnText}>{t('terms_agree')}</Text></Pressable>
    </ScrollView>
  );
}

export function LangSwitch() {
  return (
    <View style={s.langs} accessibilityLabel={t('lang')}>
      {LANGS.map((l) => (
        <Pressable key={l} onPress={() => setLang(l)} hitSlop={6} style={[s.lang, getLang() === l && s.langOn]}>
          <Text style={[s.langText, getLang() === l && { color: '#06281A' }]}>{LANG_NAMES[l]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 28, gap: 16 },
  brand: { color: C.accent, fontSize: 30, fontWeight: '900' },
  title: { color: C.text, fontSize: 22, fontWeight: '700' },
  body: { color: C.text, fontSize: 16, lineHeight: 24 },
  link: { color: C.text, textDecorationLine: 'underline', fontSize: 15 },
  btn: { marginTop: 8, paddingVertical: 16, borderRadius: 28, backgroundColor: C.accent, alignItems: 'center' },
  btnText: { color: '#06281A', fontSize: 17, fontWeight: '800' },
  langs: { flexDirection: 'row', gap: 8 },
  lang: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: C.line },
  langOn: { backgroundColor: C.accent, borderColor: C.accent },
  langText: { color: C.text, fontSize: 13 },
});
