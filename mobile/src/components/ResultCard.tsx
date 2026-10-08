import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import type { Filed, PublicReport, Warranty } from '../api';
import { type Key, t } from '../i18n';
import { EDGES, PopButton, PopCard } from './Pop';
import { C, T } from './theme';

/* Everything here comes from the server's answer, the public report row and
   kasa_report_warranty (moderator-approved site boards only). No record, no claim. */
export function ResultCard({ filed, row, warranty, onDone, onOpen }: { filed: Filed; row: PublicReport | null; warranty: Warranty | null; onDone: () => void; onOpen: () => void }) {
  const lines: string[] = [];
  if (filed.duplicateOf) lines.push(t('res_dup'));
  else if (filed.recurrenceOf) lines.push(t('res_recur'));
  lines.push(filed.moderation === 'approved' ? t('res_live') : t('res_review'));
  const place = [row?.ward_no ? t('res_ward', { n: row.ward_no }) : null, row?.local_body, row?.block_name].filter(Boolean).join(' · ');

  return (
    <Animated.View entering={ZoomIn.springify().damping(16)} style={s.card}>
      <PopCard edges={EDGES.accent} style={{ padding: 20, gap: 8 }}>
      <Text style={s.title}>{t('res_title')}</Text>
      {place ? <Text style={s.place}>{place}</Text> : null}
      {row ? <Text style={s.meta}>{t('res_status', { s: t(('status_' + row.status) as Key) })}</Text> : null}
      {lines.map((l) => <Text key={l} style={s.body}>{l}</Text>)}
      <View style={s.works}>
        {warranty ? (
          <>
            <Text style={s.worksName}>{[warranty.work_name, warranty.agency].filter(Boolean).join(' · ')}</Text>
            <Text style={s.body}>{t('works_until', { d: new Date(warranty.warranty_until).toLocaleDateString() })}</Text>
            {warranty.contractor ? <Text style={s.worksText}>{t('works_contractor', { c: warranty.contractor })}</Text> : null}
            <Text style={s.worksText}>{t('works_checked')}</Text>
          </>
        ) : <Text style={s.worksText}>{t('works_none')}</Text>}
      </View>
      <View style={s.actions}>
        {filed.moderation === 'approved' ? (
          <Pressable onPress={onOpen} hitSlop={8}><Text style={s.link}>{t('open_report')}</Text></Pressable>
        ) : <View />}
        <PopButton kind="accent" size="medium" label={t('done')} onPress={onDone} />
      </View>
      </PopCard>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: { position: 'absolute', left: 16, right: 16, bottom: 40 },
  title: { ...T.h2, color: C.accent },
  place: { ...T.h3, color: C.text },
  meta: { ...T.caps, color: C.dim },
  body: { ...T.body, color: C.text },
  works: { marginTop: 4, padding: 12, gap: 4, borderLeftWidth: 3, borderLeftColor: C.warn, backgroundColor: C.raised },
  worksText: { color: C.dim, fontSize: 14 },
  worksName: { color: C.text, fontSize: 15, fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  link: { color: C.text, textDecorationLine: 'underline', fontSize: 15 },
});
