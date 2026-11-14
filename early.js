/* ss_early.js: loads FIRST in <head>, before 4399.js and before the Unity loader.
 * It wraps the WebAssembly API so the mod can see what the game gives the wasm module:
 *   - the module's imports (the JS functions Unity calls), memory and function table, captured at instantiation
 *   - every abort() and every C++ throw (___cxa_throw) with its arguments and a stack, so an "abort(59)" can be traced to the
 *     managed exception behind it
 *   - hook(name, fn): replace/wrap any JS import the wasm calls, even after the game is running (the imports go through a dispatcher)
 * It does not change game behavior on its own. Nothing here touches the wasm code itself.
 * Use from the console:  __ssEarly.report()
 */
(function () {
"use strict";
if (window.__ssEarly || typeof WebAssembly === "undefined") return;
const E = window.__ssEarly = { version: 1, log: [], imports: [], hooks: Object.create(null), instances: [], memory: null, table: null, exports: null, bytes: null, lastThrow: null, lastAbort: null, ready: false, listeners: [] };
const hex = (n) => "0x" + (n >>> 0).toString(16);
const note = (s) => { E.log.push(new Date().toLocaleTimeString() + "  " + s); if (E.log.length > 300) E.log.shift(); try { console.log("[ssearly]", s); } catch (e) {} };
// hot or pointless to dispatch: GL calls, exception thunks, timers, big memcpy
const SKIP = /^(_?gl[A-Z]|_?emscripten_gl|invoke_|dynCall_|_?webgl|_?emscripten_get_now$|_?emscripten_memcpy_big$|_?emscripten_resize_heap$|_?clock_gettime$|_?gettimeofday$|_?time$|_?emscripten_get_heap_size$)/;

let u32 = null, u32buf = null;
E.heap = () => { const m = E.memory; if (!m || !m.buffer) return null; if (m.buffer !== u32buf) { u32buf = m.buffer; u32 = new Uint32Array(u32buf); } return u32; };
const stack = () => { try { return String(new Error().stack).split("\n").slice(2, 9).join("\n"); } catch (e) { return ""; } };

// built-in diagnostics
E.hooks.abort = E.hooks._abort = function (orig, args) {
E.lastAbort = { what: args[0], t: Date.now(), stack: stack() };
note("abort(" + args[0] + ")" + (E.lastThrow && Date.now() - E.lastThrow.t < 3000 ? "  right after a throw of exception object " + hex(E.lastThrow.ex) : ""));
return orig.apply(this, args);
};
E.hooks.___cxa_throw = E.hooks.__cxa_throw = function (orig, args) {
try { const h = E.heap(), p = args[0] >>> 0; E.lastThrow = { ptr: p, ex: h ? h[p >> 2] >>> 0 : 0, type: args[1], t: Date.now(), stack: stack() }; note("throw  object " + hex(p) + "  managed exception " + hex(E.lastThrow.ex) + "  type " + args[1]); } catch (e) {}
return orig.apply(this, args);
};

function wrapImports(imports) {
if (!imports || typeof imports !== "object") return;
for (const m of Object.keys(imports)) {
const ns = imports[m]; if (!ns || typeof ns !== "object") continue;
for (const k of Object.keys(ns)) {
const f = ns[k]; if (typeof f !== "function" || SKIP.test(k)) continue;
const wrapped = function () { const h = E.hooks[k]; return h ? h.call(this, f, arguments) : f.apply(this, arguments); };
try { ns[k] = wrapped; E.imports.push(m + "." + k); } catch (e) { /* frozen */ }
}
}
}
function capture(inst, imports) {
try {
const ex = inst && inst.exports ? inst.exports : null;
E.exports = ex; E.instances.push(inst);
const pick = (n) => (ex && ex[n]) || (imports && Object.keys(imports).map((m) => imports[m] && imports[m][n]).find((x) => x));
E.memory = pick("memory") || E.memory;
E.table = pick("table") || pick("__indirect_function_table") || E.table;
E.ready = true;
note("wasm instance ready: " + (ex ? Object.keys(ex).length : 0) + " exports, " + E.imports.length + " imports wrapped, memory " + (E.memory ? E.memory.buffer.byteLength >> 20 : "?") + " MB, table " + (E.table ? E.table.length : "?") + " entries");
E.listeners.splice(0).forEach((cb) => { try { cb(E); } catch (e) {} });
} catch (e) { note("capture failed: " + e); }
}

const oInstantiate = WebAssembly.instantiate, oStream = WebAssembly.instantiateStreaming, OModule = WebAssembly.Module, OInstance = WebAssembly.Instance;
WebAssembly.instantiate = function (src, imports) {
try { wrapImports(imports); if (src instanceof ArrayBuffer || ArrayBuffer.isView(src)) E.bytes = src; } catch (e) { note("instantiate wrap failed: " + e); }
return oInstantiate.apply(this, arguments).then((r) => { capture(r && r.instance ? r.instance : r, imports); return r; });
};
if (oStream) WebAssembly.instantiateStreaming = function (resp, imports) {
try { wrapImports(imports); } catch (e) { note("stream wrap failed: " + e); }
return oStream.apply(this, arguments).then((r) => { capture(r && r.instance ? r.instance : r, imports); return r; });
};
WebAssembly.Module = function (bytes) { try { E.bytes = bytes; } catch (e) {} return new OModule(bytes); };
WebAssembly.Module.prototype = OModule.prototype; Object.setPrototypeOf(WebAssembly.Module, OModule);
WebAssembly.Instance = function (module, imports) { try { wrapImports(imports); } catch (e) {} const i = new OInstance(module, imports); capture(i, imports); return i; };
WebAssembly.Instance.prototype = OInstance.prototype; Object.setPrototypeOf(WebAssembly.Instance, OInstance);

// ---- api ----
E.hook = (name, fn) => { E.hooks[name] = fn; return "hooked " + name; };      // fn(orig, args) -> value
E.unhook = (name) => { delete E.hooks[name]; return "unhooked " + name; };
E.onReady = (cb) => { if (E.ready) cb(E); else E.listeners.push(cb); };
E.report = () => [
"ready: " + E.ready + "   imports wrapped: " + E.imports.length + "   module bytes captured: " + (E.bytes ? (E.bytes.byteLength >> 10) + " KB" : "no"),
"memory: " + (E.memory ? (E.memory.buffer.byteLength >> 20) + " MB" : "not captured") + "   table: " + (E.table ? E.table.length + " entries" : "not captured"),
"last abort: " + (E.lastAbort ? "abort(" + E.lastAbort.what + ")" : "none") + "   last throw: " + (E.lastThrow ? "managed exception " + hex(E.lastThrow.ex) : "none"),
"imports: " + E.imports.join(", ")
].join("\n");
note("early capture installed");
})();