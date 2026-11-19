/**
 * game controller.
 */

import { factories } from '@strapi/strapi';
import { walletService } from '../../../services/wallet';
import { httpStatusFor, isWalletError, publicMessageFor } from '../../../utils/wallet-errors';

export default factories.createCoreController('api::game.game', ({ strapi }) => ({
  async buy(ctx: any) {
    const user = ctx.state.user;
    if (!user) ctx.throw(401, 'Требуется авторизация');
    const { id } = ctx.params;
    const { reference } = ctx.request.body ?? {};

    try {
      const result = await walletService.purchaseGame(strapi, {
        userId: user.id,
        gameId: String(id),
        reference: reference || `purchase_${user.id}_${id}_${Date.now()}`,
      });
      ctx.body = { data: result };
    } catch (err: unknown) {
      if (isWalletError(err)) {
        ctx.throw(httpStatusFor(err), publicMessageFor(err, 'Не удалось выполнить покупку'));
      }
      strapi.log.error('[wallet] ошибка покупки игры', err);
      ctx.throw(500, 'Не удалось выполнить покупку');
    }
  },

  async library(ctx: any) {
    const user = ctx.state.user;
    if (!user) ctx.throw(401, 'Требуется авторизация');
    const data = await walletService.getLibrary(strapi, user.id, true);
    ctx.body = { data };
  },
}));
