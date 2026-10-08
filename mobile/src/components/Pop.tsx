import * as Haptics from 'expo-haptics';
import type React from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { C, EDGE, T } from './theme';

export type Edges = { right: string; bottom: string };
export const EDGES = {
  white: { right: C.whiteEdgeRight, bottom: C.whiteEdgeBottom },
  dark: { right: C.darkEdgeRight, bottom: C.darkEdgeBottom },
  accent: { right: C.accentEdge, bottom: C.accentDeep },
} satisfies Record<string, Edges>;

/* The NeoPOP "plunk": a right and a bottom face, skewed 45° so the corners bevel.
   Lives in a box with EDGE px of room on the right and bottom. */
function Plunk({ edges, style }: { edges: Edges; style?: React.ComponentProps<typeof Animated.View>['style'] }) {
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <View style={[s.right, { backgroundColor: edges.right }]} />
      <View style={[s.bottom, { backgroundColor: edges.bottom }]} />
    </Animated.View>
  );
}

/* An elevated card: flat face, plunk edges, no rounded corners. */
export function PopCard({ children, edges = EDGES.dark, face = C.card, style }: { children: ReactNode; edges?: Edges; face?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={{ paddingRight: EDGE, paddingBottom: EDGE }}>
      <Plunk edges={edges} />
      <View style={[{ backgroundColor: face, padding: 16, gap: 8 }, style]}>{children}</View>
    </View>
  );
}

type Kind = 'primary' | 'secondary' | 'accent' | 'ghost';
const FACES: Record<Kind, { bg: string; fg: string; edges: Edges | null; border?: string }> = {
  primary: { bg: C.white, fg: C.ink, edges: EDGES.white },
  accent: { bg: C.accent, fg: C.ink, edges: EDGES.accent },
  secondary: { bg: C.bg, fg: C.text, edges: EDGES.dark, border: C.white },
  ghost: { bg: 'transparent', fg: C.text, edges: null, border: C.line },
};

/* NeoPOP button: on press the face sinks into its edges (120 ms), with a light tick. */
export function PopButton({ label, onPress, kind = 'primary', size = 'big', disabled, busy, style, accessibilityLabel }: {
  label: string; onPress: () => void; kind?: Kind; size?: 'big' | 'medium' | 'small'; disabled?: boolean; busy?: boolean;
  style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  const f = FACES[kind];
  const down = useSharedValue(0);
  const face = useAnimatedStyle(() => ({ transform: [{ translateX: down.value * EDGE }, { translateY: down.value * EDGE }] }));
  const edge = useAnimatedStyle(() => ({ opacity: 1 - down.value }));
  const height = size === 'big' ? 50 : size === 'medium' ? 40 : 32;
  const off = disabled || busy;
  return (
    <Pressable disabled={off} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!off }}
      onPressIn={() => { down.value = withTiming(1, { duration: 120 }); }}
      onPressOut={() => { down.value = withTiming(0, { duration: 120 }); }}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={[{ paddingRight: f.edges ? EDGE : 0, paddingBottom: f.edges ? EDGE : 0, opacity: off && !busy ? 0.45 : 1 }, style]}>
      {f.edges ? <Plunk edges={f.edges} style={edge} /> : null}
      <Animated.View style={[s.face, { height, backgroundColor: f.bg, paddingHorizontal: size === 'small' ? 14 : 22 },
        f.border ? { borderWidth: 1, borderColor: f.border } : null, face]}>
        {busy ? <ActivityIndicator color={f.fg} />
          : <Text style={[size === 'small' ? T.capsS : T.caps, { color: f.fg }]} numberOfLines={1}>{label}</Text>}
      </Animated.View>
    </Pressable>
  );
}

/* Square selectable tag: outline when off, white face with black text when on. */
export function PopChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={[s.chip, on && { backgroundColor: C.white, borderColor: C.white }]}>
      <Text style={[T.small, { color: on ? C.ink : C.text, fontWeight: on ? '700' : '500' }]}>{label}</Text>
    </Pressable>
  );
}

/* Section label: caps, wide tracking, dim. */
export function Caps({ children, color = C.dim }: { children: ReactNode; color?: string }) {
  return <Text style={[T.caps, { color }]}>{children}</Text>;
}

const s = StyleSheet.create({
  right: { position: 'absolute', top: 0, right: 0, bottom: EDGE, width: EDGE, transform: [{ skewY: '45deg' }], transformOrigin: 'left top' },
  bottom: { position: 'absolute', left: 0, right: EDGE, bottom: 0, height: EDGE, transform: [{ skewX: '45deg' }], transformOrigin: 'left top' },
  face: { alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: C.line },
});
