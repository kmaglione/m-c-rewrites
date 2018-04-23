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
];

const {isMemberExpression} = Replacer.Utils;

class Processor extends ProcessorBase {
  constructor(filters) {
    super(kIgnorePaths, filters.length ? filters : null);
  }

  shouldProcess(path, text) {
    return /\bXPCOMUtils\.generateQI\b/.test(text);
  }

  process(path, replacer) {
    Reflect.parse(replacer.code, {
      source: path,
      builder: {
        callExpression: function(callee, args, loc) {
          let node = {type: "CallExpression", callee, arguments: args, loc};

          if (isMemberExpression(callee, "XPCOMUtils", "generateQI")) {
            let ifaces = node.arguments[0].elements;
            if (ifaces) {
              let filtered = ifaces.filter(elt => !isMemberExpression(elt, "Ci", "nsISupports"));

              let newArgs;
              if (filtered.length < ifaces.length) {
                let strings = filtered.map(node => replacer.getNodeText(node));
                newArgs = `[${strings.join(", ")}]`;
              }

              replacer.replaceCallee(node, "ChromeUtils.generateQI", newArgs);
            }
          }

          return node;
        },
      },
    });
  }
}

