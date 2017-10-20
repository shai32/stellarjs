/**
 * Created by arolave on 23/12/2016.
 */
import size from 'lodash/size';

let enableLogging = true;

export function initLogger() {
  enableLogging = size(process.env.STELLAR_DEBUG_LOGS) // eslint-disable-line better-mutation/no-mutation
        ? process.env.STELLAR_DEBUG_LOGS !== 'false'
        : process.env.NODE_ENV === 'development';
}

const loggerHandler = {
  get: (target, propKey) => {
    const origMethod = target[propKey];
    return function fn(...args) {
      if (enableLogging) {
        return origMethod.apply(target, args);
      }

      return true;
    };
  },
};

initLogger();

export function logger(log) {
  return global.Proxy ? new Proxy(log, loggerHandler) : log;
}
