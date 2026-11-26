import type { Plan } from '@econsultor/shared';
import type { Config } from '../config.js';

/**
 * Plan con el que se tratan las funciones de una cuenta:
 *  1. el que se fijó a mano desde el panel del servidor, si lo hay;
 *  2. si no, Premium para todas con PREMIUM_FOR_ALL;
 *  3. si no, el plan guardado en la cuenta.
 */
export const effectivePlan = (cfg: Pick<Config, 'premiumForAll'>, user: { plan: Plan; planOverride?: Plan }): Plan =>
  user.planOverride ?? (cfg.premiumForAll ? 'premium' : user.plan);
