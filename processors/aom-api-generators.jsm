"use strict";

var {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

ChromeUtils.import("resource://rewrites/Processor.jsm");

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

const {getMemberExpression, isIdentifier} = Utils;

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

function stealChildren(replacer, func, nodes) {
  let start = replacer.getOffset(func.body.loc.start);

  let children = [];
  nodes = nodes.filter(node => {
    if (replacer.getOffset(node.loc.start) >= start) {
      children.push(node);
      return false;
    }
    return true;
  });

  return [nodes, children];
}

function getCallback(node) {
  if (!node) {
    return null;
  }

  if (node.type === "CallExpression" && isIdentifier(node.callee, "callback_soon")) {
    node = node.arguments[0];
  }
  if (["FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) {
    return node;
  }
  return null;
}

function promisifyFunction(replacer, node, callbackIndex, callee = null) {
  let outer = replacer.getFunction(node);
  let callback = getCallback(node.arguments[callbackIndex]);
  if (!outer || !callback || callback.body.type !== "BlockStatement") {
    return;
  }

  let {start, end} = replacer.getOffsets(node.loc);
  if (replacer.getText({start: end, end: end + 2}) != ";\n") {
    return;
  }

  replacer.groupReplacements(() => {
    replacer.makeAsync(outer);

    let preface;
    {
      if (callback.params.length) {
        let param = replacer.getArgText(callback);
        preface =  `let ${param} = await `;
      } else {
        preface = `await `;
      }
    }

    if (callee == null) {
      callee = replacer.getNodeText(node.callee);
    }

    {
      let params = [];
      for (let [i, param] of node.arguments.entries()) {
        if (i === callbackIndex) {
          params.push("null");
        } else {
          params.push(replacer.getNodeText(param))
        }
      }
      if (node.arguments.length <= callbackIndex + 1) {
        params = params.slice(0, callbackIndex);
      }

      replacer.replaceCallee(node, preface + callee, params.join(", "));
    }

    let {body} = callback.body;
    let bodyText = replacer.getText(replacer.getOffsets(body));

    let oldIndent = " ".repeat(body[0].loc.start.column);
    let newIndent = " ".repeat(node.loc.start.column);
    if (oldIndent.length > newIndent.length) {
      bodyText = bodyText.replace(new RegExp(`^${oldIndent}`, "gm"), newIndent);
    }

    replacer.insertAt(end + 2, `${newIndent}${bodyText}\n`);
  });
}

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
        yields: [],

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
          if (generator) {
            [this.yields, node.yields] = stealChildren(replacer, node, this.yields);
          }
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

        yieldExpression(argument, delegate, loc) {
          let node = {loc, type: "YieldExpression", argument, delegate};
          this.yields.push(node);
          return node;
        },
      },
    });

    for (let {node, callbackIndex, callee} of callbacks) {
      promisifyFunction(replacer, node, callbackIndex, callee);
    }
  }
}

