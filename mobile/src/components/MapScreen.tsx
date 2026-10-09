import { Camera, type CameraRef, GeoJSONSource, Layer, Map, type MapRef, UserLocation } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type Fix, type MapDot, mapReports } from '../api';
import { swr } from '../cache';
import { SITE_URL } from '../config';
import { type Key, st, t } from '../i18n';
import { openSite } from './MoreSheet';
import { PopButton, PopCard } from './Pop';
import { C, T } from './theme';

// Same basemap and boundary files as kasa.html.
const STYLE = 'https://tiles.openfreemap.org/styles/dark';
const DISTRICTS = SITE_URL + 'places/wb_districts.geojson';
const SEATS = SITE_URL + 'places/wb_assembly.geojson';
const WB: [number, number] = [87.9, 23.6];
const DOT: Record<string, string> = { open: C.bad, claimed: C.warn, resolved: C.accent };

type Seat = { name: string; person: string; party: string };
type Leaders = { sources: { mla: string; mp: string }; ac: Record<string, Seat>; pc: Record<string, Seat> };
type Area = { lat: number; lng: number; zoom: number; district?: string; ac?: number; pc?: number };

let leadersCache: Promise<Leaders | null> | null = null;
const leaders = () => (leadersCache ??= fetch(SITE_URL + 'places/wb_leaders.json')
  .then((r) => (r.ok ? r.json() : null)).catch(() => { leadersCache = null; return null; }));

/* The site's map, natively: report dots (tap → report sheet), district and assembly-seat
   outlines (tap → who represents it, from the cited Wikipedia results lists). */
export function MapScreen({ fix, onOpen, onClose }: { fix: Fix | null; onOpen: (id: string) => void; onClose: () => void }) {
  const map = useRef<MapRef>(null);
  const camera = useRef<CameraRef>(null);
  const zoom = useRef(fix ? 13 : 6.5);
  const [dots, setDots] = useState<MapDot[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [area, setArea] = useState<Area | null>(null);
  const [lead, setLead] = useState<Leaders | null>(null);
  const start = useRef(fix ? { center: [fix.lng, fix.lat] as [number, number], zoom: 13 } : { center: WB, zoom: 6.5 });

  useEffect(() => {
    swr('map', mapReports, setDots).catch(() => setFailed(true));
    leaders().then(setLead);
  }, []);

  const data = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: (dots ?? []).map((r) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: { id: r.id, color: DOT[r.status] ?? C.dim },
    })),
  }), [dots]);

  const tapArea = async (lng: number, lat: number, point: [number, number]) => {
    const found = await map.current?.queryRenderedFeatures(point, { layers: ['seat-fill', 'district-fill'] }).catch(() => []) ?? [];
    const seat = found.find((f) => f.properties?.ac != null)?.properties;
    const dist = found.find((f) => f.properties?.district != null)?.properties;
    setArea({ lat, lng, zoom: zoom.current, district: dist?.district, ac: seat?.ac, pc: seat?.pc });
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Map ref={map} style={StyleSheet.absoluteFill} mapStyle={STYLE}
        onRegionDidChange={(e) => { zoom.current = e.nativeEvent.zoom; }}
        onPress={(e) => { const { lngLat, point } = e.nativeEvent; tapArea(lngLat[0], lngLat[1], point); }}>
        <Camera ref={camera} initialViewState={start.current} />
        <GeoJSONSource id="districts" data={DISTRICTS}>
          <Layer id="district-fill" type="fill" paint={{ 'fill-color': '#000000', 'fill-opacity': 0.01 }} />
          <Layer id="district-line" type="line" paint={{ 'line-color': C.accent, 'line-width': 1.2, 'line-opacity': 0.55 }} />
        </GeoJSONSource>
        <GeoJSONSource id="seats" data={SEATS}>
          <Layer id="seat-fill" type="fill" paint={{ 'fill-color': '#000000', 'fill-opacity': 0.01 }} />
          <Layer id="seat-line" type="line" minzoom={8} paint={{ 'line-color': C.white, 'line-width': 0.6, 'line-opacity': 0.3, 'line-dasharray': [2, 2] }} />
        </GeoJSONSource>
        <GeoJSONSource id="reports" data={data} hitbox={{ top: 12, bottom: 12, left: 12, right: 12 }}
          onPress={(e) => {
            const id = e.nativeEvent.features.find((f) => f.properties?.id)?.properties?.id;
            if (!id) return;
            e.stopPropagation();
            setArea(null);
            onOpen(String(id));
          }}>
          <Layer id="report-dots" type="circle" paint={{
            'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 14, 7],
            'circle-stroke-color': C.bg, 'circle-stroke-width': 1,
          }} />
        </GeoJSONSource>
        <UserLocation accuracy />
      </Map>

      <SafeAreaView style={s.top} edges={['top']} pointerEvents="box-none">
        <PopButton kind="secondary" size="small" label={t('close')} onPress={onClose} />
        {fix && <PopButton kind="secondary" size="small" label={t('map_me')}
          onPress={() => camera.current?.flyTo({ center: [fix.lng, fix.lat], zoom: Math.max(zoom.current, 14), duration: 800 })} />}
      </SafeAreaView>

      <SafeAreaView style={s.bottom} edges={['bottom']} pointerEvents="box-none">
        {area ? <AreaCard area={area} lead={lead} onClose={() => setArea(null)} /> : (
          <View style={s.legend}>
            {(['open', 'claimed', 'resolved'] as const).map((k) => (
              <View key={k} style={s.legendItem}><View style={[s.dot, { backgroundColor: DOT[k] }]} /><Text style={s.legendText}>{t(('status_' + k) as Key)}</Text></View>
            ))}
            <Text style={s.hint}>{failed ? t('map_load_fail') : dots ? t('map_hint') : t('loading')}</Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

function AreaCard({ area, lead, onClose }: { area: Area; lead: Leaders | null; onClose: () => void }) {
  const mla = area.ac != null ? lead?.ac[String(area.ac)] : undefined;
  const mp = area.pc != null ? lead?.pc[String(area.pc)] : undefined;
  const at = `kasa.html?at=${area.lat.toFixed(5)},${area.lng.toFixed(5)},${area.zoom.toFixed(1)}`;
  return (
    <PopCard style={{ padding: 16, gap: 8 }}>
      {area.district ? <>
        <Text style={s.title}>{area.district}</Text>
        <Text style={s.sub}>{st('ar_district_sub')}</Text>
      </> : null}
      {mla ? <Rep role={st('ar_mla', { c: mla.name })} seat={mla} /> : null}
      {mp ? <Rep role={st('ar_mp', { c: mp.name })} seat={mp} /> : null}
      {lead && (mla || mp) ? (
        <Text style={s.src}>
          {st('ar_note')}{' '}
          <Text style={s.link} onPress={() => Linking.openURL(lead.sources.mla)}>{st('ar_src_mla')}</Text>{' · '}
          <Text style={s.link} onPress={() => Linking.openURL(lead.sources.mp)}>{st('ar_src_mp')}</Text>
        </Text>
      ) : null}
      <View style={s.cardFoot}>
        <Pressable onPress={() => openSite(at)} hitSlop={8}><Text style={s.link}>{t('map_full')}</Text></Pressable>
        <PopButton kind="ghost" size="small" label={t('close')} onPress={onClose} />
      </View>
    </PopCard>
  );
}

function Rep({ role, seat }: { role: string; seat: Seat }) {
  return (
    <View>
      <Text style={s.sub}>{role}</Text>
      <Text style={s.person}>{seat.person}{seat.party ? ` · ${seat.party}` : ''}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  bottom: { position: 'absolute', left: 16, right: 16, bottom: 16 },
  legend: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, padding: 12, gap: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 8 },
  legendText: { ...T.capsS, color: C.text },
  dot: { width: 10, height: 10, borderRadius: 5 },
  hint: { ...T.small, color: C.dim, width: '100%' },
  title: { ...T.h2, color: C.text },
  sub: { ...T.capsS, color: C.dim },
  person: { ...T.bodyM, color: C.text },
  src: { ...T.small, color: C.dim },
  link: { color: C.text, textDecorationLine: 'underline' },
  cardFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
});
