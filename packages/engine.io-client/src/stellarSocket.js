/**
 * Created by arolave on 15/06/2017.
 */
import Promise from 'bluebird';
import qs from 'qs';
import assign from 'lodash/assign';
import forEach from 'lodash/forEach';
import { stellarRequest, configureStellar, StellarError } from '@stellarjs/core';
import transportFactory from '@stellarjs/transport-socket';
import { runSync as uuidSourceGenerator } from '@stellarjs/core/lib-es6/source-generators/uuid';

const MAX_RETRIES = 300;
const RECONNECT_INTERVAL = 3000;
const MAX_RECONNECT_INTERVAL = 20000;

const log = console;

function _calcNextDelay(maxDelay, delay) {
  const nextDelay = delay * 1.25;
  if (nextDelay > maxDelay) {
    return maxDelay;
  }

  return nextDelay;
}

function stellarSocketFactory(eio) {
  configureStellar({ log, transportFactory });
  log.info('@StellarClient initialized');

  return {
    socket: null,
    handlers: {},
    state: 'disconnected',
    connectedOnce: false,
    userId: null,
    stellar: null,
    tryToReconnect: true,

    // A function that keeps trying, "toTry" until it returns true or has
    // tried "max" number of times. First retry has a delay of "delay".
    // "callback" is called upon success.
    _exponentialBackoff(toTry, max, delay, maxDelay, callback) {
      log.info(`max:${max}, next delay: ${delay}, tryToReconnect: ${this.tryToReconnect}`);
      if (!this.tryToReconnect) {
        return;
      }

      toTry()
      .then((result) => {
        if (callback) {
          return callback(result);
        }
        return undefined;
      })
      .catch(() => {
        if (max > 0) {
          setTimeout(() => {
            const nextDelay = _calcNextDelay(maxDelay, delay);
            this._exponentialBackoff(toTry, max - 1, nextDelay, callback);
          }, delay);
        } else {
          log.info('reconnect: giving up');
        }
      });
    },

    _reconnect(url, options) {
      log.info(`@StellarEngineIO: Reconnecting`);
      this._exponentialBackoff(() => this._doConnect(url, options), MAX_RETRIES, RECONNECT_INTERVAL, MAX_RECONNECT_INTERVAL);
    },

    on(event, handler) {
      if (!this.handlers[event]) {
        this.handlers[event] = [];
      }
      this.handlers[event] = this.handlers[event].concat([handler]);
    },
    trigger(event) {
      if (event && this.handlers[event]) {
        forEach(this.handlers[event], (handler) => {
          handler();
        });
      }
    },
    connect(url, options = {}) {
      log.info(`@StellarEngineIO.connect`);

      this.tryToReconnect = options.tryToReconnect !== false;

      this.options = options;
      return this
        ._closeIfNeeded()
        .then(() => {
          this.connectedOnce = false;
          return this._doConnect(url, options);
        })
        .then((result) => {
          log.info(`@StellarEngineIO connection success`);
          return result;
        })
        .catch((e) => {
          log.info(`@StellarEngineIO connection failed`);
          if (this.tryToReconnect) {
            return this._reconnect(url, options);
          }
          throw e;
        });
    },
    _closeIfNeeded() {
      return new Promise((resolve) => {
        try {
          if (!this.stellar) {
            const stellarOptions = typeof window === 'undefined' ? { sourceOverride: uuidSourceGenerator() } : {};
            this.stellar = stellarRequest(stellarOptions);
          }

          if (this.socket) {
            log.info('@StellarEngineIO.closeIfNeeded: Already open socket. Closing it before reconnect.');
            this.socket.off('close');
            this.socket.on('close', () => {
              this.socket.off('close');
              log.info(`@StellarEngineIO: Closed`);
              this.stellar.transport.onClose();
              resolve(this.state);
            });
            this.socket.close();
          } else {
            log.info('@StellarEngineIO.closeIfNeeded: Clean slate');
            resolve(this.state);
          }
        } catch (e) {
          log.warn(e, 'unable to close socket');
          resolve(this.state);
        }
      });
    },
    _doConnect(url, { userId, token, secure, tokenType, params, eioConfig = { upgrade: true, rememberUpgrade: true } }) {
      log.info(`@StellarEngineIO._doConnect: ${userId}, ${token}`);
      return new Promise((resolve, reject) => {
        this.state = 'connecting';
        const urlParams = assign({ 'x-auth-user': userId, 'x-auth-token': token, 'x-auth-token-type': tokenType }, params);
        let socketAttempt = null;
        try {
          socketAttempt = new eio.Socket(`${secure ? 'wss' : 'ws'}://${url}?${qs.stringify(urlParams)}`, eioConfig);
        } catch (e) {
          log.info(`@StellarEngineIO error`, e);
          reject('Connect failed');
        }

        socketAttempt.on('message', (m) => {
          let jam = null;
          try {
            jam = JSON.parse(m);
          } catch (e) {
            log.error(e, `@StellarEngineIO: message ignored ${m}`);
            return;
          }

          if (jam.messageType === 'error') {
            log.error(`@StellarEngineIO Error: ${jam.message}`);
            this.tryToReconnect = false;
            socketAttempt.close();
            const ctor = jam.errorType === 'StellarError' ? StellarError : Error;
            reject(new ctor('Authentication Error')); // eslint-disable-line new-cap
          } else if (jam.messageType === 'connected') {
            this.state = 'connected';
            this.stellar.transport.setSocket(socketAttempt);
            this.socket = socketAttempt;
            this.userId = userId;
            this.trigger('open');
            if (this.connectedOnce) {
              this.trigger('reconnected');
            }
            this.connectedOnce = true;
            resolve(this.stellar);
          }
        });

        socketAttempt.on('open', () => {
          log.info('@StellarEngineIO: socket open');
        });

        socketAttempt.on('close', () => {
          log.info(`@StellarEngineIO: Closed`);
          this.stellar.transport.onClose();
          if (this.state === 'connected') {
            this.trigger('close');
            this.state = 'disconnected';
            this.socket = null;
            if (this.tryToReconnect) {
              this._reconnect(url, { userId, token, secure });
            }
          }
        });

        socketAttempt.on('error', (e) => {
          log.error(e, `Socket error`);
          this.trigger('error');
          if (this.state === 'connecting') {
            reject('Connect failed');
          }
        });

        socketAttempt.on('upgrade', () => {
          log.info(`@StellarEngineIO.event:'UPGRADE': ${socketAttempt.id}`);
          this.trigger('upgrade');
        });
      });
    },

    close() {
      this.tryToReconnect = false;

      if (this.socket) {
        log.info(`@StellarEngineIO: Close requested`);
        this.socket.close();
      }
    },
  };
}

export default stellarSocketFactory;

