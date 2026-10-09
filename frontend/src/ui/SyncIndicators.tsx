import React, { useEffect, useRef } from 'react';
import { View, Text, Image, Modal, Animated, Easing, StyleSheet, Platform } from 'react-native';

const MINT = '#5BF0A8';
const native = Platform.OS !== 'web';

/** A ring that revolves. Optional children (e.g. the logo) sit still in the middle. */
export function SpinnerRing({ size = 22, thickness = 3, color = MINT, children }: {
  size?: number; thickness?: number; color?: string; children?: React.ReactNode;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: native }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  const rotate = v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={{
          position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: thickness,
          borderColor: 'rgba(255,255,255,0.12)', borderTopColor: color, borderRightColor: color + '66',
          transform: [{ rotate }],
        }}
      />
      {children}
    </View>
  );
}

/** Five dots that light up one after another. */
export function BlinkDots({ count = 5, color = MINT }: { count?: number; color?: string }) {
  const dots = useRef(Array.from({ length: count }, () => new Animated.Value(0.25))).current;
  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 200),
        Animated.timing(d, { toValue: 1, duration: 260, useNativeDriver: native }),
        Animated.timing(d, { toValue: 0.25, duration: 260, useNativeDriver: native }),
        Animated.delay((count - 1 - i) * 200 + 120),
      ])),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [dots, count]);
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color, opacity: d, transform: [{ scale: d.interpolate({ inputRange: [0.25, 1], outputRange: [0.8, 1.25] }) }] }} />
      ))}
    </View>
  );
}

// Soft light: stacked translucent circles read as a blurred glow on every platform.
function Glow({ size, color, style }: { size: number; color: string; style: object }) {
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      {Array.from({ length: 22 }, (_, i) => 1 - i * 0.04).map((k) => (
        <View key={k} style={{ position: 'absolute', width: size * k, height: size * k, borderRadius: size, backgroundColor: color, opacity: 0.02 }} />
      ))}
    </View>
  );
}

/** Full-screen "working" state: logo inside a revolving ring, dots below, short message. */
export function SyncOverlay({ visible, title = 'Syncing your messages', subtitle = 'Reading your bank alerts on this phone. This only takes a moment.' }: {
  visible: boolean; title?: string; subtitle?: string;
}) {
  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={s.root} testID="sync-overlay">
        <Glow size={440} color="#2BD98A" style={{ top: -150, left: -150 }} />
        <Glow size={360} color="#B8F04A" style={{ bottom: -140, right: -140 }} />
        <SpinnerRing size={132} thickness={4}>
          <Image source={require('@/assets/images/adaptive-icon.png')} style={s.logo} resizeMode="contain" />
        </SpinnerRing>
        <View style={{ marginTop: 34 }}><BlinkDots /></View>
        <Text style={s.title}>{title}</Text>
        <Text style={s.sub}>{subtitle}</Text>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#07100C', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  logo: { width: 84, height: 84 },
  title: { marginTop: 26, fontFamily: 'Outfit_700Bold', fontSize: 22, color: '#FFFFFF', textAlign: 'center', letterSpacing: -0.3 },
  sub: { marginTop: 8, fontFamily: 'Outfit_400Regular', fontSize: 14.5, lineHeight: 21, color: 'rgba(255,255,255,0.65)', textAlign: 'center' },
});
