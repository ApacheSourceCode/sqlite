/*
  2022-05-20

  The author disclaims copyright to this source code.  In place of a
  legal notice, here is a blessing:

  *   May you do good and not evil.
  *   May you find forgiveness for yourself and forgive others.
  *   May you share freely, never taking more than you give.

  ***********************************************************************

  This is the JS Worker file for the sqlite3 fiddle app. It loads the
  sqlite3 wasm module and offers access to the db via the Worker
  message-passing interface.

  Because we can have only a single message handler, as opposed to an
  arbitrary number of discrete event listeners like with DOM elements,
  we have to define a lower-level message API. Messages abstractly
  look like:

  { type: string, data: type-specific value }

  Where 'type' is used for dispatching and 'data' is a
  'type'-dependent value.

  The 'type' values expected by each side of the main/worker
  connection vary. The types are described below but subject to
  change at any time as this experiment evolves.

  Workers-to-Main types

  - stdout, stderr: indicate stdout/stderr output from the wasm
    layer. The data property is the string of the output, noting
    that the emscripten binding emits these one line at a time. Thus,
    if a C-side puts() emits multiple lines in a single call, the JS
    side will see that as multiple calls.

  - module: Status text. This is intended to alert the main thread
    about module loading status so that, e.g., the main thread can
    update a progress widget and DTRT when the module is finished
    loading and available for work. The status text is mostly in some
    undocumented(?) format emited by the emscripten generated
    module-loading code, encoding progress info within it.

  - working: data='start'|'end'. Indicates that work is about to be
    sent to the module or has just completed. This can be used, e.g.,
    to disable UI elements which should not be activated while work
    is pending.

  Main-to-Worker types:

  - shellExec: data=text to execute as if it had been entered in the
    sqlite3 CLI shell app (as opposed to sqlite3_exec()). This event
    causes the worker to emit a 'working' event (data='start') before
    it starts and a 'working' event (data='end') when it finished. If
    called while work is currently being executed it emits stderr
    message instead of doing actual work, as the underlying db cannot
    handle concurrent tasks.

  - More TBD as the higher-level db layer develops.
*/

/*
  Apparent browser(s) bug: console messages emitted may be duplicated
  in the console, even though they're provably only run once. See:

  https://stackoverflow.com/questions/49659464

  Noting that it happens in Firefox as well as Chrome. Harmless but
  annoying.
*/

const thisWorker = self;

const wMsg = (type,data)=>postMessage({type, data});

self.onerror = function(/*message, source, lineno, colno, error*/) {
    const err = arguments[4];
    if(err && 'ExitStatus'==err.name){
        Module._isDead = true;
        Module.printErr("FATAL ERROR:", err.message);
        Module.printErr("Restarting the app requires reloading the page.");
        //const taOutput = document.querySelector('#output');
        //if(taOutput) taOutput.classList.add('error');
    }
    Module.setStatus('Exception thrown, see JavaScript console');
    Module.setStatus = function(text) {
        if(text) console.error('[post-exception status] ' + text);
    };
};

self.Module = {
/* ^^^ cannot declare that const because fiddle-module.js
   (auto-generated) includes a decl for it and runs in this scope. */
    preRun: [],
    postRun: [],
    //onRuntimeInitialized: function(){},
    print: function(text){wMsg('stdout', Array.prototype.slice.call(arguments));},
    printErr: function(text){wMsg('stderr', Array.prototype.slice.call(arguments));},
    setStatus: function f(text){wMsg('module',{type:'status',data:text});},
    totalDependencies: 0,
    monitorRunDependencies: function(left) {
        this.totalDependencies = Math.max(this.totalDependencies, left);
        this.setStatus(left
                       ? ('Preparing... (' + (this.totalDependencies-left)
                          + '/' + this.totalDependencies + ')')
                       : 'All downloads complete.');
    }
};

const shellExec = function f(sql){
    if(!f._) f._ = Module.cwrap('fiddle_exec', null, ['string']);
    if(Module._isDead){
        wMsg('stderr', "shell module has exit()ed. Cannot run SQL.");
        return;
    }
    wMsg('working','start');
    try {
        if(f._running) wMsg('stderr','Cannot run multiple commands concurrently.');
        else{
            f._running = true;
            f._(sql);
        }
    } finally {
        wMsg('working','end');
        delete f._running;
    }
};

self.onmessage = function(ev){
    ev = ev.data;
    //console.debug("worker: onmessage.data",ev);
    switch(ev.type){
        case 'shellExec': shellExec(ev.data); return;
    };
    console.warn("Unknown fiddle-worker message type:",ev);
};
self.Module.setStatus('Downloading...');
importScripts('fiddle-module.js')
/* loads the wasm module and notifies, via Module.setStatus() and
   Module.onRuntimeInitialized(), when it's done loading. */;

Module["onRuntimeInitialized"] = function onRuntimeInitialized() {
    /* For reference: sql.js does essentially everything we want and
       it solves much of the wasm-related voodoo, but we'll need a
       different structure because we want the db connection to run in
       a worker thread and feed data back into the main
       thread. Regardless of those differences, it makes a great point
       of reference:

       https://github.com/sql-js/sql.js

       Some of the specific design goals here:

       - Bind a low-level sqlite3 API which is close to the native one in
         terms of usage.

       - Create a higher-level one, more akin to sql.js and
         node.js-style implementations. This one would speak directly
         to the low-level API. This API could be used by clients who
         import the low-level API directly into their main thread
         (which we don't want to recommend but also don't want to
         outright forbid).

       - Create a second higher-level one which speaks to the
         low-level API via worker messages. This one would be intended
         for use in the main thread, talking to the low-level UI via
         worker messages. Because workers have only a single message
         channel, some acrobatics will be needed here to feed async
         work results back into client-side callbacks (as those
         callbacks cannot simply be passed to the worker). Exactly
         what those acrobatics should look like is not yet entirely
         clear and much experimentation is pending.

    */
    console.log('onRuntimeInitialized');

    /*
      TODO: create the main sqlite API here. We'll have another for
      use in the main thread which will talk to this one via worker
      messages.
    */
    
}
