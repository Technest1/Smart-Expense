export const theme = {
  color: {
    surface: '#07100C',
    onSurface: '#F1F6F3',
    surfaceSecondary: '#0F1A14',
    onSurfaceSecondary: '#C5D2CB',
    surfaceTertiary: '#17241C',
    onSurfaceTertiary: '#8FA399',
    surfaceInverse: '#1A2B22',
    onSurfaceInverse: '#F1F6F3',
    brand: '#5BF0A8',
    brandPrimary: '#5BF0A8',
    onBrandPrimary: '#06140D',
    brandSecondary: '#3DCB8A',
    brandTertiary: 'rgba(91,240,168,0.14)',
    onBrandTertiary: '#BFF7DB',
    success: '#4ADE9A',
    warning: '#F5B84B',
    error: '#FF7B7B',
    info: '#8FB8A4',
    border: 'rgba(255,255,255,0.08)',
    borderStrong: 'rgba(255,255,255,0.18)',
    divider: 'rgba(255,255,255,0.06)',
    warningSurface: 'rgba(245,184,75,0.12)',
    warningBorder: 'rgba(245,184,75,0.34)',
    warningText: '#F8D38A',
    errorSurface: 'rgba(255,123,123,0.12)',
    errorBorder: 'rgba(255,123,123,0.34)',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32, '3xl': 48 },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
  fontFamily: {
    regular: 'Outfit_400Regular', medium: 'Outfit_500Medium', semibold: 'Outfit_600SemiBold',
    bold: 'Outfit_700Bold', extrabold: 'Outfit_800ExtraBold',
  },
  font: {
    sm: 12, base: 14, lg: 16, xl: 20, '2xl': 24, '3xl': 32,
  },
};

export const CATEGORY_COLORS: Record<string, string> = {
  'Food & Dining': '#FF8F6B',
  'Transport': '#6EA8FF',
  'Shopping': '#C08BFF',
  'Groceries': '#6FD98A',
  'Entertainment': '#FF7FB0',
  'Bills & Utilities': '#F5B84B',
  'Health': '#4FD1C5',
  'Transfers': '#9CA3AF',
  'Uncategorized': '#7B8A82',
};

export const CATEGORY_ICONS: Record<string, any> = {
  'Food & Dining': 'fast-food-outline',
  'Transport': 'car-outline',
  'Shopping': 'bag-handle-outline',
  'Groceries': 'basket-outline',
  'Entertainment': 'film-outline',
  'Bills & Utilities': 'receipt-outline',
  'Health': 'medical-outline',
  'Transfers': 'swap-horizontal-outline',
  'Uncategorized': 'ellipsis-horizontal-outline',
};

export function formatINR(n: number): string {
  const abs = Math.abs(n);
  return '₹' + abs.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Payment-mode fallback labels — shown only when the parser couldn't find a real
// merchant name (backend keeps merchant = "Unknown" in that case so dedup logic
// stays untouched; this is purely a display-layer improvement).
const PAYMENT_MODE_LABELS: Record<string, { debit: string; credit: string }> = {
  upi: { debit: 'UPI Payment', credit: 'UPI Received' },
  atm: { debit: 'ATM Withdrawal', credit: 'ATM Withdrawal' },
  neft: { debit: 'NEFT Transfer', credit: 'NEFT Received' },
  imps: { debit: 'IMPS Transfer', credit: 'IMPS Received' },
  rtgs: { debit: 'RTGS Transfer', credit: 'RTGS Received' },
  cheque: { debit: 'Cheque Payment', credit: 'Cheque Deposit' },
  card: { debit: 'Card Payment', credit: 'Card Refund' },
  other: { debit: 'Bank Transfer', credit: 'Bank Credit' },
};

export function displayMerchant(t: { merchant: string; payment_mode?: string | null; direction: 'debit' | 'credit' }): string {
  if (t.merchant && t.merchant !== 'Unknown') return t.merchant;
  const labels = PAYMENT_MODE_LABELS[t.payment_mode || 'other'] || PAYMENT_MODE_LABELS.other;
  return t.direction === 'credit' ? labels.credit : labels.debit;
}
