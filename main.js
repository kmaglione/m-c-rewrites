"use strict";

var {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

ChromeUtils.import("resource://gre/modules/Services.jsm");

const nsFile = Components.Constructor("@mozilla.org/file/local;1",
                                      "nsIFile", "initWithPath");

const resProto = Services.io.getProtocolHandler("resource")
                         .QueryInterface(Ci.nsIResProtocolHandler);

const baseDir = nsFile(arguments[0]);
resProto.setSubstitution("rewrites", Services.io.newFileURI(baseDir));


async function main(scriptdir, script, ...args) {
  let temp = {};
  ChromeUtils.import(`resource://rewrites/processors/${script}.jsm`, temp);

  let processor = new temp.Processor(args);
  await processor.processFiles();
}

let done = false;
main(...arguments).catch(e => {
  dump(`Error: ${e}\n${e.stack}\n`);
}).then(() => {
  done = true;
});

// Spin an event loop.
Services.tm.spinEventLoopUntil(() => done);
Services.tm.spinEventLoopUntilEmpty();
