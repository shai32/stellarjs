/**
 * Created by arolave on 29/05/2017.
 */
import Promise from 'bluebird';
import { configureStellar, stellarRequest, stellarHandler, getSource, setSourceGenerators } from '../src/factory';
import { MockTransport, mockTransportFactory } from './mocks';
import { default as uuid } from '../src/source-generators/uuid';
import { default as browser } from '../src/source-generators/browser';

describe('factory generation', () => {
  beforeEach(() => {
    setSourceGenerators('uuid', { uuid, browser });
  });

  it('set externalSource generation', () => {
    configureStellar({ log: console, transportFactory: mockTransportFactory, source: 'external123' });
    const requestObj = stellarRequest();
    expect(requestObj.requestTimeout).toBe(30000);
    expect(getSource()).toBe('external123');
  });

  it('set uuid generation', (done) => {
    configureStellar({ log: console, transportFactory: mockTransportFactory, sourceGenerator: 'uuid' });
    Promise.delay(50)
      .then(() => {
        const requestObj = stellarRequest();
        expect(requestObj.requestTimeout).toBe(30000);
        expect(getSource()).toMatch(/^[0-9a-f\-]+$/);
        done();
      });
  });

  it('a stellarRequests with same source should fail', (done) => {
      let requestObj;
      let handler;
      configureStellar({ log: console, transportFactory: () => new MockTransport({}, { inMemory: true }), sourceGenerator: 'uuid' });
      Promise.delay(50)
        .then(() => {
            handler = stellarHandler();
            handler.create('testservice:resource', () => ({ text: 'ooo' }));

            requestObj = stellarRequest();

            console.log('request obj created')
            const newRequestObj = stellarRequest();
            fail('shouldnt get this far');
        })
        .catch((e) => {
            expect(requestObj.requestTimeout).toBe(30000);
            expect(requestObj.source).toMatch(/^[0-9a-f\-]+$/);
            return handler.reset();
        }).then(() => done());
  });

  it('a stellarRequests with differed sources should succeed', (done) => {
    let handler;
    configureStellar({ log: console, transportFactory: () => new MockTransport({}, { inMemory: true }), sourceGenerator: 'uuid' });
    Promise.delay(50)
      .then(() => {
        handler = stellarHandler();
        handler.create('testservice:resource', () => ({ text: 'ooo'}) );

        const requestObj = stellarRequest();
        expect(requestObj.requestTimeout).toBe(30000);
        expect(requestObj.source).toMatch(/^[0-9a-f\-]+$/);

        const differentObj = stellarRequest({ sourceOverride: 'override' });
        expect(differentObj.source).toEqual('override');
        expect(differentObj).not.toBe(requestObj);

        return [
          requestObj.create('testservice:resource', { text: 'toot' }),
          differentObj.create('testservice:resource', { text: 'ahoot' }),
        ];
      })
      .all()
      .then((responses) => {
        expect(responses).toEqual([{"text": "ooo"}, {"text": "ooo"}]);
        return handler.reset();
      })
      .then(done)
  });

  it('set browser generation', (done) => {
    global.localStorage = {};
    configureStellar({ log: console, transportFactory: mockTransportFactory, sourceGenerator: 'browser' });
    Promise.delay(50)
      .then(() => {
        const requestObj = stellarRequest();
        expect(requestObj.requestTimeout).toBe(30000);
        expect(getSource()).toMatch(/^browser:[0-9A-Za-z\/\+]+$/);
        global.window = null;
        done();
      });
  });

});