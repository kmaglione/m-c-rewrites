"use strict";

var {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

ChromeUtils.import("resource://rewrites/Processor.jsm");
ChromeUtils.import("resource://rewrites/Replacer.jsm");

var EXPORTED_SYMBOLS = ["Processor"];


const kIgnorePaths = [
  "devtools/client/inspector/markup/test",
  "devtools/client/debugger/new/test/mochitest/examples/sourcemaps2",
  "devtools/client/jsonview/lib",
  "devtools/client/shared/vendor",
  "devtools/client/sourceeditor/codemirror",
  "dom/tests/mochitest/ajax",
  "dom/tests/mochitest/dom-level",
  "dom/canvas/test/webgl-conf/checkout",
  "testing/mochitest/MochiKit",
  "testing/mochitest/tests/MochiKit",
  "testing/web-platform/tests",
  "testing/marionette/harness/marionette_harness/runner/mixins/browsermob-proxy-py/docs/_build/html/_static/jquery.js",
  "testing/marionette/atom.js",
  "browser/extensions/pocket/content/panels/js/vendor/jquery-2.1.1.min.js",
  "servo/",
  "browser/extensions/pdfjs/content/web",
  "mobile/android/tests/browser/robocop/robocop_head.js",
  "third_party",

  "tools/lint/eslint",

  "toolkit/mozapps/extensions/content/extensions.xml",
];

const {getMemberExpression} = Replacer.Utils;

const callbackMethods = {
  getActiveAddons: 1,
  getAddonByID: 1,
  getAddonBySyncGUID: 1,
  getAddonsByIDs: 1,
  getAddonsByTypes: 1,
  getAddonsWithOperationsByTypes: 1,
  getAllAddons: 0,
  getAllInstalls: 0,
  getInstallForFile: 1,
  getInstallForURL: 1,
  getInstallsByTypes: 1,
};

const callbackFunctions = {
  completeAllInstalls: [1, "promiseCompleteAllInstalls"],
  installAllFiles: [1, "promiseInstallAllFiles"],
};

class Processor extends ProcessorBase {
  constructor(filters) {
    super(kIgnorePaths, filters.length ? filters : null);
  }

  shouldProcess(path, text) {
    return /\bAddonManager\..*\(|completeAllInstalls|installAllFiles/.test(text);
  }

  process(path, replacer) {
    let callbacks = [];

    Reflect.parse(replacer.code, {
      source: path,
      builder: {
        callExpression(callee, args, loc) {
          let node = {type: "CallExpression", callee, arguments: args, loc};

          let calleePath = getMemberExpression(callee);
          if (calleePath.length === 2) {
            if (calleePath[0] === "AddonManager") {
              let meth = calleePath[1];
              if (callbackMethods.hasOwnProperty(meth)) {
                callbacks.push({node, callbackIndex: callbackMethods[meth], callee: null});
              }
            }
          } else if (calleePath.length === 1) {
            let func = calleePath[0];
            if (callbackFunctions.hasOwnProperty(func)) {
              let [callbackIndex, callee] = callbackFunctions[func];
              callbacks.push({node, callbackIndex, callee});
            }
          }

          return node;
        },

        _function(type, id, params, body, generator, expression, isAsync, rest, loc) {
          if (!loc) {
            loc = isAsync;
            isAsync = undefined;
          }

          let node = {type, id, params, body, generator, expression, loc, async: isAsync, rest};
          replacer.addFunction(node);
          return node;
        },

        functionDeclaration(id, params, body, generator, expression, isAsync, rest, loc) {
          return this._function("FunctionDeclaration", id, params, body, generator, expression, isAsync, rest, loc);
        },
        functionExpression(id, params, body, generator, expression, isAsync, rest, loc) {
          return this._function("FunctionExpression", id, params, body, generator, expression, isAsync, rest, loc);
        },
        arrowFunctionExpression(id, params, body, generator, expression, isAsync, rest, loc) {
          return this._function("ArrowFunctionExpression", id, params, body, generator, expression, isAsync, rest, loc);
        },
      },
    });

    for (let {node, callbackIndex, callee} of callbacks) {
      replacer.promisifyFunction(node, callbackIndex, callee);
    }
  }
}

