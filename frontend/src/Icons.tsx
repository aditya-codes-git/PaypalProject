import { Activity, ArrowRight, ArrowUp, Check, Clock3, LayoutDashboard, Leaf, MessageSquare, Package, PanelLeftClose, PanelLeftOpen, Plus, RotateCcw, Settings, ShieldCheck, UserRound, WalletCards, X, type LucideIcon } from 'lucide-react';

const icons: Record<string, LucideIcon> = { overview: LayoutDashboard, box: Package, fund: WalletCards, activity: Activity, arrow: ArrowRight, check: Check, clock: Clock3, shield: ShieldCheck, plus: Plus, close: X, leaf: Leaf, reset: RotateCcw, chat: MessageSquare, send: ArrowUp,
  'sidebar-open': PanelLeftOpen, 'sidebar-close': PanelLeftClose, settings: Settings, user: UserRound };
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const Glyph = icons[name] ?? Package;
  return <Glyph size={size} strokeWidth={1.7} aria-hidden="true" />;
}
