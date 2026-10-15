import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, SectionList, StyleSheet, Switch, Text, View } from 'react-native';
import type { Fix } from '../api';
import { disablePush, enablePush, pushEnabled } from '../push';
import { SITE_URL } from '../config';
import { errorText, type Key, st, t } from '../i18n';
import { AppError } from '../supabase';
import type { FeedbackKind } from './FeedbackForm';
import type { SpotFormId } from './SpotForm';
import { LangSwitch } from './TermsGate';
import { C, T } from './theme';

/* Every website section, opened in the in-app browser so it runs the site's own code
   and server rules. Native screens replace these one by one (see mobile/PARITY.md). */
export type MoreForm = SpotFormId | FeedbackKind | 'school';
type Item = [label: string, page: string, form?: MoreForm];
const site = (items: [Key, string][]): Item[] => items.map(([k, p]) => [t(k), p]);

/* Things you file from where you stand open native forms (SpotForm, SchoolCheck). */
const here = (): Item[] => [
  [st('ad_title'), '', 'adopt'], [st('fd_title'), '', 'feed'], [st('sn_title'), '', 'snake'], [st('sr_title'), '', 'rescuer'],
  [st('pd_title'), '', 'pandal'], [st('wk_title'), '', 'work'], [t('school_check'), '', 'school'],
];

const help = (): Item[] => [[t('fb_bug'), '', 'bug'], [t('fb_fix'), '', 'fix']];

const SECTIONS: { title: Key; items: [Key, string][] }[] = [
  { title: 'grp_places', items: [['sec_kasa', 'kasa.html'], ['sec_ward', 'ward.html'], ['sec_districts', 'districts.html'], ['sec_data', 'data.html']] },
  { title: 'grp_account', items: [['sec_works', 'works.html'], ['sec_promises', 'promises.html'], ['sec_noticeboard', 'noticeboard.html'], ['sec_municipality', 'municipality.html'], ['sec_analytics', 'analytics.html'], ['sec_digest', 'digest.html']] },
  { title: 'grp_services', items: [['sec_schools', 'schools.html'], ['sec_toilets', 'toilets.html'], ['sec_waste', 'waste.html'], ['sec_snakes', 'snakes.html'], ['sec_dogs', 'dogs.html'], ['sec_pandals', 'pandals.html']] },
  { title: 'grp_part', items: [['sec_adopt', 'adopt.html'], ['sec_communities', 'communities.html'], ['sec_routes', 'routes.html'], ['sec_assistant', 'assistant.html'], ['sec_addtown', 'add-town.html'], ['sec_suggest', 'suggest-feature.html'], ['sec_join', 'join.html']] },
  { title: 'grp_about', items: [['sec_circle', 'circle.html'], ['sec_blueprint', 'blueprint.html'], ['sec_methodology', 'methodology.html'], ['sec_rules', 'rules.html'], ['sec_privacy', 'privacy.html'], ['sec_terms', 'terms.html'], ['sec_grievance', 'grievance.html'], ['sec_changelog', 'changelog.html']] },
];

export function openSite(page: string) {
  WebBrowser.openBrowserAsync(SITE_URL + page, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    controlsColor: C.accent,
    toolbarColor: C.bg,
  }).catch(() => {});
}

/* One switch: report alerts within the site's alert radius of where you are now. */
function AlertsRow({ fix }: { fix: Fix | null }) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { pushEnabled().then(setOn); }, []);
  const flip = async (v: boolean) => {
    setBusy(true);
    try {
      if (!v) { await disablePush(); setOn(false); return; }
      if (!fix) return Alert.alert(t('alerts_need_gps'));
      const r = await enablePush(fix);
      if (r === 'on') setOn(true);
      else Alert.alert(r === 'denied' ? t('alerts_denied') : t('alerts_unavailable'));
    } catch (e) {
      Alert.alert(e instanceof AppError ? errorText(e.key, e.vars) : errorText('generic'));
    } finally { setBusy(false); }
  };
  return (
    <View style={s.alerts}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowText}>{t('alerts_title')}</Text>
        <Text style={s.alertsSub}>{t('alerts_sub')}</Text>
      </View>
      <Switch value={on} onValueChange={flip} disabled={busy} trackColor={{ true: C.accentDeep, false: C.line }} thumbColor={on ? C.accent : C.dim} />
    </View>
  );
}

export function MoreSheet({ visible, onClose, onForm, fix }: { visible: boolean; onClose: () => void; onForm: (id: MoreForm) => void; fix: Fix | null }) {
  const data = [{ title: 'grp_here' as Key, data: here() }, ...SECTIONS.map((g) => ({ title: g.title, data: site(g.items) })), { title: 'grp_help' as Key, data: help() }];
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={s.wrap}>
        <View style={s.head}>
          <Text style={s.title}>{t('more')}</Text>
          <Pressable onPress={onClose} hitSlop={10}><Text style={s.link}>{t('close')}</Text></Pressable>
        </View>
        <SectionList sections={data} keyExtractor={([k]) => k} stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          ListHeaderComponent={<View style={{ marginTop: 4 }}><Text style={s.group}>{t('lang')}</Text><LangSwitch /><AlertsRow fix={fix} /></View>}
          renderSectionHeader={({ section }) => <Text style={s.group}>{t(section.title)}</Text>}
          renderItem={({ item: [label, page, form] }) => (
            <Pressable onPress={() => (form ? onForm(form) : openSite(page))} style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]} accessibilityRole="link">
              <Text style={s.rowText}>{label}</Text>
              <Text style={s.chev}>›</Text>
            </Pressable>
          )} />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 20 },
  title: { ...T.h2, color: C.text },
  link: { color: C.text, textDecorationLine: 'underline', fontSize: 14 },
  group: { ...T.caps, color: C.dim, marginTop: 24, marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  rowText: { ...T.bodyM, color: C.text },
  alerts: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  alertsSub: { ...T.small, color: C.dim },
  chev: { color: C.dim, fontSize: 22 },
});
