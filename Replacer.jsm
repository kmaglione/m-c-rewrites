"use strict";

var {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

var EXPORTED_SYMBOLS = ["Replacer"];

const PLACEHOLDER = "//SourceRewriterPreprocessorMacro-#";

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

    this.replacements = [];

    this.preprocessor = preprocessor;
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
    this.replacements.sort((a, b) => a.start - b.start || b.end - a.end);

    let parts = [];
    let offset = 0;
    let fillGap = end => {
      if (offset < end) {
        parts.push(this.code.slice(offset, end));
      }
      offset = end;
    };

    for (let {offsets, text} of this.replacements) {
      if (offsets.start < offset) {
        continue;
      }

      fillGap(offsets.start);
      parts.push(text);

      offset = offsets.end;
    }
    fillGap(this.code.length);

    return this.demanglePreprocessor(parts.join(""));
  }

  getOffset(loc) {
    return this.lineOffsets[loc.line - 1] + loc.column;
  }

  getOffsets(range) {
    return {start: this.getOffset(range.start), end: this.getOffset(range.end)};
  }

  getArgOffsets(node) {
    let args = node.arguments;
    if (args.length) {
      return this.getOffsets({start: args[0].loc.start,
                              end: args[args.length - 1].loc.end});
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

  getNodeText(range) {
    return this.getText(this.getOffsets(node.loc));
  }

  replace(node, text) {
    this.replaceOffsets(this.getOffsets(node.loc),
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

  replaceCallee(node, callee, args = null) {
    if (callee.includes("\n")) {
      throw new Error("Multi-line call expressions not supported");
    }

    this.replace(node.callee, callee);

    let args_ = node.arguments;
    if (!args && (!args_.length ||
                  args_[0].loc.start.line === args_[args_.length - 1].loc.end.line)) {
      return;
    }
    if (!args) {
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
}

