import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from 'expo-sqlite/kv-store';
import { type PublicReport, recentReports } from '../api';
import { swr } from '../cache';
import { catLabel, type Key, t } from '../i18n';
import { FlagDialog } from './FlagDialog';
import { PopCard } from './Pop';
import { C, T } from './theme';

const HIDDEN_KEY = 'hidden_reports';

/* Other people's reports, with the two controls store review asks for on user content:
   "Report" goes to the moderators (kasa_flag_report), "Hide" removes it from this phone. */
export function NearbySheet({ visible, onClose, onOpen }: { visible: boolean; onClose: () => void; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<PublicReport[] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [flagging, setFlagging] = useState<PublicReport | null>(null);

  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem(HIDDEN_KEY).then((v) => setHidden(new Set(v ? JSON.parse(v) : []))).catch(() => {});
    swr('recent', recentReports, setRows).catch(() => setRows((p) => p ?? []));
  }, [visible]);

  const hide = (id: string) => {
    const next = new Set(hidden).add(id);
    setHidden(next);
    AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])).catch(() => {});
    Alert.alert(t('hidden'));
  };

  const list = (rows ?? []).filter((r) => !hidden.has(r.id));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={s.wrap}>
        <View style={s.head}>
          <Text style={s.title}>{t('nearby')}</Text>
          <Pressable onPress={onClose} hitSlop={10}><Text style={s.link}>{t('close')}</Text></Pressable>
        </View>
        {rows === null ? <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} /> : (
          <FlatList data={list} keyExtractor={(r) => r.id} contentContainerStyle={{ gap: 12, padding: 16 }}
            ListEmptyComponent={<Text style={s.dim}>{t('nearby_empty')}</Text>}
            renderItem={({ item }) => (
              <Pressable onPress={() => onOpen(item.id)} accessibilityRole="button">
              <PopCard style={s.item}>
                {item.photo_url ? <Image source={{ uri: item.photo_url }} style={s.img} /> : null}
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[s.status, { color: item.status === 'resolved' ? C.accent : item.status === 'open' ? C.warn : C.text }]}>
                    {t(('status_' + (item.status === 'pending_verification' ? 'claimed' : item.status)) as Key)}</Text>
                  <Text style={s.cat} numberOfLines={2}>{catLabel(item.category)}</Text>
                  <Text style={s.dim} numberOfLines={1}>
                    {[item.ward_no ? t('res_ward', { n: item.ward_no }) : null, item.local_body, item.block_name].filter(Boolean).join(' · ')}
                  </Text>
                  {item.description ? <Text style={s.desc} numberOfLines={2}>{item.description}</Text> : null}
                  <View style={s.actions}>
                    <Pressable onPress={() => setFlagging(item)} hitSlop={8}><Text style={s.link}>{t('flag')}</Text></Pressable>
                    <Pressable onPress={() => hide(item.id)} hitSlop={8}><Text style={s.link}>{t('hide')}</Text></Pressable>
                  </View>
                </View>
              </PopCard>
              </Pressable>
            )} />
        )}
      </View>
      <FlagDialog reportId={flagging?.id ?? null} onClose={() => setFlagging(null)} />
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 20 },
  title: { ...T.h2, color: C.text },
  item: { flexDirection: 'row', gap: 12, padding: 12 },
  status: { ...T.capsS },
  img: { width: 72, height: 96, backgroundColor: '#222' },
  cat: { ...T.h3, fontSize: 16, color: C.text },
  desc: { ...T.small, color: C.text },
  dim: { ...T.small, color: C.dim },
  actions: { flexDirection: 'row', gap: 20, marginTop: 4 },
  link: { color: C.text, textDecorationLine: 'underline', fontSize: 14 },
});
