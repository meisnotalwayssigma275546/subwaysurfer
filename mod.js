/* Subway Surfers (Unity WebGL 2019.4, IL2CPP) mod
 * 1. Save fix: makes the game's own save (PlayerPrefs + Save/local) actually persist, plus a backup copy.
 * 2. Live object explorer: reads the game's memory using its own class metadata, lists objects and every variable, edits and freezes values.
 * 3. Cheat recipes (powerup timers, magnet, gravity, ...), method calls, JS console with saved custom buttons.
 * Load this in index.html BEFORE master-loader.js:  <script src="ss_mod.js"></script>
 */
(function () {
if (window.__ssMod) return;
window.__ssMod = true;

// ===================================================================================================
// small shared helpers
// ===================================================================================================
const LOG = [];
const dlog = (s) => { LOG.push(new Date().toLocaleTimeString() + "  " + s); if (LOG.length > 400) LOG.shift(); try { console.log("[ssmod]", s); } catch (e) {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms || 0));
const hex = (n) => "0x" + (n >>> 0).toString(16);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };

// ===================================================================================================
// 1. SAVE SYSTEM
// The engine only syncs its virtual filesystem (/idbfs: PlayerPrefs, Save/local, ...) to IndexedDB when
// Module.indexedDB is truthy, and nothing in the framework sets it. Without it nothing ever persists.
// ===================================================================================================
const SAVE = { engine: "waiting", lastBackup: 0, files: 0, restored: 0, err: "" };
const MIRROR = "ssmod_save_mirror_v1";
const SAVE_PAT = /Save\/|PlayerPrefs|prefs|\.json$/i;
const SAVE_MAX = 600 * 1024;
const idbReq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbOpen = () => new Promise((res, rej) => {
let r;
try { r = indexedDB.open("/idbfs", 21); } catch (e) { return rej(e); }
r.onupgradeneeded = (e) => { // same schema the engine uses
const db = e.target.result, tx = e.target.transaction;
const fs = db.objectStoreNames.contains("FILE_DATA") ? tx.objectStore("FILE_DATA") : db.createObjectStore("FILE_DATA");
if (!fs.indexNames.contains("timestamp")) fs.createIndex("timestamp", "timestamp", { unique: false });
};
r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const b64 = (u) => { let s = ""; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
const unb64 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };

async function saveBackup() {
let db;
try {
db = await idbOpen();
const st = db.transaction("FILE_DATA").objectStore("FILE_DATA");
const keys = await idbReq(st.getAllKeys());
const out = {}; let n = 0;
for (const k of keys) {
if (!SAVE_PAT.test(k)) continue;
const v = await idbReq(db.transaction("FILE_DATA").objectStore("FILE_DATA").get(k));
if (v && v.contents && v.contents.length <= SAVE_MAX) { out[k] = { m: v.mode, t: +v.timestamp || Date.now(), c: b64(v.contents) }; n++; }
}
SAVE.files = n;
if (n) { if (lsSet(MIRROR, JSON.stringify(out))) SAVE.lastBackup = Date.now(); else SAVE.err = "backup too big for localStorage"; }
} catch (e) { SAVE.err = "backup: " + e; } finally { try { db && db.close(); } catch (e) {} }
}
async function saveRestore(force) {
const raw = lsGet(MIRROR);
if (!raw) return 0;
let db, n = 0;
try {
const mir = JSON.parse(raw);
db = await idbOpen();
for (const k of Object.keys(mir)) {
const have = await idbReq(db.transaction("FILE_DATA").objectStore("FILE_DATA").get(k));
if (have && !force) continue;
// parent directories first, the engine needs them to write the file
const parts = k.split("/"); let p = "";
for (let i = 1; i < parts.length - 1; i++) {
p += "/" + parts[i];
if (p === "/idbfs") continue;
const d = await idbReq(db.transaction("FILE_DATA").objectStore("FILE_DATA").get(p));
if (!d) await idbReq(db.transaction("FILE_DATA", "readwrite").objectStore("FILE_DATA").put({ timestamp: new Date(), mode: 16877 }, p));
}
await idbReq(db.transaction("FILE_DATA", "readwrite").objectStore("FILE_DATA").put({ timestamp: new Date(mir[k].t), mode: mir[k].m, contents: unb64(mir[k].c) }, k));
n++;
}
} catch (e) { SAVE.err = "restore: " + e; } finally { try { db && db.close(); } catch (e) {} }
SAVE.restored += n;
if (n) dlog("restored " + n + " save files from the backup copy");
return n;
}
const getModule = () => { const g = window.unityGame; return (g && g.Module) || window.UnityModule || null; };
function engineTick() {
const M = getModule();
if (!M) return;
if (!M.indexedDB) { M.indexedDB = window.indexedDB; dlog("set Module.indexedDB, the game can save now"); }
SAVE.engine = M.indexedDB ? "on" : "OFF";
try { if (M.asmLibraryArg && M.asmLibraryArg._JS_FileSystem_Sync) M.asmLibraryArg._JS_FileSystem_Sync(); } catch (e) {}
}
saveRestore(false).then(() => dlog("save restore check done"));
setInterval(engineTick, 1500);
setInterval(() => { if (getModule()) saveBackup(); }, 6000);
addEventListener("pagehide", () => { engineTick(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) { engineTick(); saveBackup(); } });

// ===================================================================================================
// 2. RUNTIME: reads the game's memory using the IL2CPP metadata that is loaded in the heap
// ===================================================================================================
function makeRT(M, log) {
const R = { M, ok: false, status: "idle", L: {}, meta: null, klassOf: new Map(), objs: new Map(), pages: new Set(), lastScan: 0 };
const U8 = () => M.HEAPU8, U32 = () => M.HEAPU32;
const rw = (a) => U32()[a >>> 2];
const inHeap = (a) => a > 4096 && a < U8().length - 64 && (a & 3) === 0;
const cstr = (a, max) => { if (!a) return ""; const h = U8(); let s = ""; max = max || 160; for (let i = 0; i < max; i++) { const c = h[a + i]; if (!c) break; s += String.fromCharCode(c); } return s; };
const yieldNow = () => new Promise((r) => setTimeout(r, 0));
R.cstr = cstr; R.rw = rw;

// ---- metadata -----------------------------------------------------------------------------------
R.checkMeta = (b) => {
const u = U32(), o = b >>> 2, H = (i) => [u[o + 2 + 2 * i], u[o + 3 + 2 * i]];
const str = H(2), td = H(19), img = H(20);
return str[0] > 0 && str[0] < 1e8 && str[1] > 1000 && td[1] % 92 === 0 && td[1] > 92 * 100 && img[1] % 40 === 0 && td[0] > str[0];
};
R.findMeta = () => {
const u = U32(), n = u.length - 2;
for (let i = 0; i < n; i++) if (u[i] === 0xFAB11BAF && u[i + 1] === 24 && R.checkMeta(i * 4)) return i * 4;
return -1;
};
R.parseMeta = (base) => {
const dv = new DataView(U8().buffer, base);
const H = (i) => [dv.getUint32(8 + 8 * i, true), dv.getUint32(12 + 8 * i, true)];
if (dv.getInt32(4, true) !== 24) throw new Error("metadata version " + dv.getInt32(4, true) + ", this tool knows version 24");
const m = { base, dv, str: H(2), tdef: H(19), imgs: H(20), flds: H(11), meths: H(5), pars: H(10), fdv: H(7), fdd: H(8) };
const sname = (i) => cstr(base + m.str[0] + i);
m.sname = sname;
m.T = [];
for (let i = 0; i < m.tdef[1] / 92; i++) {
const o = m.tdef[0] + i * 92;
m.T.push({ i, nm: dv.getInt32(o, true), ns: dv.getInt32(o + 4, true), byval: dv.getInt32(o + 8, true), parent: dv.getInt32(o + 20, true), flags: dv.getUint32(o + 32, true), fs: dv.getInt32(o + 36, true), ms: dv.getInt32(o + 40, true), mc: dv.getUint16(o + 68, true), fc: dv.getUint16(o + 72, true) });
}
m.byval = new Map(); m.T.forEach((t) => m.byval.set(t.byval, t.i));
let gs = 0, gc = 0;
for (let i = 0; i < m.imgs[1] / 40; i++) {
const o = m.imgs[0] + i * 40;
if (sname(dv.getInt32(o, true)) === "Assembly-CSharp.dll") { gs = dv.getInt32(o + 8, true); gc = dv.getInt32(o + 12, true); }
}
m.gameStart = gs; m.gameCount = gc;
m.name = (t) => { const T = typeof t === "number" ? m.T[t] : t; const n = sname(T.nm), ns = sname(T.ns); return (ns ? ns + "." : "") + n; };
m.byName = new Map();
m.T.forEach((t) => { const k = m.name(t); if (!m.byName.has(k)) m.byName.set(k, []); m.byName.get(k).push(t.i); });
m.tdAddr = (ti) => base + m.tdef[0] + ti * 92;
m.fieldsOf = (ti) => { const t = m.T[ti], r = []; for (let j = 0; j < t.fc; j++) { const o = m.flds[0] + (t.fs + j) * 12; r.push({ name: sname(dv.getInt32(o, true)), typeIdx: dv.getInt32(o + 4, true) }); } return r; };
m.methodsOf = (ti) => {
const t = m.T[ti], r = [];
for (let j = 0; j < t.mc; j++) {
const o = m.meths[0] + (t.ms + j) * 32;
const ps = dv.getInt32(o + 12, true), pc = dv.getUint16(o + 30, true), pars = [];
for (let k = 0; k < pc; k++) { const po = m.pars[0] + (ps + k) * 12; pars.push({ name: sname(dv.getInt32(po, true)), typeIdx: dv.getInt32(po + 8, true) }); }
r.push({ name: sname(dv.getInt32(o, true)), ret: dv.getInt32(o + 8, true), flags: dv.getUint16(o + 24, true), pars });
}
return r;
};
m.tname = (typeIdx) => { const ti = m.byval.get(typeIdx); return ti === undefined ? null : m.name(ti); };
return m;
};

// ---- class index: finds the runtime Il2CppClass for every metadata type -----------------------------
R.scanClasses = async () => {
const m = R.meta, lo = m.base + m.str[0], hi = lo + m.str[1];
const want = new Map();
for (const t of m.T) { const p = lo + t.nm; if (!want.has(p)) want.set(p, []); want.get(p).push(t.i); }
const cand = []; // [klassAddr, typedefIdx]
const CH = 1 << 22;
for (let s = 0; ; s += CH) {
const u = U32(), n = u.length - 1;
if (s >= n) break;
const e = Math.min(n, s + CH);
for (let i = s; i < e; i++) {
const w = u[i];
if (w >= lo && w < hi) {
const l = want.get(w);
if (l && i >= 2) { const nsw = u[i + 1]; for (const ti of l) if (lo + m.T[ti].ns === nsw) cand.push([i * 4 - 8, ti]); }
}
}
R.status = "indexing classes " + Math.round(e / n * 100) + "%";
await yieldNow();
}
// which byte offset inside the class holds the pointer to its metadata type definition?
const hist = {};
for (const [k, ti] of cand.slice(0, 600)) { const ta = m.tdAddr(ti); for (let o = 24; o < 120; o += 4) if (rw(k + o) === ta) hist[o] = (hist[o] || 0) + 1; }
let best = 0, bo = -1; for (const o in hist) if (hist[o] > best) { best = hist[o]; bo = +o; }
R.L.td = bo;
for (const [k, ti] of cand) {
if (bo >= 0 && rw(k + bo) !== m.tdAddr(ti)) continue;
if (!R.klassOf.has(ti)) R.klassOf.set(ti, []);
R.klassOf.get(ti).push(k);
}
R.kinv = new Map();
for (const [ti, ks] of R.klassOf) for (const k of ks) R.kinv.set(k, ti);
log("class index: " + R.kinv.size + " runtime classes, typedef pointer at +" + bo + " (" + best + " matches)");
return R.kinv.size;
};

// ---- layout calibration: where are fields / methods / parent inside Il2CppClass ----------------------
R.calibrate = () => {
const m = R.meta, L = R.L;
const lo = m.base + m.str[0];
const namePtr = (idx) => lo + idx;
const fh = {}, mh = {}, ph = {};
let tried = 0;
for (const [k, ti] of R.kinv) {
const t = m.T[ti];
if (tried > 900) break;
// parent
if (t.parent >= 0) { const pt = m.byval.get(t.parent), pk = pt !== undefined && R.klassOf.get(pt); if (pk) for (let o = 32; o < 72; o += 4) if (pk.indexOf(rw(k + o)) >= 0) ph[o] = (ph[o] || 0) + 1; }
if (t.fc >= 3) {
tried++;
const fl = m.dv, f0 = namePtr(fl.getInt32(m.flds[0] + t.fs * 12, true)), f1 = namePtr(fl.getInt32(m.flds[0] + (t.fs + 1) * 12, true)), f2 = namePtr(fl.getInt32(m.flds[0] + (t.fs + 2) * 12, true));
for (let o = 56; o < 140; o += 4) {
const fp = rw(k + o);
if (!inHeap(fp) || rw(fp) !== f0) continue;
for (const s of [20, 16, 24, 12, 28, 32]) if (inHeap(fp + 2 * s + 4) && rw(fp + s) === f1 && rw(fp + 2 * s) === f2) { const key = o + ":" + s; fh[key] = (fh[key] || 0) + 1; }
}
}
if (t.mc >= 2) {
const m0 = namePtr(m.dv.getInt32(m.meths[0] + t.ms * 32, true));
for (let o = 56; o < 140; o += 4) {
const mp = rw(k + o);
if (!inHeap(mp)) continue;
const mi = rw(mp);
if (inHeap(mi) && rw(mi + 8) === m0 && rw(mi + 12) === k) mh[o] = (mh[o] || 0) + 1;
}
}
}
const top = (h) => { let b = 0, bk = null; for (const k in h) if (h[k] > b) { b = h[k]; bk = k; } return [bk, b]; };
const tf = top(fh), tm = top(mh), tp = top(ph);
if (tf[0]) { L.fields = +tf[0].split(":")[0]; L.fstride = +tf[0].split(":")[1]; }
if (tm[0]) L.methods = +tm[0];
if (tp[0]) L.parent = +tp[0];
L.statics = L.methods ? L.methods + 16 : 0;
log("layout: fields +" + L.fields + " (stride " + L.fstride + ", " + tf[1] + " matches), methods +" + L.methods + " (" + tm[1] + "), parent +" + L.parent + " (" + tp[1] + "), statics +" + L.statics + " (assumed)");
R.ok = !!(L.fields && L.fstride && L.td >= 0);
return R.ok;
};

// ---- objects: every instance of every known class, found in one sliced pass --------------------------
R.scanObjects = async () => {
if (!R.ok) throw new Error("not connected");
const kmap = R.kinv; let lo = 1e12, hi = 0;
for (const k of kmap.keys()) { if (k < lo) lo = k; if (k > hi) hi = k; }
// pages that hold class metadata are not objects
const pg = new Set();
for (const k of kmap.keys()) pg.add(k >>> 12);
if (R.L.fields) for (const k of kmap.keys()) { const f = rw(k + R.L.fields); if (f) pg.add(f >>> 12); const mp = R.L.methods && rw(k + R.L.methods); if (mp) pg.add(mp >>> 12); }
R.pages = pg;
const found = new Map(); // typedefIdx -> [addr]
let total = 0;
const CH = 1 << 22;
for (let s = 0; ; s += CH) {
const u = U32(), n = u.length - 1;
if (s >= n) break;
const e = Math.min(n, s + CH);
for (let i = s; i < e; i += 2) { // objects are 8-byte aligned
const w = u[i];
if (w >= lo && w <= hi) {
const ti = kmap.get(w);
if (ti !== undefined && u[i + 1] === 0 && !pg.has((i * 4) >>> 12)) {
let l = found.get(ti); if (!l) found.set(ti, l = []);
if (l.length < 4000) { l.push(i * 4); total++; }
}
}
}
R.status = "scanning objects " + Math.round(e / n * 100) + "%";
await yieldNow();
}
R.objs = found; R.lastScan = Date.now();
log("object scan: " + total + " objects of " + found.size + " classes");
return total;
};

// ---- reading and writing ---------------------------------------------------------------------------
const TC = { 2: ["bool", 1], 3: ["char", 2], 4: ["sbyte", 1], 5: ["byte", 1], 6: ["short", 2], 7: ["ushort", 2], 8: ["int", 4], 9: ["uint", 4], 10: ["long", 8], 11: ["ulong", 8], 12: ["float", 4], 13: ["double", 8], 14: ["string", 4], 17: ["struct", 0], 18: ["object", 4], 28: ["object", 4], 29: ["array", 4], 15: ["ptr", 4], 24: ["ptr", 4], 25: ["ptr", 4], 21: ["generic", 4], 19: ["T", 4], 30: ["T", 4], 31: ["T", 4] };
R.klassName = (k) => cstr(rw(k + 8));
R.typedefOfKlass = (k) => { const ta = rw(k + R.L.td); const m = R.meta; const d = ta - (m.base + m.tdef[0]); if (d < 0 || d % 92) return -1; const i = d / 92; return i < m.T.length ? i : -1; };
R.fieldsOfKlass = (k) => {
const L = R.L, out = [];
const fp = rw(k + L.fields);
const ti = R.typedefOfKlass(k);
if (!fp || ti < 0) return out;
const fc = R.meta.T[ti].fc;
for (let j = 0; j < fc; j++) {
const fi = fp + j * L.fstride;
if (!inHeap(fi)) break;
const name = cstr(rw(fi)), type = rw(fi + 4), off = rw(fi + 12);
let attrs = 0, code = 0, tdata = 0;
if (inHeap(type)) { const bits = rw(type + 4); attrs = bits & 0xFFFF; code = (bits >>> 16) & 0xFF; tdata = rw(type); }
const tc = TC[code] || ["?" + code, 4];
let tn = tc[0];
if ((code === 17 || code === 18) && tdata < R.meta.T.length) tn = R.meta.name(tdata);
out.push({ name, code, tn, size: tc[1], kind: tc[0], off, isStatic: !!(attrs & 0x10), isConst: !!(attrs & 0x40), klass: k });
}
return out;
};
R.inspect = (obj) => {
const k = rw(obj);
if (!k || !R.kinv.has(k) && !inHeap(k)) return null;
const out = { obj, klass: k, name: R.klassName(k), fields: [], parents: [] };
let kk = k, guard = 0;
while (kk && inHeap(kk) && guard++ < 14) {
const nm = R.klassName(kk);
out.parents.push(nm);
if (R.L.fields) for (const f of R.fieldsOfKlass(kk)) { f.owner = nm; out.fields.push(f); }
kk = R.L.parent ? rw(kk + R.L.parent) : 0;
if (nm === "Object") break;
}
return out;
};
R.fieldAddr = (obj, f) => {
if (f.isConst) return 0;
if (f.isStatic) { const sp = R.L.statics ? rw(f.klass + R.L.statics) : 0; return sp ? sp + f.off : 0; }
return obj + f.off;
};
R.readStr = (p) => { if (!inHeap(p)) return null; const len = rw(p + 8); if (len < 0 || len > 4000) return null; const h = U8(); let s = ""; for (let i = 0; i < len; i++) s += String.fromCharCode(h[p + 12 + i * 2] | (h[p + 13 + i * 2] << 8)); return s; };
R.read = (obj, f) => {
const a = R.fieldAddr(obj, f); if (!a) return undefined;
const dv = new DataView(U8().buffer);
switch (f.kind) {
case "bool": return dv.getUint8(a) !== 0;
case "sbyte": return dv.getInt8(a);
case "byte": return dv.getUint8(a);
case "short": return dv.getInt16(a, true);
case "ushort": case "char": return dv.getUint16(a, true);
case "int": return dv.getInt32(a, true);
case "uint": return dv.getUint32(a, true);
case "long": return Number(dv.getBigInt64(a, true));
case "ulong": return Number(dv.getBigUint64(a, true));
case "float": return dv.getFloat32(a, true);
case "double": return dv.getFloat64(a, true);
default: return dv.getUint32(a, true) >>> 0;
}
};
R.write = (obj, f, v) => {
const a = R.fieldAddr(obj, f); if (!a) throw new Error("no address");
if (!f.isStatic) { const k = rw(obj); if (k !== f.klass && !R.isSub(k, f.klass)) throw new Error("object changed, rescan"); }
const dv = new DataView(U8().buffer);
switch (f.kind) {
case "bool": dv.setUint8(a, v ? 1 : 0); break;
case "sbyte": dv.setInt8(a, v); break;
case "byte": dv.setUint8(a, v); break;
case "short": dv.setInt16(a, v, true); break;
case "ushort": case "char": dv.setUint16(a, v, true); break;
case "int": dv.setInt32(a, v, true); break;
case "uint": dv.setUint32(a, v >>> 0, true); break;
case "long": dv.setBigInt64(a, BigInt(Math.round(v)), true); break;
case "ulong": dv.setBigUint64(a, BigInt(Math.round(v)), true); break;
case "float": dv.setFloat32(a, v, true); break;
case "double": dv.setFloat64(a, v, true); break;
default: dv.setUint32(a, v >>> 0, true);
}
};
R.isSub = (k, base) => { let kk = k, g = 0; while (kk && inHeap(kk) && g++ < 14) { if (kk === base) return true; kk = R.L.parent ? rw(kk + R.L.parent) : 0; } return false; };
R.show = (obj, f) => {
const v = R.read(obj, f);
if (v === undefined) return "";
if (f.kind === "float" || f.kind === "double") return String(Math.round(v * 10000) / 10000);
if (f.kind === "string") { const s = R.readStr(v); return s === null ? (v ? hex(v) : "null") : JSON.stringify(s); }
if (["object", "array", "ptr", "generic", "T", "struct"].indexOf(f.kind) >= 0 && f.kind !== "struct") return v ? hex(v) : "null";
return String(v);
};
// array helper (arrays of references or primitives)
R.arrayInfo = (obj) => {
const k = rw(obj), nm = R.klassName(k);
if (nm.slice(-2) !== "[]") return null;
const len = rw(obj + 12), el = nm.slice(0, -2);
const sz = { Single: 4, Int32: 4, UInt32: 4, Boolean: 1, Byte: 1, Int16: 2, Double: 8, Int64: 8 }[el] || 4;
return { len: Math.min(len, 400), total: len, el, sz, base: obj + 16 };
};

// ---- calling managed methods (best effort) ---------------------------------------------------------
R.methodsOfKlass = (k) => {
const L = R.L; if (!L.methods) return [];
const ti = R.typedefOfKlass(k); if (ti < 0) return [];
const md = R.meta.methodsOf(ti), mp = rw(k + L.methods), out = [];
for (let j = 0; j < md.length; j++) {
const mi = rw(mp + j * 4);
if (!inHeap(mi)) continue;
out.push({ name: md[j].name, mi, fn: rw(mi), static: !!(md[j].flags & 0x10), pars: md[j].pars.map((p) => ({ name: p.name, type: R.meta.tname(p.typeIdx) || "?" })), ret: R.meta.tname(md[j].ret) || "?" });
}
return out;
};
const SIG = (t) => { if (!t) return "i"; if (t === "System.Single") return "f"; if (t === "System.Double") return "d"; if (t === "System.Int64" || t === "System.UInt64") return "j"; if (t === "System.Void") return "v"; return "i"; };
R.call = (m, thisPtr, args) => {
let sig = SIG(m.ret);
if (sig === "j") throw new Error("64-bit return values are not supported");
const a = [];
if (!m.static) { sig += "i"; a.push(thisPtr); }
(args || []).forEach((v, i) => { const s = SIG(m.pars[i] && m.pars[i].type); if (s === "j" || s === "v") throw new Error("64-bit arguments are not supported"); sig += s; a.push(s === "i" ? (v === true ? 1 : v === false ? 0 : v | 0) : +v); });
if (m.pars.length !== (args || []).length) throw new Error(m.name + " needs " + m.pars.length + " argument(s)");
sig += "i"; a.push(m.mi); // the hidden MethodInfo argument
const f = M["dynCall_" + sig];
if (!f) throw new Error("no dynCall_" + sig + " in this build");
return f.apply(null, [m.fn].concat(a));
};

// ---- connect ----------------------------------------------------------------------------------------
R.connect = async () => {
try {
R.status = "looking for the metadata in memory";
await yieldNow();
const b = R.findMeta();
if (b < 0) throw new Error("IL2CPP metadata not found in memory");
log("metadata found at " + hex(b));
R.meta = R.parseMeta(b);
log("metadata: " + R.meta.T.length + " types, " + R.meta.gameCount + " game types");
await R.scanClasses();
if (!R.calibrate()) throw new Error("could not work out the class layout (see log)");
R.status = "connected";
return true;
} catch (e) { R.status = "failed: " + e.message; log("connect failed: " + e.message); return false; }
};
R.cls = (full) => { const l = R.meta && R.meta.byName.get(full); return l ? l : null; };
R.find = (full) => { const l = R.cls(full); if (!l) return []; let out = []; for (const ti of l) out = out.concat(R.objs.get(ti) || []); return out; };
R.fieldOf = (obj, name) => { const i = R.inspect(obj); return i ? i.fields.find((f) => f.name === name) : null; };
return R;
}

// ===================================================================================================
// 3. UI
// ===================================================================================================
let RT = null;
const S = Object.assign({ w: 360, bh: 0, zoom: 100, ui: 100, accent: "#34c759", toasts: true, tab: 0, recipes: {}, macros: [] }, (() => { try { return JSON.parse(lsGet("ssmod_settings_v1")) || {}; } catch (e) { return {}; } })());
const persist = () => lsSet("ssmod_settings_v1", JSON.stringify(S));
let toast = null;
const say = (s) => { dlog(s); if (toast) toast(s); };

const spring = "cubic-bezier(.34,1.56,.64,1)", MONO = "ui-monospace,Menlo,Consolas,monospace";
const css = `
.p{position:relative;width:var(--w,360px);max-width:96vw;color:#111;font:13px -apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;border-radius:30px;background:rgba(236,242,248,.94);box-shadow:0 14px 40px rgba(0,0,0,.35),inset 0 0 0 1px var(--ac,#34c759);user-select:none;overflow:hidden}
.h,.b{position:relative;z-index:1}
.h{padding:14px 18px 8px;display:flex;justify-content:space-between;align-items:center;cursor:grab;touch-action:none;font-weight:700;font-size:15px}
.pro{font-size:9px;letter-spacing:1px;padding:2px 6px;border-radius:8px;margin-left:8px;color:#000;vertical-align:middle;background:linear-gradient(90deg,#ffd60a,#fff4b0)}
.min{width:28px;height:28px;border-radius:50%;border:1px solid rgba(0,0,0,.15);background:#fff;color:#111;font-size:15px;cursor:pointer;padding:0}
.b{padding:2px 14px 22px;display:flex;flex-direction:column;gap:10px;max-height:var(--bh,78vh);overflow-y:auto}.b.hide{display:none}
.b::-webkit-scrollbar{width:6px}.b::-webkit-scrollbar-thumb{background:rgba(120,120,120,.4);border-radius:3px}
.rs{position:absolute;right:6px;bottom:6px;width:22px;height:22px;z-index:5;cursor:nwse-resize;touch-action:none;opacity:.7;background:linear-gradient(135deg,transparent 0 50%,var(--ac,#34c759) 50% 58%,transparent 58% 70%,var(--ac,#34c759) 70% 78%,transparent 78%);border-bottom-right-radius:24px}
.tabs{display:flex;position:relative;padding:3px;border-radius:18px;background:rgba(0,0,0,.1);flex:none}
.tab{flex:1;position:relative;z-index:1;text-align:center;padding:8px 0;font-weight:600;font-size:11px;cursor:pointer;opacity:.65}.tab.on{opacity:1}
.pill{position:absolute;top:3px;bottom:3px;left:3px;border-radius:15px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.18);transition:transform .3s ${spring}}
.pg{display:flex;flex-direction:column;gap:10px}.pg.hide{display:none}
.card{background:rgba(255,255,255,.7);border-radius:20px;padding:11px 13px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06);display:flex;flex-direction:column;gap:9px}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.lbl{font-weight:600}.lbl small{display:block;opacity:.65;font-size:11px;font-weight:400;margin-top:1px}
.ttl{font-weight:700;font-size:11px;letter-spacing:.5px;opacity:.6}
.note{font-size:11px;opacity:.7;line-height:1.35}
.btn{border:0;border-radius:16px;padding:0 13px;height:30px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);color:#111;font:600 12px -apple-system,system-ui,sans-serif;cursor:pointer;flex:none}
.btn:active{transform:scale(.94)}.btn.hot{background:var(--ac,#34c759);color:#fff}
.btns{display:flex;gap:6px;flex-wrap:wrap}.btns .btn{flex:1;padding:0 8px}
.num{width:110px;box-sizing:border-box;height:30px;background:rgba(0,0,0,.08);border:0;border-radius:15px;padding:0 11px;color:#111;font:700 12.5px ${MONO};outline:none;text-align:right;user-select:text}
.num.s{width:76px}.num.w{width:100%;text-align:left;font:12.5px -apple-system,system-ui,sans-serif}
.sw{width:50px;height:30px;border-radius:15px;background:rgba(120,120,120,.35);position:relative;cursor:pointer;transition:background .25s;flex:none}
.sw i{position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:12px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.4);transition:transform .3s ${spring}}
.sw.on{background:var(--ac,#34c759)}.sw.on i{transform:translateX(20px)}
.tbl{max-height:300px;overflow-y:auto;border-radius:16px;background:rgba(0,0,0,.06)}
.tr{min-height:30px;box-sizing:border-box;display:flex;align-items:center;gap:6px;padding:3px 8px 3px 10px;border-bottom:1px solid rgba(0,0,0,.05)}
.nm{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:11px ${MONO}}
.ty{flex:none;max-width:80px;opacity:.55;font:10px ${MONO};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tr input{width:96px;flex:none;box-sizing:border-box;background:rgba(0,0,0,.07);border:0;border-radius:9px;padding:4px 8px;color:#111;font:600 11.5px ${MONO};outline:none;text-align:right;user-select:text}
.lk{flex:none;width:24px;height:22px;border:0;border-radius:8px;background:rgba(0,0,0,.08);font-size:11px;cursor:pointer;padding:0;opacity:.6}.lk.on{background:var(--ac,#34c759);opacity:1}
.link{color:#0a64c8;cursor:pointer;text-decoration:underline}
pre.out{margin:0;padding:8px 10px;border-radius:12px;background:rgba(0,0,0,.08);font:11px/1.45 ${MONO};white-space:pre-wrap;word-break:break-all;max-height:180px;overflow:auto;user-select:text}
textarea.num{width:100%;height:110px;padding:8px 10px;border-radius:14px;text-align:left;resize:vertical;font:11.5px ${MONO}}
.meter{height:8px;border-radius:4px;background:rgba(0,0,0,.12);overflow:hidden}.meter i{display:block;height:100%;width:0;background:var(--ac,#34c759);transition:width .2s}
.toasts{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 14px);transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none}
.toast{padding:8px 16px;border-radius:18px;background:rgba(20,20,26,.85);color:#fff;font:600 12px system-ui,sans-serif;opacity:0;transform:translateY(-12px);transition:opacity .3s,transform .3s}.toast.in{opacity:1;transform:none}
`;
const el = (tag, props, kids) => { const n = document.createElement(tag); if (props) Object.assign(n, props); (kids || []).forEach((k) => n.appendChild(k)); return n; };
const host = el("div");
host.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;";
["mousedown", "mouseup", "mousemove", "click", "dblclick", "touchstart", "touchmove", "touchend", "touchcancel", "pointerdown", "pointermove", "pointerup", "pointercancel", "wheel", "contextmenu", "keydown", "keyup", "keypress", "input", "change"].forEach((ev) => host.addEventListener(ev, (e) => e.stopPropagation()));
const root = host.attachShadow({ mode: "open" });
const minBtn = el("button", { className: "min", textContent: "\u2013" });
const head = el("div", { className: "h" }, [el("span", { innerHTML: 'Subway Surfers Mod <span class="pro">PRO</span>' }), minBtn]);
const lbl = (t, s) => el("div", { className: "lbl" }, [document.createTextNode(t), el("small", { textContent: s || "" })]);
const R_ = (a, b) => el("div", { className: "row" }, [a, b]);
const RR = (...k) => el("div", { className: "row", style: "gap:6px" }, k);
const card = (title, kids) => el("div", { className: "card" }, (title ? [el("div", { className: "ttl", textContent: title })] : []).concat(kids));
const btn = (t, fn, cls) => { const b = el("button", { className: "btn" + (cls ? " " + cls : ""), textContent: t }); b.onclick = fn; return b; };
const swDraws = [];
const sw = (get, set) => { const n = el("div", { className: "sw" }, [el("i")]); const draw = () => n.classList.toggle("on", !!get()); n.onclick = () => { set(!get()); draw(); }; swDraws.push(draw); draw(); return n; };
const num = (get, set, small) => { const i = el("input", { type: "text", className: "num" + (small ? " s" : ""), spellcheck: false }); i.value = get(); i.onchange = () => { const v = Number(i.value); if (!isFinite(v)) { i.value = get(); return; } set(v); }; i.onkeydown = (e) => { if (e.key === "Enter") i.blur(); }; return i; };
const slid = (min, max, get, set, suf) => { const i = el("input", { type: "range", min, max, value: get() }); i.style.cssText = "width:110px;accent-color:var(--ac,#34c759)"; const t = el("span", { className: "nm", textContent: get() + suf }); t.style.cssText = "flex:none;width:50px;text-align:right"; i.oninput = () => { set(+i.value); t.textContent = get() + suf; }; return el("div", { className: "row", style: "gap:6px" }, [i, t]); };

// ---- state shared by the tabs ----
const state = { connecting: false, scanning: false };
const recipeBoxes = [];
const statusLines = el("pre", { className: "out" });

// ---- recipes: write a value into a field of every live object of a class ----------------------------
const G = "SYBO.Subway.Characters.Character";
const RECIPES = [
{ id: "powerups", title: "Powerup timers", sub: "magnet, jetpack, sneakers, 2x... seconds left", targets: [["Info.ActivePowerup", "timeLeft"]], def: 30000000 },
{ id: "magnet", title: "Magnet pull speed", sub: "how fast coins fly to you", targets: [["CoinMagnet", "pullSpeed"], ["LongMagnet", "pullSpeed"]], def: 300 },
{ id: "dbl", title: "Double coins value", sub: "coins per pickup while active", targets: [["DoubleCoins", "ratio"]], def: 50 },
{ id: "grav", title: "Gravity", sub: "lower = floatier", targets: [[G, "gravity"]], def: 5 },
{ id: "jump", title: "Jump height", sub: "normal jump", targets: [[G, "jumpHeightNormal"]], def: 12 },
{ id: "jumpss", title: "Super sneakers jump", sub: "jump height with sneakers", targets: [[G, "jumpHeightSuperSneakers"]], def: 40 },
{ id: "fall", title: "Fall speed limit", sub: "terminal fall speed", targets: [[G, "verticalFallSpeedLimit"]], def: 2 },
{ id: "immune", title: "Immune to critical hit", sub: "survive crashes", targets: [[G, "ImmuneToCriticalHit"]], def: 1, bool: true },
{ id: "ghost", title: "Stop colliding", sub: "ghost through obstacles", targets: [[G, "StopColliding"]], def: 1, bool: true },
{ id: "board", title: "Hoverboard cooldown distance", sub: "0 = no cooldown", targets: [["Hoverboard", "cooldownDstance"]], def: 0 },
{ id: "speed", title: "Game speed", sub: "the run speed value", targets: [["SYBO.Subway.Game", "speed"]], def: 60 }
];
function applyRecipes() {
if (!RT || !RT.ok || !RT.objs.size) return;
for (const r of RECIPES) {
const cfg = S.recipes[r.id];
if (!cfg || !cfg.on) continue;
for (const [cn, fn] of r.targets) {
for (const obj of RT.find(cn)) {
try {
const f = RT.fieldOf(obj, fn);
if (!f) continue;
if (f.kind !== "float" && f.kind !== "double" && f.kind !== "bool" && f.kind !== "int") continue;
const v = r.bool ? (cfg.v ? 1 : 0) : cfg.v;
if (RT.read(obj, f) !== (f.kind === "bool" ? !!v : v)) RT.write(obj, f, f.kind === "bool" ? !!v : v);
} catch (e) { /* object went away, the next scan fixes the list */ }
}
}
}
}
setInterval(applyRecipes, 120);
// auto refresh of the object list while something needs it
setInterval(() => {
if (!RT || !RT.ok || state.scanning) return;
const need = RECIPES.some((r) => S.recipes[r.id] && S.recipes[r.id].on) || window.__ssExplorerOpen;
if (need && Date.now() - RT.lastScan > 6000) doScan(true);
}, 1500);

async function doConnect() {
if (state.connecting) return;
state.connecting = true;
const M = getModule();
if (!M || !M.HEAPU8 || !M.asm) { say("the game is not loaded yet"); state.connecting = false; return; }
RT = makeRT(M, dlog);
const ok = await RT.connect();
if (ok) { say("connected: " + RT.kinv.size + " classes"); await doScan(false); }
else say(RT.status);
state.connecting = false;
}
async function doScan(quiet) {
if (!RT || !RT.ok || state.scanning) return;
state.scanning = true;
try { const n = await RT.scanObjects(); if (!quiet) say("found " + n + " objects"); } catch (e) { say("scan failed: " + e.message); }
state.scanning = false;
}

// ---- tabs ------------------------------------------------------------------------------------------
const meterI = el("i");
// MAIN
const saveInfo = el("pre", { className: "out" });
const incCoins = { v: 1000000 }, incKeys = { v: 1000 };
function callOn(cls, method, args) {
if (!RT || !RT.ok) throw new Error("connect first");
const objs = RT.find(cls);
if (!objs.length) throw new Error("no live " + cls + " object (scan objects, or start a run)");
const k = RT.rw(objs[0]);
const m = RT.methodsOfKlass(k).find((x) => x.name === method && x.pars.length === args.length);
if (!m) throw new Error(cls + "." + method + " not found");
return RT.call(m, objs[0], args);
}
const pageMain = el("div", { className: "pg" }, [
card("CONNECTION", [
statusLines,
el("div", { className: "meter" }, [meterI]),
el("div", { className: "btns" }, [btn("Connect to game", doConnect, "hot"), btn("Scan objects", () => doScan(false)), btn("Copy log", () => { try { navigator.clipboard.writeText(LOG.join("\n")); say("log copied"); } catch (e) { say("copy failed"); } })]),
el("div", { className: "note", textContent: "Connect once the game has loaded past the first screen. It finds the game's own class data in memory, so nothing here is guessed." })
]),
card("SAVE SYSTEM", [
saveInfo,
el("div", { className: "btns" }, [btn("Back up now", async () => { await saveBackup(); say("backed up " + SAVE.files + " save files"); }), btn("Restore backup", async () => { const n = await saveRestore(true); say(n ? "restored " + n + " files, reload the page" : "nothing to restore"); })]),
el("div", { className: "note", textContent: "The game's own save is switched on and mirrored to a backup copy every few seconds." })
]),
card("INVENTORY", [
R_(lbl("Add coins"), RR(num(() => incCoins.v, (v) => { incCoins.v = Math.round(v); }, true), btn("Add", () => { try { callOn("Data.Save.InventorySave", "IncreaseCoins", [incCoins.v]); say("added coins"); } catch (e) { say(String(e.message || e)); } }))),
R_(lbl("Add keys"), RR(num(() => incKeys.v, (v) => { incKeys.v = Math.round(v); }, true), btn("Add", () => { try { callOn("Data.Save.InventorySave", "IncreaseKeys", [incKeys.v]); say("added keys"); } catch (e) { say(String(e.message || e)); } }))),
el("div", { className: "note", textContent: "These call the game's own InventorySave methods. If one says it can't find an object, press Scan objects first." })
])
]);

// CHEATS
const cheatCards = RECIPES.map((r) => {
const cfg = S.recipes[r.id] || (S.recipes[r.id] = { on: false, v: r.def });
const cur = el("div", { className: "note", textContent: "" });
recipeBoxes.push({ r, cur });
return card(null, [
R_(lbl(r.title, r.sub), sw(() => cfg.on, (v) => { cfg.on = v; persist(); if (v && RT && RT.ok && !RT.objs.size) doScan(true); })),
R_(el("div", { className: "note", textContent: r.bool ? "value is true" : "value" }), r.bool ? el("div") : num(() => cfg.v, (v) => { cfg.v = v; persist(); }, false)),
cur
]);
});
const pageCheats = el("div", { className: "pg hide" }, [card(null, [el("div", { className: "note", textContent: "Each switch writes its value into the live game objects about 8 times a second. If a value does nothing, open the Explorer tab and look for the right variable, then freeze it there." })])].concat(cheatCards));

// EXPLORER
const exState = { cls: null, objs: [], obj: null, stack: [], search: "", locks: new Map() };
const exSearch = el("input", { type: "text", className: "num w", placeholder: "Search class or namespace...", spellcheck: false });
const exList = el("div", { className: "tbl" });
const exHead = el("div", { className: "note" });
const exFields = el("div", { className: "tbl" });
const exNav = el("div", { className: "btns" });
let exRows = [];
function exClasses() {
if (!RT || !RT.ok) { exList.innerHTML = ""; exList.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: "connect first (Main tab)" })])); return; }
const q = exSearch.value.trim().toLowerCase(), m = RT.meta, out = [];
for (let i = 0; i < m.T.length; i++) {
const t = m.T[i];
if (i < m.gameStart && !q) continue;
const nm = m.name(t);
if (q && nm.toLowerCase().indexOf(q) < 0) continue;
const c = (RT.objs.get(i) || []).length;
if (!q && !c) continue;
out.push([nm, i, c]);
}
out.sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : 1));
exList.innerHTML = "";
out.slice(0, 120).forEach(([nm, i, c]) => {
const r = el("div", { className: "tr" }, [el("div", { className: "nm link", textContent: nm, title: nm }), el("div", { className: "ty", textContent: c + " obj" })]);
r.firstChild.onclick = () => exOpenClass(i);
exList.appendChild(r);
});
if (!out.length) exList.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: q ? "no matches" : "press Scan objects" })]));
}
function exOpenClass(ti) {
exState.cls = ti; exState.objs = (RT.objs.get(ti) || []).slice(0, 60);
exState.obj = null; exState.stack = [];
exRender();
}
function exOpenObj(addr, push) {
if (push && exState.obj) exState.stack.push(exState.obj);
exState.obj = addr; exRender();
}
function exRender() {
exNav.innerHTML = ""; exFields.innerHTML = ""; exRows = [];
if (!RT || !RT.ok) return;
if (exState.obj === null) {
if (exState.cls === null) { exHead.textContent = "pick a class above"; return; }
exHead.textContent = RT.meta.name(exState.cls) + ": " + exState.objs.length + " live object(s)";
exState.objs.forEach((a, i) => { exNav.appendChild(btn("#" + (i + 1) + "  " + hex(a), () => exOpenObj(a, false))); });
return;
}
const a = exState.obj;
const ins = RT.inspect(a);
if (!ins) { exHead.textContent = "not a game object (" + hex(a) + ")"; exNav.appendChild(btn("Back", () => { exState.obj = exState.stack.pop() || null; exRender(); })); return; }
exHead.textContent = ins.name + " @ " + hex(a) + "   (" + ins.parents.slice(1, 4).join(" < ") + ")";
exNav.appendChild(btn("Back", () => { exState.obj = exState.stack.pop() || null; exRender(); }));
exNav.appendChild(btn("Refresh", exRender));
const arr = RT.arrayInfo(a);
if (arr) {
for (let i = 0; i < arr.len; i++) {
const ea = arr.base + i * arr.sz, dv = new DataView(RT.M.HEAPU8.buffer);
let v;
if (arr.sz === 4 && (arr.el === "Single")) v = dv.getFloat32(ea, true); else if (arr.sz === 4) v = dv.getUint32(ea, true) >>> 0; else if (arr.sz === 1) v = dv.getUint8(ea); else if (arr.sz === 2) v = dv.getInt16(ea, true); else v = dv.getFloat64(ea, true);
const isPtr = arr.sz === 4 && arr.el !== "Single" && arr.el !== "Int32" && arr.el !== "UInt32" && v > 4096;
const nm = el("div", { className: "nm", textContent: "[" + i + "]" });
const val = el("div", { className: "nm" + (isPtr ? " link" : ""), textContent: isPtr ? hex(v) : String(v), style: "text-align:right" });
if (isPtr) val.onclick = () => exOpenObj(v, true);
exFields.appendChild(el("div", { className: "tr" }, [nm, val]));
}
return;
}
const seen = new Set();
ins.fields.forEach((f) => {
if (f.isConst || (f.isStatic && !RT.L.statics)) return;
const key = f.owner + "." + f.name + (f.isStatic ? "#s" : "");
if (seen.has(key)) return; seen.add(key);
const editable = ["float", "double", "int", "uint", "short", "ushort", "byte", "sbyte", "bool", "long", "ulong", "char"].indexOf(f.kind) >= 0;
const isRef = ["object", "array", "generic", "T", "ptr"].indexOf(f.kind) >= 0;
const nm = el("div", { className: "nm", textContent: (f.isStatic ? "static " : "") + f.name, title: f.owner + "." + f.name });
const ty = el("div", { className: "ty", textContent: f.tn, title: f.tn });
let val;
if (editable) {
val = el("input", { type: "text", spellcheck: false, value: RT.show(a, f) });
val.onchange = () => {
try {
let v = val.value.trim();
if (f.kind === "bool") v = v === "true" || v === "1"; else { v = Number(v); if (!isFinite(v)) { val.value = RT.show(a, f); return; } }
RT.write(a, f, v); if (exState.locks.has(key)) exState.locks.get(key).v = v;
say(f.name + " = " + v);
} catch (e) { say("write failed: " + e.message); }
};
val.onkeydown = (e) => { if (e.key === "Enter") val.blur(); };
exRows.push([val, f, a]);
} else {
const t = RT.show(a, f);
val = el("div", { className: "nm" + (isRef && t.indexOf("0x") === 0 ? " link" : ""), textContent: t, style: "text-align:right;flex:none;max-width:110px" });
if (isRef && t.indexOf("0x") === 0) val.onclick = () => exOpenObj(parseInt(t, 16) >>> 0, true);
}
const kids = [nm, ty, val];
if (editable) {
const lk = el("button", { className: "lk" + (exState.locks.has(key) ? " on" : ""), textContent: "\u{1F512}", title: "freeze this value" });
lk.onclick = () => { if (exState.locks.has(key)) exState.locks.delete(key); else exState.locks.set(key, { a, f, v: RT.read(a, f) }); lk.classList.toggle("on", exState.locks.has(key)); say(exState.locks.size + " frozen"); };
kids.push(lk);
}
exFields.appendChild(el("div", { className: "tr" }, kids));
});
// methods
const ms = RT.methodsOfKlass(ins.klass).filter((m) => m.pars.length <= 2 && !/^(get_|set_|add_|remove_|\.)/.test(m.name) || /^get_/.test(m.name));
if (ms.length) {
exFields.appendChild(el("div", { className: "tr" }, [el("div", { className: "ttl", textContent: "METHODS (tap to call)" })]));
ms.slice(0, 60).forEach((m) => {
const sig = m.name + "(" + m.pars.map((p) => p.type.replace("System.", "")).join(", ") + ")";
const row = el("div", { className: "tr" }, [el("div", { className: "nm link", textContent: sig, title: m.ret + " " + sig })]);
row.firstChild.onclick = () => {
try {
const args = m.pars.map((p) => { const v = prompt(p.name + " (" + p.type + ")", "0"); if (v === null) throw new Error("cancelled"); return p.type === "System.Boolean" ? (v === "true" || v === "1") : Number(v); });
const r = RT.call(m, a, args); say(m.name + " returned " + r);
} catch (e) { say(String(e.message || e)); }
};
exFields.appendChild(row);
});
}
}
exSearch.addEventListener("input", () => { clearTimeout(exSearch.__t); exSearch.__t = setTimeout(exClasses, 200); });
const pageExplorer = el("div", { className: "pg hide" }, [
card("OBJECTS", [exSearch, exList, el("div", { className: "btns" }, [btn("Rescan objects", async () => { await doScan(false); exClasses(); })])]),
card("VARIABLES", [exHead, exNav, exFields, el("div", { className: "note", textContent: "Every variable of the selected object, live. Blue names open the object they point to. Lock icon freezes a value. Static fields depend on an assumed layout." })])
]);

// CONSOLE
const conIn = el("textarea", { className: "num", spellcheck: false, placeholder: "// examples:\n// ss.find('CoinMagnet')  -> addresses\n// ss.set(addr, 'pullSpeed', 500)\n// ss.call(addr, 'Reset')\n// ss.log" });
const conOut = el("pre", { className: "out", textContent: "(output)" });
const macroBox = el("div", { className: "btns" });
const macroName = el("input", { type: "text", className: "num w", placeholder: "name for a custom button..." });
const api = {
get RT() { return RT; }, log: LOG, hex,
find: (c) => (RT ? RT.find(c) : []),
inspect: (a) => (RT ? RT.inspect(a) : null),
get: (a, n) => { const f = RT.fieldOf(a, n); if (!f) throw new Error("no field " + n); return RT.read(a, f); },
set: (a, n, v) => { const f = RT.fieldOf(a, n); if (!f) throw new Error("no field " + n); RT.write(a, f, v); return v; },
call: (a, n, ...args) => { const k = RT.rw(a); const m = RT.methodsOfKlass(k).find((x) => x.name === n && x.pars.length === args.length); if (!m) throw new Error("no method " + n + "/" + args.length); return RT.call(m, a, args); },
callStatic: (cls, n, ...args) => { const l = RT.cls(cls); if (!l) throw new Error("no class " + cls); const k = (RT.klassOf.get(l[0]) || [])[0]; const m = RT.methodsOfKlass(k).find((x) => x.name === n && x.pars.length === args.length && x.static); if (!m) throw new Error("no static method"); return RT.call(m, 0, args); },
scan: () => doScan(false), u32: (a) => RT.M.HEAPU32[a >>> 2], f32: (a) => RT.M.HEAPF32[a >>> 2],
setU32: (a, v) => { RT.M.HEAPU32[a >>> 2] = v >>> 0; }, setF32: (a, v) => { RT.M.HEAPF32[a >>> 2] = v; },
Module: () => getModule(), say
};
window.ss = api;
function runCode(code) {
try { const r = (0, eval)("(function(ss){ return (" + code + "\n)})") ; let v; try { v = r(api); } catch (e1) { v = (0, eval)("(function(ss){" + code + "\n})")(api); } return v; } catch (e) { throw e; }
}
function runConsole() {
try { const v = runCode(conIn.value); conOut.textContent = v === undefined ? "ok" : (typeof v === "object" ? JSON.stringify(v, null, 1) : String(v)); } catch (e) { conOut.textContent = "error: " + (e.message || e); }
}
function drawMacros() {
macroBox.innerHTML = "";
S.macros.forEach((m, i) => {
const b = btn(m.name, () => { try { runCode(m.code); say(m.name + " ran"); } catch (e) { say(m.name + ": " + (e.message || e)); } });
b.oncontextmenu = (e) => { e.preventDefault(); S.macros.splice(i, 1); persist(); drawMacros(); };
macroBox.appendChild(b);
});
}
const pageConsole = el("div", { className: "pg hide" }, [
card("CUSTOM CODE", [conIn, el("div", { className: "btns" }, [btn("Run", runConsole, "hot"), btn("Clear", () => { conIn.value = ""; conOut.textContent = "(output)"; })]), conOut,
el("div", { className: "note", textContent: "JavaScript with the helper object ss (find, inspect, get, set, call, callStatic, u32, f32 ...). Also available as ss in the browser console." })]),
card("MY BUTTONS", [macroName, el("div", { className: "btns" }, [btn("Save code as button", () => { const n = macroName.value.trim(); if (!n || !conIn.value.trim()) { say("give it a name and some code"); return; } S.macros.push({ name: n, code: conIn.value }); persist(); drawMacros(); macroName.value = ""; })]), macroBox, el("div", { className: "note", textContent: "Right-click (or long-press) a custom button to delete it." })])
]);

// PREFS
const logOut = el("pre", { className: "out" });
const applyLook = () => {
host.style.setProperty("--ac", S.accent); host.style.setProperty("--w", S.w + "px"); host.style.setProperty("--bh", S.bh ? S.bh + "px" : "78vh");
host.style.opacity = S.ui / 100; if (panel) panel.style.zoom = S.zoom / 100;
};
const accent = el("input", { type: "color", value: S.accent });
accent.style.cssText = "width:50px;height:30px;border:0;padding:0;background:none;cursor:pointer";
accent.oninput = () => { S.accent = accent.value; applyLook(); persist(); };
const pagePrefs = el("div", { className: "pg hide" }, [
card("APPEARANCE", [
R_(lbl("Accent color"), accent),
R_(lbl("Panel opacity"), slid(30, 100, () => S.ui, (v) => { S.ui = v; applyLook(); persist(); }, "%")),
R_(lbl("Text size"), slid(60, 160, () => S.zoom, (v) => { S.zoom = v; applyLook(); persist(); }, "%")),
R_(lbl("Toasts"), sw(() => S.toasts, (v) => { S.toasts = v; persist(); })),
R_(lbl("Reset panel size"), btn("Reset", () => { S.w = 360; S.bh = 0; S.zoom = 100; applyLook(); persist(); })),
el("div", { className: "note", textContent: "Drag the corner handle at the bottom right to resize. Press H to hide or show the panel." })
]),
card("LOG", [logOut, el("div", { className: "btns" }, [btn("Copy log", () => { try { navigator.clipboard.writeText(LOG.join("\n")); say("log copied"); } catch (e) { say("copy failed"); } })])])
]);

const TABS = [["Main", pageMain], ["Cheats", pageCheats], ["Explorer", pageExplorer], ["Console", pageConsole], ["Prefs", pagePrefs]];
const pill = el("div", { className: "pill" }); pill.style.width = "calc((100% - 6px) / " + TABS.length + ")";
const tabEls = TABS.map(([name], i) => { const t = el("div", { className: "tab", textContent: name }); t.onclick = () => setTab(i); return t; });
const setTab = (i) => {
S.tab = i; persist(); window.__ssExplorerOpen = i === 2;
pill.style.transform = "translateX(" + (i * 100) + "%)";
tabEls.forEach((t, j) => t.classList.toggle("on", j === i));
TABS.forEach(([, p], j) => p.classList.toggle("hide", j !== i));
if (i === 2) { exClasses(); exRender(); }
};
const body = el("div", { className: "b" }, [el("div", { className: "tabs" }, [pill].concat(tabEls))].concat(TABS.map((t) => t[1])));
const rs = el("div", { className: "rs", title: "drag to resize" });
const panel = el("div", { className: "p" }, [head, body, rs]);
const toastBox = el("div", { className: "toasts" });
let lastToast = 0;
toast = (msg) => {
if (!S.toasts) return;
const nw = performance.now(); if (nw - lastToast < 250) return; lastToast = nw;
const n = el("div", { className: "toast", textContent: msg });
toastBox.appendChild(n);
requestAnimationFrame(() => requestAnimationFrame(() => n.classList.add("in")));
setTimeout(() => { n.classList.remove("in"); setTimeout(() => n.remove(), 350); }, 2400);
while (toastBox.children.length > 3) toastBox.firstChild.remove();
};
function mount() {
root.appendChild(el("style", { textContent: css }));
root.appendChild(panel); root.appendChild(toastBox);
document.body.appendChild(host);
applyLook(); drawMacros(); setTab(S.tab >= 0 && S.tab < TABS.length ? S.tab : 0);
}
if (document.body) mount(); else addEventListener("DOMContentLoaded", mount);

// ---- periodic refresh --------------------------------------------------------------------------------
setInterval(() => {
if (body.classList.contains("hide")) return;
swDraws.forEach((f) => { try { f(); } catch (e) {} });
const M = getModule();
statusLines.textContent = "game: " + (M && M.HEAPU8 ? "loaded (" + Math.round(M.HEAPU8.length / 1048576) + " MB heap)" : "not loaded yet") + "\nruntime: " + (RT ? RT.status : "not connected") + "\nobjects: " + (RT && RT.objs.size ? Array.from(RT.objs.values()).reduce((a, b) => a + b.length, 0) + " in " + RT.objs.size + " classes" : "-");
meterI.style.width = (RT && RT.ok ? 100 : state.connecting ? 50 : 0) + "%";
saveInfo.textContent = "engine save sync: " + SAVE.engine + "\nbackup files: " + SAVE.files + (SAVE.lastBackup ? "  (last " + new Date(SAVE.lastBackup).toLocaleTimeString() + ")" : "") + "\nrestored this session: " + SAVE.restored + (SAVE.err ? "\nnote: " + SAVE.err : "");
recipeBoxes.forEach(({ r, cur }) => {
let t = "";
if (RT && RT.ok && RT.objs.size) {
const [cn, fn] = r.targets[0], objs = RT.find(cn);
if (!objs.length) t = "no live " + cn.split(".").pop() + " object right now";
else { try { const f = RT.fieldOf(objs[0], fn); t = f ? "now: " + RT.show(objs[0], f) + "  (" + objs.length + " object" + (objs.length > 1 ? "s" : "") + ", " + f.tn + ")" : "field " + fn + " not found"; } catch (e) { t = ""; } }
} else t = "connect first";
if (cur.textContent !== t) cur.textContent = t;
});
if (S.tab === 2) exRows.forEach(([inp, f, a]) => { if (root.activeElement === inp) return; try { const s = RT.show(a, f); if (inp.value !== s) inp.value = s; } catch (e) {} });
if (S.tab === 4) logOut.textContent = LOG.slice(-60).join("\n");
}, 500);
// frozen explorer values
setInterval(() => { exState.locks.forEach((L) => { try { RT.write(L.a, L.f, L.v); } catch (e) {} }); }, 100);

// ---- drag, resize, hide ---------------------------------------------------------------------------
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
let dx = 0, dy = 0, drag = false;
head.addEventListener("pointerdown", (e) => { if (e.target === minBtn) return; drag = true; dx = e.clientX - host.offsetLeft; dy = e.clientY - host.offsetTop; head.setPointerCapture(e.pointerId); });
head.addEventListener("pointermove", (e) => { if (!drag) return; host.style.left = clamp(e.clientX - dx, 0, Math.max(0, innerWidth - host.offsetWidth)) + "px"; host.style.top = clamp(e.clientY - dy, 0, Math.max(0, innerHeight - host.offsetHeight)) + "px"; });
head.addEventListener("pointerup", () => { drag = false; }); head.addEventListener("pointercancel", () => { drag = false; });
minBtn.onclick = () => body.classList.toggle("hide");
let rsd = null;
rs.addEventListener("pointerdown", (e) => { e.preventDefault(); rsd = { x: e.clientX, y: e.clientY, w: S.w, h: body.offsetHeight }; try { rs.setPointerCapture(e.pointerId); } catch (x) {} });
rs.addEventListener("pointermove", (e) => { if (!rsd) return; const z = S.zoom / 100; S.w = clamp(Math.round(rsd.w + (e.clientX - rsd.x) / z), 280, 900); S.bh = clamp(Math.round(rsd.h + (e.clientY - rsd.y) / z), 140, 1400); applyLook(); });
const rsEnd = () => { if (rsd) persist(); rsd = null; };
rs.addEventListener("pointerup", rsEnd); rs.addEventListener("pointercancel", rsEnd);
rs.addEventListener("dblclick", () => { S.w = 360; S.bh = 0; applyLook(); persist(); });
addEventListener("keydown", (e) => {
const t = (e.composedPath && e.composedPath()[0]) || e.target;
if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
if ((e.key === "h" || e.key === "H") && !e.ctrlKey && !e.metaKey && !e.altKey) host.style.display = host.style.display === "none" ? "" : "none";
});

dlog("Subway Surfers mod loaded. Save fix active, connect from the Main tab once the game is running.");
window.__ssRT = () => RT;
window.__ssMakeRT = makeRT; // for testing
})();