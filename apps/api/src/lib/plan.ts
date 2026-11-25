import type { Plan } from '@econsultor/shared';
import type { Config } from '../config.js';

/** Plan con el que se tratan las funciones: con PREMIUM_FOR_ALL todas las cuentas tienen Premium. */
export const effectivePlan = (cfg: Pick<Config, 'premiumForAll'>, plan: Plan): Plan => (cfg.premiumForAll ? 'premium' : plan);
