/** Emoji de cada categoría para la interfaz sencilla (las propias de la persona usan ✨). */
const EMOJI: Record<string, string> = {
  housing: '🏠', utilities: '💡', insurance: '🛡️', debt: '💳', subscriptions: '📺',
  groceries: '🛒', transport: '🚗', health: '🩺', education: '📚', dining: '🍕',
  leisure: '🎮', shopping: '🛍️', travel: '✈️', other_expense: '✨',
  salary: '💼', freelance: '💻', investments: '📈', gifts: '🎁', refunds: '↩️', other_income: '✨',
};
export const categoryEmoji = (id: string): string => EMOJI[id] ?? '✨';
