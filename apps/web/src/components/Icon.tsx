import type { SVGProps } from 'react';

const P: Record<string, string> = {
  pulse: 'M3 12h4l2.5-7 4 14 2.5-7H21',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  plus: 'M12 5v14M5 12h14',
  chat: 'M4 5h16v11H9.500L4 20.500V5zM8 10h8M8 13h5',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  flame: 'M12 22c4 0 7-2.7 7-6.8 0-3-1.8-5-3.4-6.7-.6-.7-1.2-1.5-1.4-2.5-1.8 1-3 2.6-3.2 4.5-1.2-.8-1.7-2-1.8-3.3C6.5 9 5 11.5 5 15.2 5 19.3 8 22 12 22z',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9zM13.7 21a2 2 0 01-3.4 0',
  lock: 'M6 11V8a6 6 0 1112 0v3M5 11h14v10H5z',
  shield: 'M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3zM9 12l2 2 4-4',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  logout: 'M9 4H5v16h4M16 8l4 4-4 4M20 12H9',
  warn: 'M12 4l10 17H2L12 4zM12 10v5M12 18h.01',
  trophy: 'M8 4h8v6a4 4 0 01-8 0V4zM8 6H4v2a3 3 0 003 3M16 6h4v2a3 3 0 01-3 3M12 14v4M8 20h8',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  refresh: 'M20 11a8 8 0 00-14.5-4M4 4v4h4M4 13a8 8 0 0014.5 4M20 20v-4h-4',
  table: 'M3 5h18v14H3zM3 10h18M9 5v14',
  chart: 'M4 19V5M4 19h16M8 15l3-4 3 2 4-6',
  bug: 'M9 7V6a3 3 0 016 0v1M7 9h10v5a5 5 0 01-10 0V9zM12 9v10M3 12h4M17 12h4M4 6l3 2M20 6l-3 2M4 19l3-2M20 19l-3-2',
  help: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.500a2.500 2.500 0 114 2c-.9.6-1.500 1.100-1.500 2.500M12 17h.01',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5',
  phone: 'M7 3h10v18H7zM11 18h2',
  fingerprint: 'M12 11a2 2 0 00-2 2c0 3-.5 5-1.5 7M12 7a6 6 0 00-6 6c0 1.7-.2 3.3-.7 4.8M17.8 20c.4-1.6.2-3.4.2-5a6 6 0 00-9-5.2M6.5 5.5A9 9 0 0121 13c0 1.3-.1 2.6-.4 3.8M12 15c0 2-.3 3.6-.9 5M14.5 14c.2 2.3-.1 4.3-.9 6',
  // categorías
  home: 'M4 11l8-7 8 7v9H4v-9zM10 20v-6h4v6',
  cart: 'M3 4h2l2.4 11h10.2L20 7H6M9 20h.01M17 20h.01',
  fork: 'M7 3v8M4 3v5a3 3 0 006 0V3M7 11v10M17 21V3c-2.5 1.5-3.5 4-3.5 8h3.5',
  car: 'M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM7 13h.01M17 13h.01',
  heart: 'M12 20s-8-4.7-8-10.5A4.5 4.5 0 0112 7a4.5 4.5 0 018 2.5C20 15.300 12 20 12 20z',
  book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5zM4 19a2 2 0 012-2h13',
  ticket: 'M3 9V6h18v3a2 2 0 000 4v3H3v-3a2 2 0 000-4zM14 6v10',
  bag: 'M5 8h14l-1 12H6L5 8zM9 8V6a3 3 0 016 0v2',
  plane: 'M3 13l18-8-6 15-3-6-9-1zM12 14l9-9',
  mic: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM6 11a6 6 0 0012 0M12 17v4M9 21h6',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4',
  umbrella: 'M3 12a9 9 0 0118 0H3zM12 12v7a2 2 0 004 0',
  card: 'M3 6h18v12H3zM3 10h18M7 15h3',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  wallet: 'M4 7h15a1 1 0 011 1v11H5a2 2 0 01-2-2V6a2 2 0 012-2h12M16 14h.01',
  briefcase: 'M3 8h18v12H3zM9 8V5h6v3M3 13h18',
  trend: 'M3 17l6-6 4 4 8-9M15 6h6v6',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2.500 0-4-1-4-2.500S10 2 12 5c2-3 4-1.500 4 0S14.500 7 12 7z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  // categorías propias (más iconos para elegir)
  dumbbell: 'M3 10v4M6 8v8M9 11h6M18 8v8M21 10v4',
  paw: 'M5.4,8 A1.6,1.6 0 1,0 8.6,8 A1.6,1.6 0 1,0 5.4,8 M8.6,5.5 A1.6,1.6 0 1,0 11.8,5.5 A1.6,1.6 0 1,0 8.6,5.5 M12.2,5.5 A1.6,1.6 0 1,0 15.4,5.5 A1.6,1.6 0 1,0 12.2,5.5 M15.4,8 A1.6,1.6 0 1,0 18.6,8 A1.6,1.6 0 1,0 15.4,8 M7,16 A5,4 0 1,0 17,16 A5,4 0 1,0 7,16',
  music: 'M9 17V4l10-2v13 M3,17 A3,3 0 1,0 9,17 A3,3 0 1,0 3,17 M13,15 A3,3 0 1,0 19,15 A3,3 0 1,0 13,15',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 22, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={P[name]} />
    </svg>
  );
}

export const CATEGORY_ICON: Record<string, IconName> = {
  housing: 'home', utilities: 'bolt', insurance: 'umbrella', debt: 'card', subscriptions: 'repeat',
  groceries: 'cart', transport: 'car', health: 'heart', education: 'book', dining: 'fork',
  leisure: 'ticket', shopping: 'bag', travel: 'plane', other_expense: 'dots',
  salary: 'wallet', freelance: 'briefcase', investments: 'trend', gifts: 'gift', refunds: 'undo', other_income: 'dots',
};
