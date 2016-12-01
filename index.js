// http://doc-kurento.readthedocs.io/en/stable/mastering/kurento_protocol.html
const process = require('process');

const WebSocket = require('ws');

module.exports = function (url, cb, reporter) {

  const responseCallbacks = new Map();
  const eventHandlers = new Map();
  const subscriptionTypes = new Map();
  let id = 1; // JSON-RPC call ID
  let sessionId = undefined;
  let rt = 0; // reconnection timeout
  let ws;
  let fin = false;

  open();

  function open() {
    ws = new WebSocket(url);

    setupPinger(ws);

    ws.on('error', handleError.bind(null, ws));
    ws.on('open', handleOpen);
    ws.on('message', handleMessage);
    ws.on('close', handleClose.bind(null, ws));
  }

  //////////////
  // handlers //
  //////////////

  function handleError(ws, err) {
    // if (sessionId) {
      reporter && reporter('Websocket error.');
      ws.close();
      cleanupAndReconnect(ws);
    // } else {
    //   ws = null;
    //   cb(err);
    // }
  }

  function handleOpen() {
    reporter && reporter('Connection with Kurento server established.');

    rt = 0;

    if (sessionId) {
      call('connect', { sessionId }, function (err, res) {
        if (err) {
          if (err.code === 40007) {
            reporter && reporter('Invalid Kurento session.');
            sessionId = null;
            eventHandlers.clear();
            subscriptionTypes.clear();

            call('connect', function (err, res) {
              if (err) {
                reporter && reporter(`Error creating new Kurento session: ${err.message}`);
                ws.close();
                reconnect();
              } else {
                sessionId = res.sesisonId;
              }
            });
          } else {
            reporter && reporter(`Error validating Kurento session: ${err.message}`);
            ws.close();
            setTimeout(reconnect, 1000);
          }
        }
      });
    } else {
      cb(null, { close, invoke, create, release, ping, subscribe, unsubscribe, getSessionId, setSessionId });
    }
  }

  function handleMessage(data, flags) {
    // flags.binary will be set if a binary data is received.
    // flags.masked will be set if the data was masked.

    const response = JSON.parse(data);

    if (response.method) {
      if (response.method === 'onEvent') {
        const { object, type, data } = response.params.value;

        const eventHandler = eventHandlers.get(`${type}\n${object}`);
        if (eventHandler) {
          eventHandler(data);
        } else {
          reporter && reporter(`No event handler found for "${type}" @ "${object}".`);
        }
      }
    } else {
      const callbackWrapper = responseCallbacks.get(response.id);
      if (callbackWrapper) {
        responseCallbacks.delete(response.id);
        if (response.error) {
          const err = new Error(response.error.message);
          err.code = response.error.code;
          err.data = response.error.data;
          callbackWrapper.callback(err);
        } else {
          callbackWrapper.callback(undefined,
            callbackWrapper.extractor ? callbackWrapper.extractor(response.result) : response.result);
        }
      }
    }
  }

  function handleClose(ws) {
    reporter && reporter('Connection closed.');
    clearResponseCallbacks();
    if (fin) {
      eventHandlers.clear();
      subscriptionTypes.clear();
    }
    cleanupAndReconnect(ws);
  }

  /////////////
  // exports //
  /////////////

  function create(type, constructorParams = {}, cb) {
    if (!type) {
      throw new Error('Type is required');
    }
    call('create', {
      type,
      constructorParams,
      sessionId
    }, cf(cb), res => res.value);
  }

  function invoke(object, operation, operationParams = {}, cb) {
    if (!object) {
      throw new Error('Object is required');
    }
    if (!operation) {
      throw new Error('Operation is required');
    }
    call('invoke', {
      object,
      operation,
      operationParams,
      sessionId
    }, cf(cb), res => res.value);
  }

  function release(object, cb) {
    if (!object) {
      throw new Error('Object is required');
    }
    call('release', {
      object,
      sessionId
    }, cf(cb), res => undefined);
  }

  function ping(interval, cb) {
    call('ping', {
      interval
    }, cb, res => res.value);
  }

  function subscribe(object, type, callback, cb) {
    if (!object) {
      throw new Error('Object is required');
    }
    if (!type) {
      throw new Error('Type is required');
    }
    if (!callback) {
      throw new Error('Callback is required');
    }
    call('subscribe', {
      type,
      object,
      sessionId
    }, cf(function (err, subscription) {
      if (!err) {
        eventHandlers.set(`${type}\n${object}`, callback);
        subscriptionTypes.set(`${subscription}\n${object}`, type);
      }

      cb && cb(err, subscription);
    }), res => res.value);
  }

  function unsubscribe(subscription, object, cb) {
    if (!object) {
      throw new Error('Object is required');
    }
    if (!subscription) {
      throw new Error('Subscription is required');
    }
    call('unsubscribe', {
      subscription,
      object,
      sessionId
    }, cf(function (err, subscription) {
      if (!err) {
        const type = subscriptionTypes.get(`${subscription}\n${object}`);
        if (type) {
          eventHandlers.delete(`${type}\n${object}`);
          subscriptionTypes.delete(`${subscription}\n${object}`);
        } else {
          cb && cb(new Error(`Subscription not found for "${subscription}" on "${object}".`));
        }
      }

      cb && cb(err, subscription);
    }), res => undefined);
  }

  function close() {
    fin = true;
    ws.close();
    ws = null;
    sessionId = null;
  }

  function setSessionId(sid) {
    sessionId = sid;
  }

  function getSessionId() {
    return sessionId;
  }

  ///////////
  // local //
  ///////////

  function reconnect() {
    if (!fin) {
      setTimeout(function () {
        reporter && reporter('Reconnecting.');
        open();
      }, Math.min(rt, 10000));
      rt += 500;
    }
  }

  function call(method, params = {}, cb, extractor) {
    const id2 = id++;
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: id2, method, params }), function (err, res) {
      if (!cb) {
        // cry
      } else if (err) {
        cb(err);
      } else {
        responseCallbacks.set(id2, { callback: cb, method, params, extractor }); // note that method and params are just for logging
      }
    });
  }

  function cf(cb) {
    if (cb && typeof cb !== 'function') {
      throw new Error('function expected');
    }

    return function (err, res) {
      if (res) {
        sessionId = res.sessionId;
      }
      cb && cb(err, res);
    };
  }

  function clearResponseCallbacks() {
    process.nextTick(function () {
      responseCallbacks.forEach(function ({ callback, method, params }) {
        reporter && reporter(`Clearing interrupted call: ${method} ${JSON.stringify(params)}`);
        callback(new Error('Connection with Kurento has been interrupted.'));
      });
      responseCallbacks.clear();
    });
  }

  function setupPinger(ws) {
    ws.on('pong', function (x) {
      const pt = ws.pingTimers[x.toString()];
      if (pt) {
        clearTimeout(pt);
      }
    });

    ws.pingSeq = 0;
    ws.pingTimers = {};
    ws.pinger = setInterval(function () {
      const id = (ws.pingSeq++).toString();
      ws.ping(id, {}, true);
      ws.pingTimers[id] = setTimeout(function () {
        reporter && reporter('Closing dead websocket. ' + id);
        ws.close();
        delete ws.pingTimers[id];
      }, 10000 /*config.get('mediaserver.kurento.websocket.keepaliveGracePeriod')*/);
    }, 10000 /*config.get('mediaserver.kurento.websocket.keepaliveInterval')*/);
  }

  function cleanupAndReconnect(ws) {
    clearInterval(ws.pinger);
    Object.keys(ws.pingTimers).forEach(pt => clearTimeout(ws.pinger[pt]));
    reconnect();
  }
};
