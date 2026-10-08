import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { C } from './theme';

const KNOB = 56;

/* A slide, not a tap, so a report can't go out by accident. A detent tick fires
   halfway and a heavy thud at the end. */
export function SlideToSubmit({ label, disabled, onDone }: { label: string; disabled?: boolean; onDone: () => void }) {
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  const halfway = useSharedValue(false);
  const max = Math.max(0, width - KNOB - 8);

  const tick = () => Haptics.selectionAsync().catch(() => {});
  const done = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onDone();
  };

  const pan = Gesture.Pan()
    .enabled(!disabled && max > 0)
    .onUpdate((e) => {
      x.value = Math.min(max, Math.max(0, e.translationX));
      const past = x.value > max / 2;
      if (past !== halfway.value) { halfway.value = past; scheduleOnRN(tick); }
    })
    .onEnd(() => {
      if (x.value >= max * 0.92) {
        x.value = withSpring(max);
        scheduleOnRN(done);
      } else {
        x.value = withSpring(0);
      }
      halfway.value = false;
    });

  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const fill = useAnimatedStyle(() => ({ width: x.value + KNOB }));

  return (
    <View style={[s.track, disabled && { opacity: 0.4 }]} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="adjustable" accessibilityLabel={label}
      accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={() => { if (!disabled) done(); }}>
      <Animated.View style={[s.fill, fill]} />
      <Text style={s.label}>{label}</Text>
      <GestureDetector gesture={pan}>
        <Animated.View style={[s.knob, knob]}><Text style={s.arrow}>›</Text></Animated.View>
      </GestureDetector>
    </View>
  );
}

const s = StyleSheet.create({
  track: { height: KNOB + 8, borderRadius: (KNOB + 8) / 2, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', overflow: 'hidden' },
  fill: { position: 'absolute', left: 4, top: 4, bottom: 4, borderRadius: KNOB / 2, backgroundColor: 'rgba(61,220,151,0.25)' },
  label: { position: 'absolute', alignSelf: 'center', color: C.text, fontSize: 16, fontWeight: '600', letterSpacing: 0.3 },
  knob: { position: 'absolute', left: 4, width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  arrow: { color: '#06281A', fontSize: 30, fontWeight: '700', marginTop: -3 },
});
