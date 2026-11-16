import {
  type Action,
  AR_CORTO_15_FLOR_V1,
  AR_CORTO_15_V1,
  AR_SIN_FLOR_V1,
  AR_STANDARD_V1,
  type PlayerView,
  type RuleSet,
} from '@truco/engine';
import type { ClientMessage, RulesetCode } from '@truco/shared';

export function resolveRulesetByCode(code: RulesetCode): RuleSet {
  switch (code) {
    case 'ar-standard-v1':
      return AR_STANDARD_V1;
    case 'ar-sin-flor-v1':
      return AR_SIN_FLOR_V1;
    case 'ar-corto-15-v1':
      return AR_CORTO_15_V1;
    case 'ar-corto-15-flor-v1':
      return AR_CORTO_15_FLOR_V1;
  }
}

export function mapClientMessageToEngineAction(
  message: ClientMessage,
  seat: number,
  view: PlayerView,
): Action | null {
  switch (message.type) {
    case 'game.playCard':
      return {
        type: 'PLAY_CARD',
        seat,
        cardId: message.payload
          .cardId as `${1 | 2 | 3 | 4 | 5 | 6 | 7 | 10 | 11 | 12}-${'espadas' | 'bastos' | 'oros' | 'copas'}`,
      };

    case 'game.foldHand':
      return { type: 'FOLD_HAND', seat };

    case 'game.signal':
      return { type: 'SEND_SIGNAL', seat, signalId: message.payload.signalId };

    case 'game.call': {
      const bid = message.payload.type;
      if (bid === 'ENVIDO' || bid === 'REAL_ENVIDO' || bid === 'FALTA_ENVIDO') {
        return { type: 'CALL_ENVIDO', seat, bid };
      }
      if (bid === 'FLOR' || bid === 'CONTRAFLOR' || bid === 'CONTRAFLOR_AL_RESTO') {
        return { type: 'CALL_FLOR', seat, bid };
      }
      return { type: 'CALL_TRUCO', seat, bid };
    }

    case 'game.respond': {
      const { call, answer, raiseTo } = message.payload;

      if (answer === 'SUBIR') {
        if (call === 'TRUCO') {
          if (raiseTo === 'RETRUCO' || raiseTo === 'VALE_CUATRO') {
            return { type: 'CALL_TRUCO', seat, bid: raiseTo };
          }
          const legalTrucoRaise = view.legalActions.find(
            (a): a is Extract<Action, { type: 'CALL_TRUCO' }> => a.type === 'CALL_TRUCO',
          );
          return legalTrucoRaise ?? null;
        }

        if (call === 'ENVIDO') {
          if (raiseTo === 'ENVIDO' || raiseTo === 'REAL_ENVIDO' || raiseTo === 'FALTA_ENVIDO') {
            return { type: 'CALL_ENVIDO', seat, bid: raiseTo };
          }
          const legalEnvidoRaise = view.legalActions.find(
            (a): a is Extract<Action, { type: 'CALL_ENVIDO' }> => a.type === 'CALL_ENVIDO',
          );
          return legalEnvidoRaise ?? null;
        }

        if (raiseTo === 'CONTRAFLOR' || raiseTo === 'CONTRAFLOR_AL_RESTO') {
          return { type: 'CALL_FLOR', seat, bid: raiseTo };
        }
        const legalFlorRaise = view.legalActions.find(
          (a): a is Extract<Action, { type: 'CALL_FLOR' }> => a.type === 'CALL_FLOR',
        );
        return legalFlorRaise ?? null;
      }

      if (call === 'ENVIDO') {
        if (answer === 'QUIERO' || answer === 'NO_QUIERO') {
          return { type: 'RESPOND_ENVIDO', seat, decision: answer };
        }
        return null;
      }

      if (call === 'TRUCO') {
        if (answer === 'QUIERO' || answer === 'NO_QUIERO') {
          return { type: 'RESPOND_TRUCO', seat, decision: answer };
        }
        return null;
      }

      // call === 'FLOR'
      if (answer === 'CON_FLOR_QUIERO' || answer === 'QUIERO') {
        return { type: 'RESPOND_FLOR', seat, decision: 'CON_FLOR_QUIERO' };
      }
      if (answer === 'ACHICO' || answer === 'NO_QUIERO') {
        return { type: 'RESPOND_FLOR', seat, decision: 'ACHICO' };
      }
      return null;
    }

    default:
      return null;
  }
}
