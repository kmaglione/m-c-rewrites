"use strict";

var {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

ChromeUtils.import("resource://gre/modules/osfile.jsm");
ChromeUtils.import("resource://gre/modules/Subprocess.jsm");

ChromeUtils.import("resource://rewrites/Replacer.jsm");


Cc["@mozilla.org/jsreflect;1"].createInstance()();
this.Reflect = Reflect;

var EXPORTED_SYMBOLS = ["ProcessorBase", "Reflect", "Utils"];

async function readAll(pipe) {
  let result = "";
  let str;
  while ((str = await pipe.readString())) {
    result += str;
  }
  return result;
}

const EXTS = [".js", ".jsm",
              ".xml", ".xhtml",
              ".html", ".xul"];

class ProcessorBase {
  constructor(ignoredPaths = [], includePaths = null) {
    this.ignoredPaths = ignoredPaths;
    this.includePaths = includePaths;
  }

  async getTrackedFiles() {
    let hg = await Subprocess.pathSearch("hg");
    let proc = await Subprocess.call({
      command: hg,
      arguments: ["manifest"],
      stdout: "pipe",
    });

    let files = await readAll(proc.stdout);
    await proc.wait();
    return files.split("\n");
  }

  shouldProcess(path, text) {
    return true;
  }

  processScript(file, text) {
    if (!this.shouldProcess(file, text)) {
      return null;
    }
    let replacer = new Replacer(text, {preprocessor: true});
    this.process(file, replacer);
    return replacer.applyChanges();
  }

  processRegExp(file, text, pattern,
                mangle = text => text,
                demangle = text => text) {
    let found = false;
    let result = text.replace(pattern, (m0, m1, m2, m3) => {
      if (m2) {
        try {
          let res = this.processScript(file, mangle(m2));
          if (res) {
            found = true;
            return `${m1}${demangle(res)}${m3}`;
          }
        } catch (e) {
          dump(`FAILED TO PROCESS PART OF FILE ${file}\n`);
          dump(`Error: ${e}\n${e.stack}\n`);
        }
      }
      return m0;
    });

    if (found) {
      return result;
    }
    return null;
  }

  processHTML(file, text) {
    return this.processRegExp(file, text, /(<script[^>]*>)([^]*?)(<\/script>)/g);
  }

  processXML(file, text) {
    return this.processRegExp(file, text, /(<!\[CDATA\[)([^]*?)(\]\]>)/g);
  }

  processXBL(file, text) {
    const PRE = "(function(){\n";
    const POST = "\n})()";

    function mangle(text) {
      return `${PRE}${text}${POST}`;
    }
    function demangle(text) {
      return text.slice(PRE.length, -POST.length);
    }

    return this.processRegExp(file, text, /(<!\[CDATA\[)([^]*?)(\]\]>)/g,
                              mangle, demangle);
  }

  async processFiles() {
    for (let path of await this.getTrackedFiles()) {
      if (this.ignoredPaths.some(p => path.startsWith(p))) {
        continue;
      }
      if (this.includePaths && !this.includePaths.some(p => path.startsWith(p))) {
        continue;
      }
      try {
        await this.processFile(path);
      } catch (e) {
        dump(`FAILED TO PROCESS FILE ${path}\n`);
        dump(`Error: ${e}\n${e.stack}\n`);
      }
    }
  }

  async processFile(path) {
    if (!EXTS.some(ext => path.endsWith(ext))) {
      return;
    }

    let contents = new TextDecoder().decode(await OS.File.read(path));

    if (!this.shouldProcess(path, contents)) {
      return;
    }

    dump(`PROCESSING ${path}\n`);

    let result;
    if (path.endsWith(".js") || path.endsWith(".jsm")) {
      result = this.processScript(path, contents);
    } else if (path.endsWith(".html")) {
      result = this.processHTML(path, contents);
    } else if (path.endsWith(".xml")) {
      if (contents.includes("xmlns=\"http://www.mozilla.org/xbl\"")) {
        result = this.processXBL(path, contents);
      }
    } else {
      result = this.processXML(path, contents);
    }

    if (result != null && result != contents) {
      dump(`UPDATING ${path}\n`);
      await OS.File.writeAtomic(path, new TextEncoder().encode(result));
    }
  }
}

var Utils = {
  isIdentifier(node, id) {
    return node && node.type === "Identifier" && node.name === id;
  },

  isMemberExpression(node, object, member) {
    return (node && node.type === "MemberExpression" &&
            isIdentifier(node.object, object) &&
            isIdentifier(node.property, member));
  },
};
