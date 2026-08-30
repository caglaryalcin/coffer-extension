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
      local: {
        clear: promisify(chromeApi.storage.local, chromeApi.storage.local.clear),
        get: promisify(chromeApi.storage.local, chromeApi.storage.local.get),
        remove: promisify(chromeApi.storage.local, chromeApi.storage.local.remove),
        set: promisify(chromeApi.storage.local, chromeApi.storage.local.set),
      },
    },
    tabs: {
      create: promisify(chromeApi.tabs, chromeApi.tabs.create),
      query: promisify(chromeApi.tabs, chromeApi.tabs.query),
    },
  };
})();
