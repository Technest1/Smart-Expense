import React, { createContext, useContext } from 'react';
import { Text as RNText, TextInput as RNTextInput, TextProps, TextInputProps, StyleSheet, TextStyle } from 'react-native';

// App-wide typography: Outfit has one file per weight, and Android ignores fontWeight on a
// custom font, so map the weight a screen asks for to the matching Outfit family here.
const FAMILY: Record<string, string> = {
  '100': 'Outfit_400Regular', '200': 'Outfit_400Regular', '300': 'Outfit_400Regular', '400': 'Outfit_400Regular',
  normal: 'Outfit_400Regular', '500': 'Outfit_500Medium', '600': 'Outfit_600SemiBold', '700': 'Outfit_700Bold',
  bold: 'Outfit_700Bold', '800': 'Outfit_800ExtraBold', '900': 'Outfit_800ExtraBold',
};

// Nested <Text> inherits its parent's font; only give it a family when it states a weight itself.
const InText = createContext(false);

export const Text = React.forwardRef<RNText, TextProps>(({ style, ...rest }, ref) => {
  const nested = useContext(InText);
  const flat = (StyleSheet.flatten(style) || {}) as TextStyle;
  const family = flat.fontFamily ?? (flat.fontWeight ? FAMILY[String(flat.fontWeight)] : nested ? undefined : FAMILY['400']);
  return (
    <InText.Provider value={true}>
      <RNText ref={ref} {...rest} style={[style, family ? { fontFamily: family, fontWeight: 'normal' } : null]} />
    </InText.Provider>
  );
});
Text.displayName = 'Text';

export const TextInput = React.forwardRef<RNTextInput, TextInputProps>(({ style, ...rest }, ref) => (
  <RNTextInput ref={ref} {...rest} style={[{ fontFamily: FAMILY['400'] }, style]} />
));
TextInput.displayName = 'TextInput';
