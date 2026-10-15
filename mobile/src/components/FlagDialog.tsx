import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { FLAG_REASONS, flagReport } from '../api';
import { errorText, type Key, t } from '../i18n';
import { AppError } from '../supabase';
import { EDGES, PopCard } from './Pop';
import { C, T } from './theme';

/* "Report" on someone's report: the site's flag reasons, sent to the moderators. */
export function FlagDialog({ reportId, onClose }: { reportId: string | null; onClose: () => void }) {
  const send = async (reason: (typeof FLAG_REASONS)[number]) => {
    const id = reportId;
    onClose();
    if (!id) return;
    try {
      await flagReport(id, reason);
      Alert.alert(t('flag_sent'));
    } catch (e) {
      Alert.alert(e instanceof AppError ? errorText(e.key, e.vars) : errorText('generic'));
    }
  };
  return (
    <Modal visible={!!reportId} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.scrim}>
        <PopCard edges={EDGES.white} style={s.dialog}>
          <Text style={s.title}>{t('flag_title')}</Text>
          {FLAG_REASONS.map((r) => (
            <Pressable key={r} onPress={() => send(r)} style={s.reason}><Text style={s.reasonText}>{t(('fr_' + r) as Key)}</Text></Pressable>
          ))}
          <Pressable onPress={onClose} style={s.reason}><Text style={s.dim}>{t('cancel')}</Text></Pressable>
        </PopCard>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  dialog: { padding: 18, gap: 0 },
  title: { ...T.h3, color: C.text, marginBottom: 6 },
  reason: { paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  reasonText: { ...T.bodyM, color: C.text },
  dim: { ...T.caps, color: C.dim },
});
