export const theme = {
  color: {
    surface: '#F8F8F7',
    onSurface: '#1A1C1B',
    surfaceSecondary: '#FFFFFF',
    onSurfaceSecondary: '#3D413F',
    surfaceTertiary: '#EFF0EC',
    onSurfaceTertiary: '#5A605D',
    surfaceInverse: '#1A1C1B',
    onSurfaceInverse: '#F8F8F7',
    brand: '#2E4F3D',
    brandPrimary: '#2E4F3D',
    onBrandPrimary: '#FFFFFF',
    brandSecondary: '#4D735D',
    brandTertiary: '#E5EBE7',
    onBrandTertiary: '#1C3326',
    success: '#376346',
    warning: '#A87A2B',
    error: '#963B3B',
    info: '#475C51',
    border: '#E6E8E5',
    borderStrong: '#C7CAC6',
    divider: '#E6E8E5',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32, '3xl': 48 },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
  font: {
    sm: 12, base: 14, lg: 16, xl: 20, '2xl': 24, '3xl': 32,
  },
};

export const CATEGORY_COLORS: Record<string, string> = {
  'Food & Dining': '#C25A3A',
  'Transport': '#4A6FA5',
  'Shopping': '#8B5B9F',
  'Groceries': '#5B8A47',
  'Entertainment': '#B85C82',
  'Bills & Utilities': '#A87A2B',
  'Health': '#2F7A78',
  'Transfers': '#6B7280',
  'Uncategorized': '#8A8F8B',
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
