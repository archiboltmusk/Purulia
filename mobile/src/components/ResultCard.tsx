import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import type { Filed, PublicReport } from '../api';
import { SITE_URL } from '../config';
import { type Key, t } from '../i18n';
import { C } from './theme';

/* Everything here comes from the server's answer or the public report row. Works,
   contractors and warranty periods appear only once a moderator-confirmed works
   record exists; there is no such table yet, so the card says so plainly. */
export function ResultCard({ filed, row, onDone }: { filed: Filed; row: PublicReport | null; onDone: () => void }) {
  const lines: string[] = [];
  if (filed.duplicateOf) lines.push(t('res_dup'));
  else if (filed.recurrenceOf) lines.push(t('res_recur'));
  lines.push(filed.moderation === 'approved' ? t('res_live') : t('res_review'));
  const place = [row?.ward_no ? t('res_ward', { n: row.ward_no }) : null, row?.local_body, row?.block_name].filter(Boolean).join(' · ');
  const link = `${SITE_URL}kasa.html?report=${encodeURIComponent(filed.duplicateOf ?? filed.id)}`;

  return (
    <Animated.View entering={ZoomIn.springify().damping(16)} style={s.card}>
      <Text style={s.title}>{t('res_title')}</Text>
      {place ? <Text style={s.place}>{place}</Text> : null}
      {row ? <Text style={s.meta}>{t('res_status', { s: t(('status_' + row.status) as Key) })}</Text> : null}
      {lines.map((l) => <Text key={l} style={s.body}>{l}</Text>)}
      <View style={s.works}><Text style={s.worksText}>{t('works_none')}</Text></View>
      <View style={s.actions}>
        {filed.moderation === 'approved' ? (
          <Pressable onPress={() => Linking.openURL(link)} hitSlop={8}><Text style={s.link}>{t('open_site')}</Text></Pressable>
        ) : <View />}
        <Pressable onPress={onDone} style={s.done}><Text style={s.doneText}>{t('done')}</Text></Pressable>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: { position: 'absolute', left: 16, right: 16, bottom: 40, padding: 20, gap: 8, borderRadius: 24, backgroundColor: C.card, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  title: { color: C.accent, fontSize: 22, fontWeight: '800' },
  place: { color: C.text, fontSize: 16, fontWeight: '600' },
  meta: { color: C.dim, fontSize: 14 },
  body: { color: C.text, fontSize: 15, lineHeight: 21 },
  works: { marginTop: 4, padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)' },
  worksText: { color: C.dim, fontSize: 14 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  link: { color: C.text, textDecorationLine: 'underline', fontSize: 15 },
  done: { paddingHorizontal: 22, paddingVertical: 12, borderRadius: 22, backgroundColor: C.accent },
  doneText: { color: '#06281A', fontWeight: '700', fontSize: 15 },
});
