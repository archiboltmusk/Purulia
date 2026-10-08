import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { FLAG_REASONS, flagReport } from '../api';
import { errorText, type Key, t } from '../i18n';
import { AppError } from '../supabase';
import { C } from './theme';

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
        <View style={s.dialog}>
          <Text style={s.title}>{t('flag_title')}</Text>
          {FLAG_REASONS.map((r) => (
            <Pressable key={r} onPress={() => send(r)} style={s.reason}><Text style={s.reasonText}>{t(('fr_' + r) as Key)}</Text></Pressable>
          ))}
          <Pressable onPress={onClose} style={s.reason}><Text style={s.dim}>{t('cancel')}</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: C.card, borderRadius: 20, padding: 18, gap: 4 },
  title: { color: C.text, fontSize: 20, fontWeight: '800' },
  reason: { paddingVertical: 12 },
  reasonText: { color: C.text, fontSize: 16 },
  dim: { color: C.dim, fontSize: 13 },
});
