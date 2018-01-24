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
  "servo/tests/html/webvr/js/third-party",
  "browser/extensions/pdfjs/content/web",
  "third_party",

  "tools/lint/eslint",
];


function isIdentifier(node, id) {
  return node && node.type === "Identifier" && node.name === id;
}

function isMemberExpression(node, object, member) {
  return (node && node.type === "MemberExpression" &&
          isIdentifier(node.object, object) &&
          isIdentifier(node.property, member));
}


class Processor extends ProcessorBase {
  constructor(filters) {
    super(kIgnorePaths, filters.length ? filters : null);
  }

  shouldProcess(path, text) {
    return /\b(?:Cu\.import|Components\.utils\.import|XPCOMUtils\.defineLazyModuleGetter)\(/.test(text);
  }

  process(path, replacer) {
    Reflect.parse(replacer.code, {
      source: path,
      builder: {
        callExpression: function(callee, args, loc) {
          let node = {type: "CallExpression", callee, arguments: args, loc};

          let isCu = (!path.startsWith("devtools/") && isIdentifier(callee.object, "Cu") ||
                      isMemberExpression(callee.object, "Components", "utils"));

          if (isCu && isIdentifier(callee.property, "import")) {
            replacer.replaceCallee(node, "ChromeUtils.import");
          } else if (isMemberExpression(callee, "XPCOMUtils", "defineLazyModuleGetter") &&
                     node.arguments.length < 4) {
            replacer.replaceCallee(node, "ChromeUtils.defineModuleGetter");
          }

          return node;
        },
      },
    });
  }
}

