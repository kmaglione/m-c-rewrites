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
];

const {isIdentifier} = Utils;

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

class Processor extends ProcessorBase {
  constructor(filters) {
    super(kIgnorePaths, filters.length ? filters : null);
  }

  shouldProcess(path, text) {
    return /\b(add_task|registerCleanupFunction)\(/.test(text);
  }

  process(path, replacer) {
    Reflect.parse(replacer.code, {
      source: path,
      builder: {
        yields: [],

        callExpression(callee, args, loc) {
          let node = {type: "CallExpression", callee, arguments: args, loc};

          if ((isIdentifier(callee, "add_task") ||
               isIdentifier(callee, "registerCleanupFunction")) &&
              args[0] && args[0].generator) {
            let func = args[0];
            {
              let end;
              let space = "";
              if (func.id) {
                end = replacer.getOffset(func.loc.start);
                space = " ";
              } else {
                end = replacer.getOffset(func.loc.start) + 1;
                while (/\s/.test(replacer.code[end])) {
                  end++;
                }
              }

              let start = end - "function*".length;
              while (replacer.code[start] !== "f") {
                start--;
              }

              replacer.replaceOffsets({start, end}, "async function" + space);
            }

            for (let expr of func.yields) {
              let len = (expr.delegate ? "yield*" : "yield").length;

              let start = replacer.getOffset(expr.loc.start);
              replacer.replaceOffsets({start, end: start + len}, "await");
            }
          }

          return node;
        },

        _function(type, id, params, body, generator, expression, loc) {
          let node = {type, id, params, body, generator, expression, loc};
          if (generator) {
            [this.yields, node.yields] = stealChildren(replacer, node, this.yields);
          }
          return node;
        },

        functionDeclaration(id, params, body, generator, expression, loc) {
          return this._function("FunctionDeclaration", id, params, body, generator, expression, loc);
        },
        functionExpression(id, params, body, generator, expression, loc) {
          return this._function("FunctionExpression", id, params, body, generator, expression, loc);
        },

        yieldExpression(argument, delegate, loc) {
          let node = {loc, type: "YieldExpression", argument, delegate};
          this.yields.push(node);
          return node;
        },
      },
    });
  }
}

