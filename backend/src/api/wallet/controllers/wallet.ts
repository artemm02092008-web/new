/**
 * wallet controller — вся логика денежных операций.
 * Пользователь проверяется здесь (jwt users-permissions).
 *
 * Тексты ошибок публичные: баланс, суммы и внутренние детали уходят только в лог.
 * Коды: 401 — нет авторизации, 402 — недостаточно средств, 409 — конфликт
 * состояния, 422 — некорректные данные, 500 — внутренняя ошибка.
 */

import { walletService } from '../../../services/wallet';
import {
  httpStatusFor,
  publicMessageFor,
  walletError,
  isWalletError,
} from '../../../utils/wallet-errors';

const MAX_DEPOSIT = 1_000_000;

function requireUser(ctx: any) {
  const user = ctx.state.user;
  if (!user) ctx.throw(401, 'Требуется авторизация');
  return user;
}

function parsePositiveAmount(ctx: any, amount: unknown): number {
  const parsed = Number(amount);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    const err = walletError('invalidInput', { field: 'amount' });
    throw err;
  }
  return parsed;
}

/** Единый обработчик: код и публичный текст без внутренней логики. */
function fail(ctx: any, err: unknown, fallback: string) {
  if (isWalletError(err)) {
    ctx.throw(httpStatusFor(err), publicMessageFor(err, fallback));
  }
  strapi.log.error(`[wallet] ${fallback}`, err);
  ctx.throw(500, fallback);
}

export default {
  async me(ctx: any) {
    const user = requireUser(ctx);
    const wallet = await walletService.ensureWallet(strapi, user.id);
    const transactions = await strapi.db.query('api::transaction.transaction').findMany({
      where: { wallet: { id: wallet.id } },
      orderBy: { createdAt: 'desc' },
      limit: 50,
    });
    ctx.body = { data: { ...wallet, transactions } };
  },

  async deposit(ctx: any) {
    const user = requireUser(ctx);
    const { amount, reference } = ctx.request.body ?? {};

    let parsed: number;
    try {
      parsed = parsePositiveAmount(ctx, amount);
    } catch (err) {
      fail(ctx, err, 'Некорректная сумма');
      return;
    }
    if (parsed > MAX_DEPOSIT) {
      fail(
        ctx,
        walletError('limitExceeded', { amount: parsed, max: MAX_DEPOSIT }),
        'Некорректная сумма'
      );
      return;
    }

    try {
      const result = await walletService.deposit(strapi, {
        userId: user.id,
        amount: parsed,
        reference: reference || `deposit_${user.id}_${Date.now()}`,
      });
      ctx.body = { data: result };
    } catch (err) {
      fail(ctx, err, 'Не удалось выполнить пополнение');
    }
  },

  async withdraw(ctx: any) {
    const user = requireUser(ctx);
    const { amount, reference } = ctx.request.body ?? {};

    let parsed: number;
    try {
      parsed = parsePositiveAmount(ctx, amount);
    } catch (err) {
      fail(ctx, err, 'Некорректная сумма');
      return;
    }

    try {
      const result = await walletService.withdraw(strapi, {
        userId: user.id,
        amount: parsed,
        reference: reference || `withdraw_${user.id}_${Date.now()}`,
      });
      ctx.body = { data: result };
    } catch (err) {
      fail(ctx, err, 'Не удалось выполнить списание');
    }
  },

  async purchase(ctx: any) {
    const user = requireUser(ctx);
    const { gameId, reference } = ctx.request.body ?? {};
    if (!gameId) {
      fail(ctx, walletError('invalidInput', { field: 'gameId' }), 'Некорректный запрос');
      return;
    }

    try {
      const result = await walletService.purchaseGame(strapi, {
        userId: user.id,
        gameId: String(gameId),
        reference: reference || `purchase_${user.id}_${gameId}_${Date.now()}`,
      });
      ctx.body = { data: result };
    } catch (err) {
      fail(ctx, err, 'Не удалось выполнить покупку');
    }
  },

  async library(ctx: any) {
    const user = requireUser(ctx);
    const items = await walletService.getLibrary(strapi, user.id, true);
    ctx.body = { data: items };
  },

  async reverse(ctx: any) {
    requireUser(ctx);
    const { reference } = ctx.request.body ?? {};
    if (!reference) {
      fail(ctx, walletError('invalidInput', { field: 'reference' }), 'Некорректный запрос');
      return;
    }

    try {
      const result = await walletService.reverseTransaction(strapi, reference);
      ctx.body = { data: result };
    } catch (err) {
      fail(ctx, err, 'Не удалось выполнить возврат');
    }
  },
};
