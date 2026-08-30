/* global chrome, browser */

(() => {
  if (globalThis.browser?.runtime?.sendMessage) return;
  if (!globalThis.chrome) return;

  const chromeApi = globalThis.chrome;

  function runtimeError() {
    const error = chromeApi.runtime?.lastError;
    return error?.message ? new Error(error.message) : null;
  }

  function promisify(context, method) {
    return (...args) => new Promise((resolve, reject) => {
      method.call(context, ...args, (...callbackArgs) => {
        const error = runtimeError();
        if (error) {
          reject(error);
          return;
        }
        resolve(callbackArgs.length > 1 ? callbackArgs : callbackArgs[0]);
      });
    });
  }

  function wrapStorageArea(area) {
    return {
      clear: promisify(area, area.clear),
      get: promisify(area, area.get),
      remove: promisify(area, area.remove),
      set: promisify(area, area.set),
    };
  }

  function createAlarm(name, alarmInfo) {
    try {
      return Promise.resolve(chromeApi.alarms.create(name, alarmInfo));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function serializeError(error) {
    return {
      ok: false,
      error: {
        code: "unexpected_error",
        message: error instanceof Error && error.message
          ? error.message
          : "Coffer could not complete this request.",
      },
    };
  }

  globalThis.browser = {
    ...(chromeApi.alarms ? {
      alarms: {
        clear: promisify(chromeApi.alarms, chromeApi.alarms.clear),
        create: createAlarm,
        get: promisify(chromeApi.alarms, chromeApi.alarms.get),
        getAll: promisify(chromeApi.alarms, chromeApi.alarms.getAll),
        onAlarm: chromeApi.alarms.onAlarm,
      },
    } : {}),
    permissions: {
      contains: promisify(chromeApi.permissions, chromeApi.permissions.contains),
      remove: promisify(chromeApi.permissions, chromeApi.permissions.remove),
      request: promisify(chromeApi.permissions, chromeApi.permissions.request),
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
            let response;
            try {
              response = listener(message, sender);
            } catch (error) {
              sendResponse(serializeError(error));
              return false;
            }

            if (response && typeof response.then === "function") {
              response.then(sendResponse, (error) => sendResponse(serializeError(error)));
              return true;
            }
            if (response === false || response === undefined) return false;
            sendResponse(response);
            return false;
          });
        },
      },
      sendMessage: promisify(chromeApi.runtime, chromeApi.runtime.sendMessage),
    },
    scripting: {
      executeScript: promisify(chromeApi.scripting, chromeApi.scripting.executeScript),
    },
    storage: {
      local: wrapStorageArea(chromeApi.storage.local),
      ...(chromeApi.storage.session ? { session: wrapStorageArea(chromeApi.storage.session) } : {}),
    },
    tabs: {
      create: promisify(chromeApi.tabs, chromeApi.tabs.create),
      query: promisify(chromeApi.tabs, chromeApi.tabs.query),
    },
  };
})();
