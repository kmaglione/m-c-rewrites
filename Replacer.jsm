"use strict";

var {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

var EXPORTED_SYMBOLS = ["Replacer"];

const PLACEHOLDER = "//SourceRewriterPreprocessorMacro-#";

let compareReplacements = (a, b) => a.start - b.start || b.end - a.end;

const FUNC_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
]);

class Replacer {
  constructor(code, {preprocessor = false} = {}) {
    this.code = code;

    if (preprocessor) {
      this.manglePreprocessor();
    }

    this.lineOffsets = [0];
    let re = /.*?\n|.+?$/g;
    while (re.exec(code)) {
      this.lineOffsets.push(re.lastIndex);
    }

    this.functions = [];

    this.replacements = [];

    this.preprocessor = preprocessor;

    this.skippedReplacements = 0;
  }

  manglePreprocessor() {
    this.code = this.code.replace(/^#/gm, PLACEHOLDER);
  }

  demanglePreprocessor(result) {
    if (this.preprocessor) {
      return result.replace(RegExp("^" + PLACEHOLDER, "gm"),
                            "#");
    }
    return result;
  }

  applyChanges() {
    this.replacements.sort(compareReplacements);

    let parts = [];
    let offset = 0;
    let fillGap = end => {
      if (offset < end) {
        parts.push(this.code.slice(offset, end));
      }
      offset = end;
    };

    let insert = ({start, end}, text) => {
      fillGap(start);
      parts.push(text);
      offset = end;
    };

    for (let {offsets, text} of this.replacements) {
      if (offsets.start < offset) {
        this.skippedReplacements++;
        continue;
      }

      if (Array.isArray(text)) {
        for (let repl of text) {
          insert(repl.offsets, repl.text);
        }
      } else {
        insert(offsets, text);
      }

    }
    fillGap(this.code.length);

    return this.demanglePreprocessor(parts.join(""));
  }

  addFunction(node) {
    let {start, end} = this.getOffsets(node.body.loc);

    this.functions.push({start, end, node});
  }

  getFunction(node) {
    this.functions.sort((a, b) => a.start - b.start);

    let {start, end} = this.getOffsets(node.loc);
    let closest;
    for (let func of this.functions) {
      if (start >= func.start && end <= func.end) {
        closest = func.node;
      }
    }
    return closest;
  }

  makeAsync(func) {
    if (!func.async) {
      func.async = true;
      func.notAsyncYet = true;

      let {start} = this.getFuncDeclOffsets(func);
      this.insertAt(start, "async ");
    }
  }

  getFuncDeclOffsets(func) {
    let end;
    if (func.id) {
      end = this.getOffset(func.loc.start);
    } else {
      end = this.getOffset(func.loc.start);
      while (/\s/.test(this.code[end])) {
        end++;
      }
    }

    let start = end;
    if (func.type === "ArrowFunctionExpression") {
      start++;
      end++;
      if (/\s/.test(this.code[start])) {
        start++;
        end++;
      }
    } else {
      if (func.id || func.generator) {
        start -= "function".length;
      }
      if (func.generator) {
        start -= "*".length;
      }

      while (this.code[start] !== "f") {
        start--;
      }

      let re = /function(\s*\* )?\s*/y;
      re.lastIndex = start;
      let match = re.exec(this.code);
      if (!match || start + match[0].length != end) {
        start = end;
      }
    }

    if (func.async && !func.notAsyncYet) {
      start -= "async ".length;
      while (this.code[start] !== "a") {
        start--;
      }
    }

    return {start, end};
  }

  getNodeStart(node) {
    if (FUNC_TYPES.has(node.type)) {
      return this.getFuncDeclOffsets(node).start;
    }
    return this.getOffset(node.loc.start);
  }

  getNodeOffsets(node) {
    return {
      start: this.getNodeStart(node),
      end: this.getOffset(node.loc.end),
    };
  }

  getOffset(loc) {
    return this.lineOffsets[loc.line - 1] + loc.column;
  }

  getOffsets(range) {
    if (Array.isArray(range)) {
      return {
        start: this.getNodeStart(range[0]),
        end: this.getOffset(range[range.length - 1].loc.end),
      };
    }
    return {start: this.getOffset(range.start), end: this.getOffset(range.end)};
  }

  getArgOffsets(node) {
    let args = node.arguments || node.params;
    if (args.length) {
      return this.getOffsets(args);
    }

    let start = this.getOffset(node.callee.loc.end) + 1;
    let end = this.getOffset(node.loc.end);

    let text = this.code.slice(start, end + 1);
    return {
      start: start + text.indexOf("(") + 1,
      end: start + text.lastIndexOf(")") - 1,
    };
  }

  getArgText(node) {
    return this.getText(this.getArgOffsets(node));
  }

  getText(offsets) {
    return this.code.slice(offsets.start, offsets.end);
  }

  getNodeText(node) {
    return this.getText(this.getNodeOffsets(node));
  }

  replace(node, text) {
    this.replaceOffsets(this.getNodeOffsets(node),
                        text);
  }

  replaceArgs(node, text) {
    this.replaceOffsets(this.getArgOffsets(node), text);
  }

  replaceOffsets(offsets, text) {
    this.replacements.push({
      offsets,
      text
    });
  }

  insertAt(offset, text) {
    this.replaceOffsets({start: offset, end: offset},
                        text);
  }

  replaceCallee(node, callee, args = null) {
    if (callee && callee.includes("\n")) {
      throw new Error(`Multi-line call expressions not supported: ${JSON.stringify(callee)}`);
    }

    if (callee) {
      this.replace(node.callee, callee);
    } else {
      callee = this.getNodeText(node.callee);
    }

    let args_ = node.arguments;
    if (args == null && (!args_.length ||
                         args_[0].loc.start.line === args_[args_.length - 1].loc.end.line)) {
      return;
    }
    if (args == null) {
      args = this.getArgText(node);
    }

    let origIndent;
    if (node.arguments.length &&
        node.arguments[0].loc.start.line === node.callee.loc.end.line) {
      origIndent = node.arguments[0].loc.start.column;
    } else {
      origIndent = node.callee.loc.end.column + 1;
    }

    let delta = (node.callee.loc.start.column + callee.length -
                 node.callee.loc.end.column);
    let newIndent = origIndent + delta;

    let origSpaces = " ".repeat(origIndent);
    let newSpaces = " ".repeat(newIndent);

    args = args.replace(RegExp("\n" + origSpaces, "g"),
                        "\n" + newSpaces);

    this.replaceArgs(node, args);
  }

  /**
   * Groups all replacements made by the given callback so that, in the
   * case of conflict, all of none of the replacements take place.
   * Replacements generated by the callback must not conflict.
   */
  groupReplacements(callback) {
    let start = this.replacements.length;

    let result = callback();

    let replacements = this.replacements.splice(start).sort(compareReplacements);
    if (replacements.length) {
      let start = replacements[0].offsets.start;
      let end = replacements[replacements.length - 1].offsets.end;
      this.replacements.push({offsets: {start, end}, text: replacements});
    }

    return result;
  }
}

