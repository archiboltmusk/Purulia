import * as WebBrowser from 'expo-web-browser';
import { Modal, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SITE_URL } from '../config';
import { type Key, t } from '../i18n';
import { LangSwitch } from './TermsGate';
import { C, T } from './theme';

/* Every website section, opened in the in-app browser so it runs the site's own code
   and server rules. Native screens replace these one by one (see mobile/PARITY.md). */
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

export function MoreSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const data = SECTIONS.map((g) => ({ title: g.title, data: g.items }));
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={s.wrap}>
        <View style={s.head}>
          <Text style={s.title}>{t('more')}</Text>
          <Pressable onPress={onClose} hitSlop={10}><Text style={s.link}>{t('close')}</Text></Pressable>
        </View>
        <SectionList sections={data} keyExtractor={([k]) => k} stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          ListHeaderComponent={<View style={{ marginTop: 4 }}><Text style={s.group}>{t('lang')}</Text><LangSwitch /></View>}
          renderSectionHeader={({ section }) => <Text style={s.group}>{t(section.title)}</Text>}
          renderItem={({ item: [label, page] }) => (
            <Pressable onPress={() => openSite(page)} style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]} accessibilityRole="link">
              <Text style={s.rowText}>{t(label)}</Text>
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
  chev: { color: C.dim, fontSize: 22 },
});
