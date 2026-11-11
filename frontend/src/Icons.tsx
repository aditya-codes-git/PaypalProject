import { Activity, ArrowRight, Check, Clock3, LayoutDashboard, Leaf, Package, Plus, RotateCcw, ShieldCheck, WalletCards, X, type LucideIcon } from 'lucide-react';

const icons: Record<string, LucideIcon> = { overview: LayoutDashboard, box: Package, fund: WalletCards, activity: Activity, arrow: ArrowRight, check: Check, clock: Clock3, shield: ShieldCheck, plus: Plus, close: X, leaf: Leaf, reset: RotateCcw };
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const Glyph = icons[name] ?? Package;
  return <Glyph size={size} strokeWidth={1.7} aria-hidden="true" />;
}
