import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import type { Fix } from '../api';
import { type Key, t } from '../i18n';
import { SlideToSubmit } from './SlideToSubmit';
import { C } from './theme';

// Server categories (kasa_create_report) that need no sub-type pick.
export const CATEGORIES = ['garbage', 'drain', 'road', 'streetlight', 'water', 'toilet', 'other'] as const;

type Props = {
  photoUri: string;
  fix: Fix | null;
  fixOk: boolean;
  fixMessage: string;
  category: string | null;
  note: string;
  sending: boolean;
  onCategory: (c: string) => void;
  onNote: (s: string) => void;
  onRetake: () => void;
  onSend: () => void;
};

export function ReviewSheet(p: Props) {
  return (
    <Animated.View entering={SlideInDown.springify().damping(18)} style={s.sheet}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, gap: 14 }}>
        <View style={s.row}>
          <Image source={{ uri: p.photoUri }} style={s.thumb} />
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[s.gps, { color: p.fixOk ? C.accent : p.fix?.mocked ? C.bad : C.warn }]}>{p.fixMessage}</Text>
            <Pressable onPress={p.onRetake} hitSlop={8}><Text style={s.link}>{t('retake')}</Text></Pressable>
          </View>
        </View>
        <Text style={s.h}>{t('what')}</Text>
        <View style={s.chips}>
          {CATEGORIES.map((c) => (
            <Pressable key={c} onPress={() => p.onCategory(c)}
              style={[s.chip, p.category === c && s.chipOn]} accessibilityState={{ selected: p.category === c }}>
              <Text style={[s.chipText, p.category === c && { color: '#06281A' }]} numberOfLines={1}>{t(('cat_' + c) as Key)}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput value={p.note} onChangeText={p.onNote} placeholder={t('note')} placeholderTextColor={C.dim}
          maxLength={500} multiline style={s.input} />
        <SlideToSubmit label={p.sending ? t('sending') : t('slide')} disabled={!p.fixOk || p.sending} onDone={p.onSend} />
      </ScrollView>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '78%', backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  row: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  thumb: { width: 84, height: 112, borderRadius: 12, backgroundColor: '#222' },
  gps: { fontSize: 14, fontWeight: '600' },
  link: { color: C.dim, fontSize: 14, textDecorationLine: 'underline' },
  h: { color: C.text, fontSize: 17, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: C.line, maxWidth: '100%' },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.text, fontSize: 14 },
  input: { minHeight: 48, color: C.text, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, fontSize: 15 },
});
