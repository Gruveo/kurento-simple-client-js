# Simple Node Client for Kurento Server

Stability: EXPERIMENTAL

This is lightweight alternative client to https://github.com/Kurento/kurento-client-js.

## Functions

* `kurento(url, callback, reporter)` - `callback(err, client)`, `reporter(message)`
* `client.create(objectType, constructorParams, callback)` - `callback(err, objectId)`
* `client.invoke(objectId, operation, operationParams, callback)` - `callback(err, returnValue)`
* `client.release(objectId, callback)` - `callback(err)`
* `client.ping(interval, callback)` - `callback(err, pong)`
* `client.subscribe(objectId, eventType, eventHandler, callback)` - `eventHandler(eventData)`, `callback(err, subscriptionId)`
* `client.unsubscribe(subscriptionId, objectId, callback)` - `callback(err)`
* `client.getSessionId()`
* `client.setSessionId(sessionId)`
* `client.close()`

## Usage

Simple unfinished example:

```javascript
const kurento = require('kurento-simple-client-js');
const autoInject = require('async/autoInject');
const each = require('async/each');
const config = require('config');

autoInject({
  client(cb) {
    kurento(config.get('mediaserver.kurento.url'), cb, function (message) {
      console.log(`Kurento Client: ${message}`);
    });      
  },

  mediaPipeline(client, cb) {
    client.create('MediaPipeline', cb);
  },

  webRtcEndpoint(client, mediaPipeline, cb) {
    client.create('WebRtcEndpoint', { mediaPipeline }, cb);
  },

  subscribeForIce(client, webRtcEndpoint, cb) {
    client.subscribe(webRtcEndpoint, 'OnIceCandidate', function ({ candidate }) {
      // send candidate to client
    }, cb);
  },

  addIceCandidates(client, webRtcEndpoint, cb) {
    each(candidates, function (candidate, cb) {
      client.invoke(webRtcEndpoint, 'addIceCandidate', { candidate }, cb);  
    }, cb);
  },

  // ...
}, function (err, results) {
  if (err) {
    log.error(err);

    if (results.client && results.mediaPipeline) {
      results.client.release(mediaPipeline, function (err) {
        if (err) {
          log.error(err);
        }
      });
    }
  }
});
```
