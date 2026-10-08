import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import type { Fix } from '../api';
import { MAX_EXTRA_PHOTOS } from '../config';
import { type Key, st, t } from '../i18n';
import { ISSUE_GROUPS, ISSUE_NOTES } from '../issues';
import { SlideToSubmit } from './SlideToSubmit';
import { Caps, PopChip } from './Pop';
import { C, T } from './theme';

// Server categories (kasa_create_report) that need no sub-type pick.
export const CATEGORIES = ['garbage', 'drain', 'road', 'streetlight', 'water', 'toilet', 'other'] as const;

type Props = {
  photoUri: string;
  fix: Fix | null;
  fixOk: boolean;
  fixMessage: string;
  category: string | null;
  wasteType: string | null;
  extras: string[];
  note: string;
  sending: boolean;
  onCategory: (c: string) => void;
  onWasteType: (w: string) => void;
  onAddPhoto: () => void;
  onNote: (s: string) => void;
  onRetake: () => void;
  onSend: () => void;
};

export function ReviewSheet(p: Props) {
  const [group, setGroup] = useState<string | null>(null);
  return (
    <Animated.View entering={SlideInDown.springify().damping(18)} style={s.sheet}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, gap: 14 }}>
        <View style={s.row}>
          <Image source={{ uri: p.photoUri }} style={s.thumb} />
          {p.extras.map((u) => <Image key={u} source={{ uri: u }} style={s.thumbSmall} />)}
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[s.gps, { color: p.fixOk ? C.accent : p.fix?.mocked ? C.bad : C.warn }]}>{p.fixMessage}</Text>
            <Pressable onPress={p.onRetake} hitSlop={8}><Text style={s.link}>{t('retake')}</Text></Pressable>
            {p.extras.length < MAX_EXTRA_PHOTOS ? (
              <Pressable onPress={p.onAddPhoto} hitSlop={8}>
                <Text style={s.link}>{t('add_photo', { n: p.extras.length + 1, max: MAX_EXTRA_PHOTOS })}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <Caps color={C.text}>{t('what')}</Caps>
        <View style={s.chips}>
          {CATEGORIES.map((c) => (
            <PopChip key={c} label={t(('cat_' + c) as Key)} on={p.category === c} onPress={() => p.onCategory(c)} />
          ))}
        </View>
        <Caps>{t('issue_more')}</Caps>
        {ISSUE_GROUPS.map(([g, icon, list]) => {
          const picked = list.find(([k]) => k === p.wasteType);
          const open = group === g || !!picked;
          return (
            <View key={g} style={{ gap: 8 }}>
              <Pressable onPress={() => setGroup(group === g ? null : g)} hitSlop={4}>
                <Text style={s.group}>{icon} {st('igrp_' + g)}{picked ? ' · ' + st('waste_' + picked[0]) : ''} {open ? '▾' : '▸'}</Text>
              </Pressable>
              {open ? (
                <View style={s.chips}>
                  {list.map(([k, i]) => (
                    <PopChip key={k} label={`${i} ${st('waste_' + k)}`} on={p.wasteType === k} onPress={() => p.onWasteType(k)} />
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
        {p.wasteType && ISSUE_NOTES[p.wasteType] ? <Text style={s.sub}>{st(ISSUE_NOTES[p.wasteType])}</Text> : null}
        <TextInput value={p.note} onChangeText={p.onNote} placeholder={t('note')} placeholderTextColor={C.dim}
          maxLength={500} multiline style={s.input} />
        <SlideToSubmit label={p.sending ? t('sending') : t('slide')} disabled={!p.fixOk || p.sending} onDone={p.onSend} />
      </ScrollView>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '78%', backgroundColor: C.card, borderTopWidth: 3, borderColor: C.accent },
  row: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  thumb: { width: 84, height: 112, backgroundColor: '#222' },
  thumbSmall: { width: 42, height: 56, backgroundColor: '#222' },
  sub: { ...T.small, color: C.dim },
  group: { ...T.bodyM, color: C.text },
  gps: { ...T.capsS },
  link: { color: C.dim, fontSize: 14, textDecorationLine: 'underline' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { minHeight: 48, color: C.text, borderWidth: 1, borderColor: C.line, padding: 12, fontSize: 15 },
});
