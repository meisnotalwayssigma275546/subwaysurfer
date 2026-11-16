/* Subway Surfers (Unity WebGL 2019.4, IL2CPP) mod, v7 (Dedicated GUI Tab)
 * Load it in index.html BEFORE master-loader.js:   <script src="mod.js"></script>
 */
(function () {
if (window.__ssMod) return;
window.__ssMod = true;

const LOG = [];
const dlog = (s) => { LOG.push(new Date().toLocaleTimeString() + "  " + s); if (LOG.length > 500) LOG.shift(); try { console.log("[ssmod]", s); } catch (e) {} };
const hex = (n) => "0x" + (n >>> 0).toString(16);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const getModule = () => { const g = window.unityGame; return (g && g.Module) || window.UnityModule || null; };

// ===================================================================================================
// SAVE SYSTEM
// ===================================================================================================
const SAVE = { engine: "waiting", lastBackup: 0, files: 0, restored: 0, err: "" };
const MIRROR = "ssmod_save_mirror_v1";
const SAVE_PAT = /Save\/|PlayerPrefs|prefs|\.json$/i;
const SAVE_MAX = 600 * 1024;
const idbReq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbOpen = () => new Promise((res, rej) => {
let r;
try { r = indexedDB.open("/idbfs", 21); } catch (e) { return rej(e); }
r.onupgradeneeded = (e) => {
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
const keys = await idbReq(db.transaction("FILE_DATA").objectStore("FILE_DATA").getAllKeys());
const out = {}; let n = 0;
for (const k of keys) {
if (!SAVE_PAT.test(k)) continue;
const v = await idbReq(db.transaction("FILE_DATA").objectStore("FILE_DATA").get(k));
if (v && v.contents && v.contents.length <= SAVE_MAX) { out[k] = { m: v.mode, t: +v.timestamp || Date.now(), c: b64(v.contents) }; n++; }
}
SAVE.files = n;
if (n) { if (lsSet(MIRROR, JSON.stringify(out))) { SAVE.lastBackup = Date.now(); SAVE.err = ""; } else SAVE.err = "backup too big for localStorage"; }
} catch (e) { SAVE.err = "backup: " + e; } finally { try { db && db.close(); } catch (e) {} }
}
async function saveRestore(force, rawIn) {
const raw = rawIn || lsGet(MIRROR);
if (!raw) return 0;
let db, n = 0;
try {
const mir = JSON.parse(raw);
db = await idbOpen();
for (const k of Object.keys(mir)) {
const have = await idbReq(db.transaction("FILE_DATA").objectStore("FILE_DATA").get(k));
if (have && !force) continue;
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
function engineTick() {
const M = getModule();
if (!M) return;
if (!M.indexedDB) { M.indexedDB = window.indexedDB; dlog("set Module.indexedDB, the game can save now"); }
SAVE.engine = M.indexedDB ? "on" : "OFF";
try { if (M.asmLibraryArg && M.asmLibraryArg._JS_FileSystem_Sync) M.asmLibraryArg._JS_FileSystem_Sync(); } catch (e) {}
}
saveRestore(false);
setInterval(engineTick, 1500);
setInterval(() => { if (getModule()) saveBackup(); }, 6000);
addEventListener("pagehide", engineTick);
document.addEventListener("visibilitychange", () => { if (document.hidden) { engineTick(); saveBackup(); } });

// ===================================================================================================
// MEMORY SCANNER
// ===================================================================================================
const MS = { prev: [], type: "int32", busy: false };
const msStep = (t) => t === "int8" ? 1 : t === "int16" ? 2 : t === "double" ? 8 : 4;
const msReadDV = (dv, a, t) => {
switch (t) {
case "int32": return dv.getInt32(a, true);
case "uint32": return dv.getUint32(a, true);
case "float": return dv.getFloat32(a, true);
case "double": return dv.getFloat64(a, true);
case "int16": return dv.getInt16(a, true);
case "int8": return dv.getInt8(a);
}
return NaN;
};
const msWriteDV = (dv, a, t, v) => {
switch (t) {
case "int32": dv.setInt32(a, v | 0, true); break;
case "uint32": dv.setUint32(a, v >>> 0, true); break;
case "float": dv.setFloat32(a, +v, true); break;
case "double": dv.setFloat64(a, +v, true); break;
case "int16": dv.setInt16(a, v, true); break;
case "int8": dv.setInt8(a, v); break;
}
};
function msRead(addr, t) { const M = getModule(); return M ? msReadDV(new DataView(M.HEAPU8.buffer), addr >>> 0, t) : NaN; }
function msWrite(addr, t, v) { const M = getModule(); if (M) msWriteDV(new DataView(M.HEAPU8.buffer), addr >>> 0, t, v); }
function msScanSync(t, v) {
const M = getModule(); if (!M) throw new Error("game module not loaded yet");
const dv = new DataView(M.HEAPU8.buffer), n = M.HEAPU8.length, s = msStep(t), out = [];
for (let a = s; a < n - s; a += s) { if (msReadDV(dv, a, t) === v) out.push(a); if (out.length > 200000) break; }
return out;
}
async function msFirstScan(t, v, cb) {
const M = getModule(); if (!M) throw new Error("game module not loaded yet");
const dv = new DataView(M.HEAPU8.buffer), n = M.HEAPU8.length, s = msStep(t), out = [];
const CH = 1 << 22;
for (let a = s; a < n - s; a += CH) {
const e = Math.min(n - s, a + CH);
for (let i = a; i < e; i += s) if (msReadDV(dv, i, t) === v) out.push(i);
if (cb) cb(Math.min(1, e / n));
await new Promise(r => setTimeout(r, 0));
if (out.length > 200000) break;
}
return out;
}
function msNextScan(t, v, prev) {
const M = getModule(); if (!M) return [];
const dv = new DataView(M.HEAPU8.buffer);
return prev.filter(a => msReadDV(dv, a, t) === v);
}

// ===================================================================================================
// RUNTIME
// <RT>
function makeRT(M, log) {
const R = { M, ok: false, status: "idle", L: {}, meta: null, klassOf: new Map(), kinv: new Map(), objs: new Map(), lastScan: 0, cache: new Map(), enums: new Map(), mcache: new Map(), cycles: 0, strCache: new Map(), subCache: new Map() };
const U8 = () => M.HEAPU8, U32 = () => M.HEAPU32;
let dvBuf = null, dvv = null;
const DV = () => { const b = U8().buffer; if (b !== dvBuf) { dvBuf = b; dvv = new DataView(b); } return dvv; };
const rw = (a) => U32()[a >>> 2];
const inHeap = (a) => a > 4096 && a < U8().length - 64 && (a & 3) === 0;
const cstr = (a, max) => { if (!a) return ""; const h = U8(); let s = ""; max = max || 160; for (let i = 0; i < max; i++) { const c = h[a + i]; if (!c) break; s += String.fromCharCode(c); } return s; };
const yieldNow = () => new Promise((r) => setTimeout(r, 0));
R.cstr = cstr; R.rw = rw; R.inHeap = inHeap;

R.checkMeta = (b) => {
const u = U32(), o = b >>> 2, H = (i) => [u[o + 2 + 2 * i], u[o + 3 + 2 * i]];
const str = H(2), td = H(19), img = H(20);
return str[0] > 0 && str[0] < 1e8 && str[1] > 1000 && td[1] % 92 === 0 && td[1] > 92 * 100 && img[1] % 40 === 0 && td[0] > str[0];
};
R.findMeta = () => { const u = U32(), n = u.length - 2; for (let i = 0; i < n; i++) if (u[i] === 0xFAB11BAF && u[i + 1] === 24 && R.checkMeta(i * 4)) return i * 4; return -1; };
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
m.defs = new Map();
for (let i = 0; i < m.fdv[1] / 12; i++) { const o = m.fdv[0] + i * 12; m.defs.set(dv.getInt32(o, true), dv.getInt32(o + 8, true)); }
let gs = 0, gc = 0;
m.images = [];
for (let i = 0; i < m.imgs[1] / 40; i++) { const o = m.imgs[0] + i * 40; const inm = sname(dv.getInt32(o, true)); m.images.push({ name: inm.replace(/\.dll$/, ""), start: dv.getInt32(o + 8, true), count: dv.getInt32(o + 12, true) }); if (inm === "Assembly-CSharp.dll") { gs = dv.getInt32(o + 8, true); gc = dv.getInt32(o + 12, true); } }
m.gameStart = gs; m.gameCount = gc;
m.assemblyOf = (ti) => { for (const im of m.images) if (ti >= im.start && ti < im.start + im.count) return im.name; return "Assembly-CSharp"; };
m.name = (t) => { const T = typeof t === "number" ? m.T[t] : t; const n = sname(T.nm), ns = sname(T.ns); return (ns ? ns + "." : "") + n; };
m.byName = new Map();
m.T.forEach((t) => { const k = m.name(t); if (!m.byName.has(k)) m.byName.set(k, []); m.byName.get(k).push(t.i); });
m.tdAddr = (ti) => base + m.tdef[0] + ti * 92;
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
m.isEnum = (ti) => { const p = m.T[ti].parent; const pt = p >= 0 ? m.byval.get(p) : undefined; return pt !== undefined && m.name(pt) === "System.Enum"; };
m.enumMembers = (ti) => {
if (R.enums.has(ti)) return R.enums.get(ti);
const t = m.T[ti], out = [];
for (let j = 0; j < t.fc; j++) {
const fi = t.fs + j, nm = sname(dv.getInt32(m.flds[0] + fi * 12, true));
if (nm === "value__") continue;
const d = m.defs.get(fi);
if (d !== undefined) out.push({ name: nm, value: dv.getInt32(m.fdd[0] + d, true) });
}
R.enums.set(ti, out);
return out;
};
return m;
};

R.scanClasses = async () => {
const m = R.meta, lo = m.base + m.str[0], hi = lo + m.str[1];
const want = new Map();
for (const t of m.T) { const p = lo + t.nm; if (!want.has(p)) want.set(p, []); want.get(p).push(t.i); }
const cand = [];
const CH = 1 << 22;
for (let s = 0; ; s += CH) {
const u = U32(), n = u.length - 1;
if (s >= n) break;
const e = Math.min(n, s + CH);
for (let i = s; i < e; i++) {
const w = u[i];
if (w >= lo && w < hi) { const l = want.get(w); if (l && i >= 2) { const nsw = u[i + 1]; for (const ti of l) if (lo + m.T[ti].ns === nsw) cand.push([i * 4 - 8, ti]); } }
}
R.status = "indexing classes " + Math.round(e / n * 100) + "%";
await yieldNow();
}
if (R.L.td === undefined) {
const hist = {};
for (const [k, ti] of cand.slice(0, 600)) { const ta = m.tdAddr(ti); for (let o = 24; o < 120; o += 4) if (rw(k + o) === ta) hist[o] = (hist[o] || 0) + 1; }
let best = 0, bo = -1; for (const o in hist) if (hist[o] > best) { best = hist[o]; bo = +o; }
R.L.td = bo;
log("typedef pointer at +" + bo + " (" + best + " matches)");
}
const klassOf = new Map(), kinv = new Map();
for (const [k, ti] of cand) {
if (R.L.td >= 0 && rw(k + R.L.td) !== m.tdAddr(ti)) continue;
if (!klassOf.has(ti)) klassOf.set(ti, []);
klassOf.get(ti).push(k); kinv.set(k, ti);
}
R.klassOf = klassOf; R.kinv = kinv; R.subCache = new Map();
return kinv.size;
};

R.calibrate = () => {
const m = R.meta, L = R.L, lo = m.base + m.str[0];
const fh = {}, mh = {}, ph = {};
let tried = 0;
for (const [k, ti] of R.kinv) {
const t = m.T[ti];
if (tried > 900) break;
if (t.parent >= 0) { const pt = m.byval.get(t.parent), pk = pt !== undefined && R.klassOf.get(pt); if (pk) for (let o = 32; o < 72; o += 4) if (pk.indexOf(rw(k + o)) >= 0) ph[o] = (ph[o] || 0) + 1; }
if (t.fc >= 3) {
tried++;
const f0 = lo + m.dv.getInt32(m.flds[0] + t.fs * 12, true), f1 = lo + m.dv.getInt32(m.flds[0] + (t.fs + 1) * 12, true), f2 = lo + m.dv.getInt32(m.flds[0] + (t.fs + 2) * 12, true);
for (let o = 56; o < 140; o += 4) {
const fp = rw(k + o);
if (!inHeap(fp) || rw(fp) !== f0) continue;
for (const s of [20, 16, 24, 12, 28, 32]) if (inHeap(fp + 2 * s + 4) && rw(fp + s) === f1 && rw(fp + 2 * s) === f2) { const key = o + ":" + s; fh[key] = (fh[key] || 0) + 1; }
}
}
if (t.mc >= 2) {
const m0 = lo + m.dv.getInt32(m.meths[0] + t.ms * 32, true);
for (let o = 56; o < 140; o += 4) { const mp = rw(k + o); if (!inHeap(mp)) continue; const mi = rw(mp); if (inHeap(mi) && rw(mi + 8) === m0 && rw(mi + 12) === k) mh[o] = (mh[o] || 0) + 1; }
}
}
const top = (h) => { let b = 0, bk = null; for (const k in h) if (h[k] > b) { b = h[k]; bk = k; } return [bk, b]; };
const tf = top(fh), tm = top(mh), tp = top(ph);
if (tf[0]) { L.fields = +tf[0].split(":")[0]; L.fstride = +tf[0].split(":")[1]; }
if (tm[0]) L.methods = +tm[0];
if (tp[0]) L.parent = +tp[0];
L.statics = L.methods ? L.methods + 16 : 0;
if (tf[1] >= 3) log("layout: fields +" + L.fields + " (stride " + L.fstride + ", " + tf[1] + " matches), methods +" + L.methods + " (" + tm[1] + "), parent +" + L.parent + " (" + tp[1] + ")");
R.ok = !!(L.fields && L.fstride && L.td >= 0 && tf[1] >= 3);
return R.ok;
};

R.scanObjects = async () => {
if (!R.ok) throw new Error("not connected");
const kmap = R.kinv; let lo = 1e12, hi = 0;
for (const k of kmap.keys()) { if (k < lo) lo = k; if (k > hi) hi = k; }
const pg = new Set();
for (const k of kmap.keys()) { pg.add(k >>> 12); const f = rw(k + R.L.fields); if (f) pg.add(f >>> 12); const mp = R.L.methods && rw(k + R.L.methods); if (mp) pg.add(mp >>> 12); }
const found = new Map();
let total = 0;
const CH = 1 << 22;
for (let s = 0; ; s += CH) {
const u = U32(), n = u.length - 1;
if (s >= n) break;
const e = Math.min(n, s + CH);
for (let i = s; i < e; i += 2) {
const w = u[i];
if (w >= lo && w <= hi) {
const ti = kmap.get(w);
if (ti !== undefined && u[i + 1] === 0 && !pg.has((i * 4) >>> 12)) { let l = found.get(ti); if (!l) found.set(ti, l = []); if (l.length < 4000) { l.push(i * 4); total++; } }
}
}
R.status = "scanning objects " + Math.round(e / n * 100) + "%";
await yieldNow();
}
R.objs = found; R.lastScan = Date.now(); R.total = total;
return total;
};

const TC = { 2: ["bool", 1], 3: ["char", 2], 4: ["sbyte", 1], 5: ["byte", 1], 6: ["short", 2], 7: ["ushort", 2], 8: ["int", 4], 9: ["uint", 4], 10: ["long", 8], 11: ["ulong", 8], 12: ["float", 4], 13: ["double", 8], 14: ["string", 4], 17: ["struct", 0], 18: ["object", 4], 28: ["object", 4], 29: ["array", 4], 15: ["ptr", 4], 24: ["ptr", 4], 25: ["ptr", 4], 21: ["generic", 4], 19: ["T", 4], 30: ["T", 4], 31: ["T", 4] };
R.klassName = (k) => cstr(rw(k + 8));
R.typedefOfKlass = (k) => { if (R.L.td < 0) return -1; const ta = rw(k + R.L.td), m = R.meta, d = ta - (m.base + m.tdef[0]); if (d < 0 || d % 92) return -1; const i = d / 92; return i < m.T.length ? i : -1; };
R.fieldsOfKlass = (k) => {
const L = R.L, out = [], m = R.meta;
const fp = rw(k + L.fields), ti = R.typedefOfKlass(k);
if (!fp || ti < 0) return out;
for (let j = 0; j < m.T[ti].fc; j++) {
const fi = fp + j * L.fstride;
if (!inHeap(fi)) break;
const name = cstr(rw(fi)), type = rw(fi + 4), off = rw(fi + 12);
let attrs = 0, code = 0, tdata = 0;
if (inHeap(type)) { const bits = rw(type + 4); attrs = bits & 0xFFFF; code = (bits >>> 16) & 0xFF; tdata = rw(type); }
const tc = TC[code] || ["?" + code, 4];
let tn = tc[0], kind = tc[0], enumTi = -1;
if ((code === 17 || code === 18) && tdata < m.T.length) {
tn = m.name(tdata);
if (code === 17 && m.isEnum(tdata)) { kind = "int"; enumTi = tdata; }
}
out.push({ name, code, tn, kind, size: tc[1], off, isStatic: !!(attrs & 0x10), isConst: !!(attrs & 0x40), klass: k, enumTi });
}
return out;
};
R.klassFields = (k) => {
let c = R.cache.get(k); if (c) return c;
c = []; let kk = k, g = 0;
while (kk && inHeap(kk) && g++ < 14) {
const nm = R.klassName(kk);
for (const f of R.fieldsOfKlass(kk)) { f.owner = nm; c.push(f); }
kk = R.L.parent ? rw(kk + R.L.parent) : 0;
if (nm === "Object") break;
}
if (c.length) R.cache.set(k, c);
return c;
};
R.inspect = (obj) => {
if (!inHeap(obj)) return null;
const k = rw(obj);
if (!k || !inHeap(k) || !R.klassName(k)) return null;
const parents = []; let kk = k, g = 0;
while (kk && inHeap(kk) && g++ < 14) { parents.push(R.klassName(kk)); kk = R.L.parent ? rw(kk + R.L.parent) : 0; }
return { obj, klass: k, name: parents[0], parents, fields: R.klassFields(k) };
};
R.fieldOf = (obj, name) => { const f = R.klassFields(rw(obj)); for (let i = 0; i < f.length; i++) if (f[i].name === name) return f[i]; return null; };
R.fieldAddr = (obj, f) => { if (f.isConst) return 0; if (f.isStatic) { const sp = R.L.statics ? rw(f.klass + R.L.statics) : 0; return sp ? sp + f.off : 0; } return obj + f.off; };
R.isSub = (k, base) => { let kk = k, g = 0; while (kk && inHeap(kk) && g++ < 14) { if (kk === base) return true; kk = R.L.parent ? rw(kk + R.L.parent) : 0; } return false; };
R.readStr = (p) => { if (!inHeap(p)) return null; const len = rw(p + 8); if (len < 0 || len > 4000) return null; const h = U8(); let s = ""; for (let i = 0; i < len; i++) s += String.fromCharCode(h[p + 12 + i * 2] | (h[p + 13 + i * 2] << 8)); return s; };
R.read = (obj, f) => {
const a = R.fieldAddr(obj, f); if (!a) return undefined;
const dv = DV();
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
if (!f.isStatic) { const k = rw(obj); if (k !== f.klass && !R.isSub(k, f.klass)) throw new Error("object changed"); }
const dv = DV();
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
R.show = (obj, f) => {
const v = R.read(obj, f);
if (v === undefined) return "";
if (f.enumTi >= 0) { const e = R.meta.enumMembers(f.enumTi).find((x) => x.value === v); return e ? e.name + " (" + v + ")" : String(v); }
if (f.kind === "float" || f.kind === "double") return String(Math.round(v * 10000) / 10000);
if (f.kind === "string") { const s = R.readStr(v); return s === null ? (v ? hex(v) : "null") : JSON.stringify(s); }
if (["object", "array", "ptr", "generic", "T", "struct"].indexOf(f.kind) >= 0) return v ? hex(v) : "null";
return String(v);
};
R.arrayInfo = (obj) => {
const k = rw(obj), nm = R.klassName(k);
if (nm.slice(-2) !== "[]") return null;
const len = rw(obj + 12), el = nm.slice(0, -2);
const sz = { Single: 4, Int32: 4, UInt32: 4, Boolean: 1, Byte: 1, Int16: 2, Double: 8, Int64: 8 }[el] || 4;
return { len: Math.min(len, 400), total: len, el, sz, base: obj + 16 };
};
R.listItems = (listObj) => {
const fi = R.fieldOf(listObj, "_items"), fs = R.fieldOf(listObj, "_size");
if (!fi || !fs) return [];
const arr = R.read(listObj, fi), n = R.read(listObj, fs);
if (!arr || !inHeap(arr)) return [];
const out = [];
for (let i = 0; i < n && i < 3000; i++) out.push(rw(arr + 16 + i * 4));
return out;
};
R.arrayItems = (arr) => { if (!inHeap(arr)) return []; const n = Math.min(rw(arr + 12), 4000), out = []; for (let i = 0; i < n; i++) out.push(rw(arr + 16 + i * 4)); return out; };

R.methodsOfKlass = (k) => {
const hit = R.mcache.get(k); if (hit) return hit;
const L = R.L; if (!L.methods) return [];
const ti = R.typedefOfKlass(k); if (ti < 0) return [];
const md = R.meta.methodsOf(ti), mp = rw(k + L.methods), out = [];
if (!mp) return out;
for (let j = 0; j < md.length; j++) {
const mi = rw(mp + j * 4);
if (!inHeap(mi)) continue;
out.push({ name: md[j].name, mi, fn: rw(mi), static: !!(md[j].flags & 0x10), pars: md[j].pars.map((p) => ({ name: p.name, type: R.meta.tname(p.typeIdx) || "?" })), ret: R.meta.tname(md[j].ret) || "?", owner: R.klassName(k), klass: k });
}
if (out.length) R.mcache.set(k, out);
return out;
};
R.methodsChain = (k) => { const out = []; let kk = k, g = 0; while (kk && inHeap(kk) && g++ < 14) { for (const m of R.methodsOfKlass(kk)) out.push(m); kk = R.L.parent ? rw(kk + R.L.parent) : 0; } return out; };
R.findMethod = (k, name, argc) => R.methodsChain(k).find((m) => m.name === name && m.pars.length === argc) || null;
R.methodByMI = (mi) => { const k = rw(mi + 12); if (!inHeap(k)) return null; return R.methodsOfKlass(k).find((x) => x.mi === mi) || null; };

R.klassByName = (full) => { const l = R.cls(full); return l ? ((R.klassOf.get(l[0]) || [])[0] || 0) : 0; };
R.typesByShort = (short) => { const out = []; for (const [k, l] of R.meta.byName) if (k.slice(k.lastIndexOf(".") + 1) === short) for (const ti of l) out.push(ti); return out; };
R.subTypesOf = (base, key) => {
const ck = key + "#" + R.kinv.size;
const hit = R.subCache.get(ck); if (hit) return hit;
const baseK = new Set(); for (const ti of base) for (const k of (R.klassOf.get(ti) || [])) baseK.add(k);
const out = new Set(base);
if (R.L.parent) for (const [k, ti] of R.kinv) {
if (out.has(ti)) continue;
let kk = rw(k + R.L.parent), g = 0;
while (kk && inHeap(kk) && g++ < 14) { if (baseK.has(kk)) { out.add(ti); break; } kk = rw(kk + R.L.parent); }
}
const arr = Array.from(out); R.subCache.set(ck, arr); return arr;
};
R.subTypes = (full) => R.subTypesOf(R.cls(full) || [], full);
R.findAll = (full) => { let out = []; for (const ti of R.subTypes(full)) out = out.concat(R.objs.get(ti) || []); return out; };

R.isLive = (obj) => { const f = R.fieldOf(obj, "m_CachedPtr"); if (!f) return true; return R.read(obj, f) !== 0; };
R.liveAll = (full) => R.findAll(full).filter((o) => { try { return R.isLive(o); } catch (e) { return false; } });
R.singleton = (full) => {
const k = R.klassByName(full); if (!k) return 0;
for (const f of R.klassFields(k)) if (f.isStatic && /^(_?instance|s_?instance)$/i.test(f.name)) { try { const v = R.read(0, f); if (v && inHeap(v >>> 0) && R.klassName(rw(v >>> 0))) return v >>> 0; } catch (e) {} }
return R.liveAll(full)[0] || 0;
};
R.explain = (e) => {
if (typeof e === "number") {
const p = e >>> 0, i = inHeap(p) ? R.inspect(p) : null;
if (i) { let msg = ""; const f = R.fieldOf(p, "_message") || R.fieldOf(p, "message"); if (f) { const s = R.readStr(R.read(p, f)); if (s) msg = ": " + s; } return "managed exception " + i.name + msg; }
return "the game threw " + e;
}
const s = String(e && e.message || e);
return s;
};
R.shortType = (n) => {
const M2 = { "System.Int32": "int", "System.Single": "float", "System.Double": "double", "System.Boolean": "bool", "System.String": "string", "System.Void": "void", "System.Int64": "long", "System.UInt64": "ulong", "System.UInt32": "uint", "System.Int16": "short", "System.UInt16": "ushort", "System.Byte": "byte", "System.SByte": "sbyte", "System.Char": "char", "System.Object": "object" };
if (!n) return "object"; if (M2[n]) return M2[n];
return n.slice(n.lastIndexOf(".") + 1).replace(/`\d+$/, "");
};

const PRIM = new Set(["System.Int32", "System.UInt32", "System.Int16", "System.UInt16", "System.Byte", "System.SByte", "System.Boolean", "System.Char", "System.IntPtr", "System.UIntPtr"]);
const STRUCT = { "UnityEngine.Vector3": 3, "UnityEngine.Vector2": 2, "UnityEngine.Quaternion": 4, "UnityEngine.Color": 4, "UnityEngine.Vector4": 4 };
R.STRUCT = STRUCT;
R.table = () => {
const c = [M.wasmTable, M.asm && M.asm.__indirect_function_table, M.asm && M.asm.table, M.asm && M.asm.__table, typeof window !== "undefined" && window.__ssEarly && window.__ssEarly.table];
return c.find((t) => t && typeof t.get === "function") || null;
};
R.wtype = (name) => {
if (!name || name === "?") return "i";
if (name === "System.Void") return "v";
if (name === "System.Single") return "f";
if (name === "System.Double") return "d";
if (name === "System.Int64" || name === "System.UInt64") return "j";
if (STRUCT[name]) return "S";
if (PRIM.has(name)) return "i";
const l = R.meta && R.meta.byName.get(name);
if (l) { const t = R.meta.T[l[0]], p = t.parent >= 0 ? R.meta.byval.get(t.parent) : undefined; if (p !== undefined && R.meta.name(p) === "System.ValueType" && !R.meta.isEnum(l[0])) return null; }
return "i";
};
R.isPtrType = (name) => { if (!name || name === "?") return true; if (PRIM.has(name) || R.wtype(name) !== "i") return false; const l = R.meta.byName.get(name); return !(l && R.meta.isEnum(l[0])); };
R.newString = (s) => {
s = String(s);
let p = R.strCache.get(s); if (p) return p;
const k = R.klassByName("System.String"); if (!k) throw new Error("System.String is not indexed yet");
p = M._malloc(16 + s.length * 2);
const h32 = M.HEAPU32, h16 = M.HEAPU16;
h32[p >> 2] = k; h32[(p >> 2) + 1] = 0; h32[(p >> 2) + 2] = s.length;
for (let i = 0; i < s.length; i++) h16[(p + 12 >> 1) + i] = s.charCodeAt(i);
h16[(p + 12 >> 1) + s.length] = 0;
if (R.strCache.size > 800) R.strCache.clear();
R.strCache.set(s, p);
return p;
};
R.invoke = (m, thisPtr, args) => {
args = args || [];
if (m.pars.length !== args.length) throw new Error(m.name + " needs " + m.pars.length + " argument(s)");
if (!m.fn) throw new Error(m.name + " has no code pointer (abstract or stripped)");
const rt = R.wtype(m.ret);
if (rt === null) throw new Error("return type " + m.ret + " is a struct this tool cannot pass");
const sret = STRUCT[m.ret] || 0;
const a = [], bufs = [];
let sig = sret ? "vi" : rt;
let sbuf = 0;
if (sret) { sbuf = M._malloc(sret * 4 + 16); bufs.push(sbuf); a.push(sbuf); }
if (!m.static) { sig += "i"; a.push(thisPtr | 0); }
try {
for (let i = 0; i < args.length; i++) {
const p = m.pars[i], w = R.wtype(p.type); let v = args[i];
if (w === null) throw new Error("parameter " + p.name + " (" + p.type + ") is a struct this tool cannot pass");
if (w === "S") {
const n = STRUCT[p.type]; if (!Array.isArray(v) || v.length !== n) throw new Error(p.name + " needs " + n + " numbers, like [1,2,3]");
const b = M._malloc(n * 4 + 16); bufs.push(b); for (let j = 0; j < n; j++) M.HEAPF32[(b >> 2) + j] = +v[j];
a.push(b); sig += "i";
} else if (w === "j") { a.push(BigInt(Math.round(Number(v)))); sig += "j"; }
else if (w === "f" || w === "d") { a.push(+v); sig += w; }
else if (w === "v") throw new Error("void parameter");
else {
if (p.type === "System.String" && typeof v === "string") v = R.newString(v);
a.push(v === true ? 1 : v === false ? 0 : v === null || v === undefined ? 0 : (v | 0)); sig += "i";
}
}
a.push(m.mi); sig += "i";
const T = R.table(), fn = T ? T.get(m.fn) : null;
let r;
try {
if (fn) r = fn.apply(null, a);
else {
if (sig.indexOf("j") >= 0) throw new Error("64-bit values need the wasm function table, which this build does not expose");
const f = M["dynCall_" + sig]; if (!f) throw new Error("no dynCall_" + sig + " in this build");
r = f.apply(null, [m.fn].concat(a));
}
} catch (e) { throw new Error(m.owner + "." + m.name + ": " + R.explain(e)); }
if (sret) { const out = []; for (let i = 0; i < sret; i++) out.push(M.HEAPF32[(sbuf >> 2) + i]); return out; }
if (typeof r === "bigint") r = Number(r);
return r;
} finally { bufs.forEach((b) => M._free(b)); }
};
R.call = (m, thisPtr, args) => R.invoke(m, thisPtr, args);
R.invokeF = (m, thisPtr, args) => {
const r = R.invoke(m, thisPtr, args);
if (Array.isArray(r) || r === undefined) return r;
if (m.ret === "System.Void") return undefined;
if (m.ret === "System.Boolean") return !!r;
if (m.ret === "System.String") { const s = R.readStr(r >>> 0); return s === null ? (r >>> 0) : s; }
if (R.isPtrType(m.ret)) return r >>> 0;
return r;
};
R.runtimeInvoke = (mi, obj, args) => { const m = R.methodByMI(mi); if (!m) throw new Error("no method for MethodInfo " + hex(mi)); return R.invokeF(m, obj || 0, args || []); };
R.staticCall = (full, name, args) => {
const k0 = R.cls(full); if (!k0) throw new Error("no class " + full);
for (const ti of R.subTypes(full).slice(0, 1).concat(k0)) for (const k of (R.klassOf.get(ti) || [])) {
const m = R.methodsChain(k).find((x) => x.name === name && x.pars.length === (args || []).length && x.static);
if (m) return R.invokeF(m, 0, args || []);
}
throw new Error("static method " + full + "." + name + "/" + (args || []).length + " not found");
};
R.fmtRet = (m, v) => {
if (Array.isArray(v)) return "(" + v.map((x) => Math.round(x * 1000) / 1000).join(", ") + ")";
if (m.ret === "System.Void") return "ok";
if (m.ret === "System.Boolean") return String(!!v);
if (m.ret === "System.String") { const s = R.readStr(v >>> 0); return s === null ? hex(v) : JSON.stringify(s); }
if (m.ret === "System.Single" || m.ret === "System.Double") return String(Math.round(v * 10000) / 10000);
if (m.ret === "System.Int32" || m.ret === "System.UInt32" || m.ret === "System.Int16" || m.ret === "System.Byte" || m.ret === "System.Int64" || m.ret === "System.UInt64") return String(v);
if (!R.isPtrType(m.ret)) return String(v);
return v ? hex(v) : "null";
};

R.refresh = async (full) => {
if (R.refreshing) return;
R.refreshing = true;
try {
if (full || R.cycles % 5 === 0 || !R.kinv.size) await R.scanClasses();
if (!R.ok && !R.calibrate()) { R.status = "waiting for the game to finish loading (" + R.kinv.size + " classes ready)"; return; }
await R.scanObjects();
R.status = "connected";
R.cycles++;
} catch (e) { R.status = "error: " + e.message; log("refresh failed: " + e.message); }
finally { R.refreshing = false; }
};
R.connect = async () => {
try {
R.status = "looking for the metadata in memory";
await yieldNow();
const b = R.findMeta();
if (b < 0) { R.status = "waiting for the game to load its metadata"; return false; }
log("metadata found at " + hex(b));
R.meta = R.parseMeta(b);
log("metadata: " + R.meta.T.length + " types, " + R.meta.gameCount + " game types");
R.connected = true;
return true;
} catch (e) { R.status = "failed: " + e.message; log("connect failed: " + e.message); return false; }
};
R.cls = (full) => { const l = R.meta && R.meta.byName.get(full); return l || null; };
R.find = (full) => { const l = R.cls(full); if (!l) return []; let out = []; for (const ti of l) out = out.concat(R.objs.get(ti) || []); return out; };
R.enumOf = (full) => { const l = R.cls(full); return l ? R.meta.enumMembers(l[0]) : []; };
return R;
}
// </RT>
// ===================================================================================================

let RT = null;
const viewW = () => (typeof innerWidth === "number" && innerWidth) || 1024;
const viewH = () => (typeof innerHeight === "number" && innerHeight) || 768;
const S = Object.assign({ w: 390, h: 600, zoom: 100, ui: 100, theme: "Gold", toasts: true, tab: 0, vals: {}, macros: [], min: false, x: 12, y: 12 }, (() => { try { return JSON.parse(lsGet("ssmod_settings_v2")) || {}; } catch (e) { return {}; } })());
S.x = Math.max(8, Math.min(viewW() - 80, S.x)); S.y = Math.max(8, Math.min(viewH() - 60, S.y));
S.w = Math.max(300, Math.min(1000, S.w)); S.h = Math.max(240, Math.min(viewH() - 20, S.h));
const persist = () => lsSet("ssmod_settings_v2", JSON.stringify(S));
let toast = null;
const say = (s) => { dlog(s); if (toast) toast(s); };

// ---------- overrides ----------
const OV = new Map(); const GROUPS = new Map();
const ovKey = (obj, f) => obj + ":" + f.owner + "." + f.name;
function ovSet(group, obj, f, val) {
const key = ovKey(obj, f);
let o = OV.get(key);
if (!o) { let orig; try { orig = RT.read(obj, f); } catch (e) { return; } o = { obj, f, orig, val, group }; OV.set(key, o); } else { o.val = val; o.group = group; }
}
function ovApply() {
if (!RT || !RT.ok) return;
for (const [k, o] of OV) {
try { const cur = RT.read(o.obj, o.f); if (cur !== o.val) RT.write(o.obj, o.f, o.val); } catch (e) { OV.delete(k); }
}
}
function ovRelease(group) {
for (const [k, o] of OV) if (group === "*" || o.group === group) { try { RT.write(o.obj, o.f, o.orig); } catch (e) {} OV.delete(k); }
}
const ovCount = (group) => { let n = 0; for (const o of OV.values()) if (o.group === group) n++; return n; };
function defGroup(id, resolve, onChange, guard) { GROUPS.set(id, { on: false, resolve, onChange, guard, sig: -1 }); }
function setGroup(id, on) {
const g = GROUPS.get(id); if (!g) return;
if (on && g.guard && !g.guard()) return;
g.on = on;
if (!on) { ovRelease(id); if (g.onChange) { try { g.onChange(); } catch (e) {} } g.sig = -1; } else runGroups();
}
const groupOn = (id) => !!(GROUPS.get(id) && GROUPS.get(id).on);
function runGroups() {
if (!RT || !RT.ok) return;
for (const [id, g] of GROUPS) {
if (!g.on) continue;
try { const list = g.resolve(); for (const [obj, f, val] of list) ovSet(id, obj, f, val); const sig = ovCount(id); if (sig !== g.sig) { g.sig = sig; if (g.onChange) g.onChange(); } } catch (e) {}
}
ovApply();
}
setInterval(runGroups, 200);

function eachField(cls, fname, cb) {
if (!RT || !RT.ok) return;
for (const obj of RT.find(cls)) { try { const f = RT.fieldOf(obj, fname); if (f) cb(obj, f); } catch (e) {} }
}

// ---------- hook engine ----------
const VT = { i: 0x7f, j: 0x7e, f: 0x7d, d: 0x7c };
function buildTramp(sig, js) {
const ret = sig[0], ps = sig.slice(1).split("");
const type = [0x60, ps.length].concat(ps.map((c) => VT[c]), ret === "v" ? [0] : [1, VT[ret]]);
const sec = (id, body) => [id, body.length].concat(body);
const bytes = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0].concat(sec(1, [1].concat(type)), sec(2, [1, 1, 0x65, 1, 0x66, 0, 0]), sec(7, [1, 1, 0x66, 0, 0])));
return new WebAssembly.Instance(new WebAssembly.Module(bytes), { e: { f: js } }).exports.f;
}
function hookSig(m) {
const w = (t) => { const x = RT.wtype(t); return x === "S" ? null : x; };
const ret = w(m.ret); if (ret === null) return null;
let s = ret + (m.static ? "" : "i");
for (const p of m.pars) { const t = w(p.type); if (t === null || t === "v") return null; s += t; }
return s + "i";
}
const hcoerce = (c, v) => (c === "v" ? undefined : c === "i" ? (v === true ? 1 : v === false ? 0 : (v | 0)) : c === "j" ? BigInt(Math.round(Number(v))) : +v);
function findOwn(cls, name, argc) {
if (!RT || !RT.ok) throw new Error("not connected yet");
const l = RT.cls(cls); if (!l) throw new Error("no class " + cls);
for (const ti of l) for (const k of (RT.klassOf.get(ti) || [])) { const m = RT.methodsOfKlass(k).find((x) => x.name === name && x.pars.length === argc); if (m) return { m, k }; }
throw new Error("no method " + cls + "." + name + "/" + argc);
}
const HK = new Map(); let hookId = 0;
function unhookRec(r) { const t = RT && RT.table(); try { if (t) t.set(r.fn, r.orig); } catch (e) {} HK.delete(r.fn); }
function hookMethod(cls, name, argc, make, label) { return hookFound(findOwn(cls, name, argc | 0), make, label); }
function findChain(cls, name, argc) {
if (!RT || !RT.ok) throw new Error("not connected yet");
const k0 = RT.klassByName(cls); if (!k0) throw new Error("no class " + cls);
let kk = k0, g = 0;
while (kk && RT.inHeap(kk) && g++ < 14) { const m = RT.methodsOfKlass(kk).find((x) => x.name === name && x.pars.length === argc); if (m) return { m, k: kk }; kk = RT.L.parent ? RT.rw(kk + RT.L.parent) : 0; }
throw new Error("no method " + cls + "." + name + "/" + argc);
}
function hookFound(f, make, label) {
const t = RT && RT.table(); if (!t) throw new Error("no wasm function table on Module");
const cls = RT.klassName(f.k), name = f.m.name;
const sig = hookSig(f.m);
if (!sig) throw new Error(name + " has a struct parameter or result, not hookable");
const old = HK.get(f.m.fn); if (old) unhookRec(old);
const orig = t.get(f.m.fn); if (!orig) throw new Error("function table entry " + f.m.fn + " is empty");
const rec = { id: ++hookId, label: label || (cls + "." + name), cls, name, fn: f.m.fn, orig, sig, hits: 0, skipped: 0, err: "", klass: f.k, isStatic: f.m.static };
const rc = sig[0];
const js = function () {
const a = Array.prototype.slice.call(arguments);
if (!rec.isStatic) { const k = RT.rw(a[0] >>> 0); if (!(k && RT.isSub(k, rec.klass))) { rec.skipped++; return orig.apply(null, a); } }
rec.hits++;
try { return hcoerce(rc, make(a, orig, rec)); } catch (e) { rec.err = String(e && e.message || e); return orig.apply(null, a); }
};
rec.tramp = buildTramp(sig, js);
t.set(f.m.fn, rec.tramp);
HK.set(f.m.fn, rec);
return rec;
}
const HOOKS = {
attach(cls, name, argc, cb) { cb = cb || {}; return hookMethod(cls, name, argc, (a, orig) => { const args = a.slice(0, -1), ctx = {}; if (cb.onEnter) cb.onEnter.call(ctx, args); const rv = { value: orig.apply(null, args.concat([a[a.length - 1]])) }; if (cb.onLeave) cb.onLeave.call(ctx, rv, args); return rv.value; }); },
replace(cls, name, argc, fn) { return hookMethod(cls, name, argc, (a, orig) => fn(function () { return orig.apply(null, a); }, a.slice(0, -1))); },
constant(cls, name, argc, v) { return hookMethod(cls, name, argc, () => v); },
nop(cls, name, argc) { return hookMethod(cls, name, argc, () => 0); },
probe(cls, name, argc) { return hookMethod(cls, name, argc, (a, orig) => orig.apply(null, a)); },
off(rec) { if (rec) unhookRec(rec); else Array.from(HK.values()).forEach(unhookRec); },
list() { return Array.from(HK.values()); }
};

// ---------- exact C# calls ----------
const ovrCls = (cls, f) => { if (!RT || !RT.ok) throw new Error("not connected yet"); return f(); };
function callOn(cls, method, args) { return ovrCls(cls, () => { const objs = RT.findAll(cls); if (!objs.length) throw new Error("no live " + cls.split(".").pop() + " object yet"); const m = RT.findMethod(RT.rw(objs[0]), method, args.length); if (!m) throw new Error(cls + "." + method + "/" + args.length + " not found"); return RT.invokeF(m, objs[0], args); }); }
const callStatic = (cls, method, args) => ovrCls(cls, () => RT.staticCall(cls, method, args));
function posOfObj(obj) { const gt = RT.findMethod(RT.rw(obj), "get_transform", 0); if (!gt) return null; const tr = RT.invoke(gt, obj, []); if (!tr) return null; const gp = RT.findMethod(RT.rw(tr), "get_position", 0); return gp ? RT.invoke(gp, tr, []) : null; }

// ---------- run state, names ----------
function inRun() {
if (!RT || !RT.ok) return false;
const g = RT.singleton("SYBO.Subway.Game"); if (!g) return false;
const f = RT.fieldOf(g, "IsInGame"); if (!f) return true;
const v = RT.read(g, f); if (!v) return false;
const vf = RT.klassFields(RT.rw(v)).find((x) => !x.isStatic && x.kind === "bool");
return vf ? !!RT.read(v, vf) : true;
}
function unityName(p) {
try { if (!p || !RT.isLive(p)) return null; const m = RT.methodsChain(RT.rw(p)).find((x) => x.name === "get_name" && x.pars.length === 0 && !x.static); if (!m) return null; const r = RT.invokeF(m, p, []); return typeof r === "string" ? r : null; } catch (e) { return null; }
}
let nameCache = { t: 0, list: [] };
function objectNames(force) {
if (!RT || !RT.ok) return [];
if (!force && Date.now() - nameCache.t < 5000) return nameCache.list;
const list = [], base = RT.cls("UnityEngine.GameObject") || [];
for (const ti of RT.subTypesOf(base, "UnityEngine.GameObject")) for (const o of (RT.objs.get(ti) || [])) { const n = unityName(o); if (n) list.push({ ptr: o, name: n }); }
nameCache = { t: Date.now(), list }; return list;
}
function findByName(name) {
const q = String(name).toLowerCase(), all = objectNames();
let hit = all.filter((x) => x.name.toLowerCase() === q);
if (!hit.length) hit = all.filter((x) => x.name.toLowerCase() === q + "(clone)");
if (!hit.length) hit = all.filter((x) => x.name.toLowerCase().indexOf(q) >= 0);
return hit;
}

// ---------- chunk weights ----------
const C_CONT = "SYBO.Subway.Routes.WeightRandomizedPrefabContainter`2";
const C_RANDOM = "SYBO.Common.Utilities.SyboRandom";
function entryName(e, nm) {
let name = nm ? (RT.readStr(RT.read(e, nm)) || "") : "";
if (!name) { for (const n of ["_prefab", "Prefab", "prefab"]) { const f = RT.fieldOf(e, n); if (f) { const pn = unityName(RT.read(e, f)); if (pn) { name = pn; break; } } } }
return name || "?";
}
function chunkContainers() {
const out = [];
if (!RT || !RT.ok) return out;
const seen = new Set();
for (const c of RT.findAll(C_CONT)) {
try {
const lf = RT.fieldOf(c, "_weightedPrefabs"); if (!lf) continue;
const list = RT.read(c, lf); if (!list) continue;
const nf = RT.fieldOf(c, "<Name>k__BackingField");
const name = nf ? RT.readStr(RT.read(c, nf)) : null;
const entries = RT.listItems(list).filter((e) => RT.inHeap(e)).map((e) => { const wf = RT.fieldOf(e, "Weight"), nm = RT.fieldOf(e, "_name"); return { addr: e, wf, name: entryName(e, nm) }; }).filter((e) => e.wf);
entries.forEach((e) => seen.add(e.addr));
if (entries.length) out.push({ addr: c, name: name || "(unnamed)", entries });
} catch (e) {}
}
try {
const groups = new Map();
for (const ti of RT.subTypesOf(RT.typesByShort("WeightedPrefab`1"), "WeightedPrefab`1")) for (const o of (RT.objs.get(ti) || [])) {
if (seen.has(o)) continue;
const wf = RT.fieldOf(o, "Weight"); if (!wf) continue;
const g = RT.meta.name(ti).split(".").pop();
if (!groups.has(g)) groups.set(g, []);
groups.get(g).push({ addr: o, wf, name: entryName(o, RT.fieldOf(o, "_name")) });
}
for (const [g, entries] of groups) out.push({ addr: "loose:" + g, name: g + " (all loaded entries)", entries: entries.slice(0, 400), loose: true });
} catch (e) {}
return out;
}
function rebuildContainers() {
if (!RT || !RT.ok || !inRun()) return 0;
const gm = RT.singleton("SYBO.Subway.Game"); let rnd = 0;
if (gm) { const f = RT.fieldOf(gm, "_randomGenerator"); if (f) rnd = RT.read(gm, f); }
if (!rnd) rnd = RT.liveAll(C_RANDOM)[0] || 0;
if (!rnd) { dlog("no SyboRandom yet"); return 0; }
let n = 0;
for (const c of RT.findAll(C_CONT)) { try { const m = RT.findMethod(RT.rw(c), "BuildRandomlyOrderedPrefabList", 1); if (m) { RT.invoke(m, c, [rnd]); n++; } } catch (e) {} }
return n;
}
const chunkRule = { mode: "first", text: "" };
defGroup("chunkrule", () => {
const out = [];
for (const c of chunkContainers()) {
if (c.loose || c.entries.length < 2) continue;
let keep = c.entries[0];
if (chunkRule.mode === "match" && chunkRule.text) { const t = chunkRule.text.toLowerCase(); const hit = c.entries.find((e) => e.name.toLowerCase().indexOf(t) >= 0); if (!hit) continue; keep = hit; }
for (const e of c.entries) if (e !== keep) out.push([e.addr, e.wf, 0]);
}
return out;
}, rebuildContainers);
function chunkOnly(cont, entry) { for (const e of cont.entries) if (e.addr !== entry.addr) ovSet("chunkpick", e.addr, e.wf, 0); rebuildContainers(); }
function chunkRestore() { ovRelease("chunkpick"); setGroup("chunkrule", false); rebuildContainers(); say("chunk weights restored"); }

// ---------- pickups ----------
const NSP = "SYBO.Subway.Pickups.";
const P_DATA = NSP + "PickupData", P_SPOT = NSP + "PickupSpawnPoint", P_TYPE = NSP + "PickupType", P_MODE = NSP + "SpawnPointMode", P_MGR = NSP + "PickupManager", P_PICKER = NSP + "Pickers.PickerData", P_BASE = NSP + "Picker.Pickers.BasePicker";
const pk = { force: "JetPack" };
function pickupTypeValue(name) { const e = RT && RT.ok ? RT.enumOf(P_TYPE).find((x) => x.name === name) : null; return e ? e.value : 0; }
defGroup("force", () => {
const out = [], mode = RT.enumOf(P_MODE).find((x) => x.name === "WillForcePickupType"), val = pickupTypeValue(pk.force);
if (!mode || !val) return out;
for (const obj of RT.find(P_SPOT)) { if (!RT.isLive(obj)) continue; const f1 = RT.fieldOf(obj, "__spawnPointMode"), f2 = RT.fieldOf(obj, "__forceSpawnPickupType"); if (f1 && f2) { out.push([obj, f1, mode.value]); out.push([obj, f2, val]); } }
return out;
});
defGroup("nospace", () => { const out = []; eachField(P_DATA, "_spawnDistanceMinToPrevious", (o, f) => out.push([o, f, 0])); return out; });
defGroup("flood", () => {
const out = [], tv = pickupTypeValue(pk.force), mode = RT.enumOf(P_MODE).find((x) => x.name === "WillForcePickupType");
if (!tv || !mode) return out;
for (const o of RT.find(P_PICKER)) { try { const fT = RT.fieldOf(o, "_pickupType"), fP = RT.fieldOf(o, "_probabilityToSpawn"), fD = RT.fieldOf(o, "_spawnDistanceMinToPrevious"); if (fP) out.push([o, fP, 1]); if (fD) out.push([o, fD, 0]); if (fT) out.push([o, fT, (RT.read(o, fT) | tv) | 0]); } catch (e) {} }
for (const o of RT.find(P_DATA)) { try { const fT = RT.fieldOf(o, "_pickupType"); if (!fT || RT.read(o, fT) !== tv) continue; const w = RT.fieldOf(o, "_spawnWeight"), d = RT.fieldOf(o, "_spawnDistanceMinToPrevious"); if (w) out.push([o, w, Math.max(1000, RT.read(o, w))]); if (d) out.push([o, d, 0]); } catch (e) {} }
for (const o of RT.find(P_SPOT)) { try { if (!RT.isLive(o)) continue; for (const [n, v] of [["__spawnPointMode", mode.value], ["_spawnPointModeOriginal", mode.value], ["__forceSpawnPickupType", tv], ["_forceSpawnPickupTypeOriginal", tv]]) { const f = RT.fieldOf(o, n); if (f) out.push([o, f, v]); } } catch (e) {} }
return out;
});
function pickupRows() {
const rows = [];
if (!RT || !RT.ok) return rows;
const tn = RT.enumOf(P_TYPE);
for (const o of RT.find(P_DATA)) { try { const ft = RT.fieldOf(o, "_pickupType"), fw = RT.fieldOf(o, "_spawnWeight"), fd = RT.fieldOf(o, "_spawnDistanceMinToPrevious"); if (!ft || !fw) continue; const tv = RT.read(o, ft), e = tn.find((x) => x.value === tv); rows.push({ addr: o, name: e ? e.name : "type " + tv, fw, fd }); } catch (e) {} }
return rows;
}
function pickupOnly(row, rows) { for (const r of rows) ovSet("pickupweights", r.addr, r.fw, r === row ? Math.max(100, RT.read(r.addr, r.fw)) : 0); say("only " + row.name + " will spawn"); }

// ---------- powerup tuning ----------
const TUNE = [
{ id: "ptimer", title: "Powerup timers", sub: "seconds left on every active powerup", def: 30000000, cls: [["Info.ActivePowerup", "timeLeft"]] },
{ id: "pmagnet", title: "Magnet pull speed", sub: "how fast coins fly to you", def: 300, cls: [["CoinMagnet", "pullSpeed"], ["LongMagnet", "pullSpeed"]] },
{ id: "pdouble", title: "Double coins value", sub: "coins per pickup while active", def: 50, cls: [["DoubleCoins", "ratio"]] }
];
TUNE.forEach((t) => { if (S.vals[t.id] === undefined) S.vals[t.id] = t.def; defGroup(t.id, () => { const out = []; for (const [c, f] of t.cls) eachField(c, f, (o, fl) => out.push([o, fl, S.vals[t.id]])); return out; }); });

// ---------- developer settings ----------
const DEVC = "SYBO.Subway.Utilities.DebugSettings";
let devArmed = false;
function devEnsure() {
if (!RT || !RT.ok) { say("not connected yet"); return false; }
if (RT.liveAll(DEVC).length) return true;
if (!devArmed) { devArmed = true; say("DebugSettings does not exist yet. Switch again to create"); return false; }
devArmed = false;
try { const k = RT.klassByName(DEVC), m = k && RT.methodsChain(k).find((x) => x.static && /^get_instance$/i.test(x.name) && x.pars.length === 0); if (!m) { say("no instance getter"); return false; } RT.invoke(m, 0, []); RT.refresh(false); say("created, switch it on once more"); } catch (e) { say("error: " + e.message); }
return false;
}
const DEV = [
{ f: "_characterInvincible", title: "Character invincible", sub: "crashes cannot end the run", set: "set_CharacterInvincible" },
{ f: "_unlockedSceneCamera", title: "Free scene camera", sub: "unlocks the camera" },
{ f: "_dontUseIdles", title: "Skip idle animations", sub: "no waiting animations", set: "set_DontUseIdles" },
{ f: "_useDebugZDistanceTargetPosition", title: "Debug distance target", sub: "start the run far ahead", set: "set_UseDebugZDistanceTargetPosition" },
{ f: "_useQueuedEnvironmentKinds", title: "Use queued environments", sub: "force the world look queue", set: "set_UseQueuedEnvironmentKinds" }
];
const liveDev = (cb) => { for (const o of RT.liveAll(DEVC)) { try { const f = RT.fieldOf(o, cb.f); if (f) cb.fn(o, f); } catch (e) {} } };
DEV.forEach((d) => defGroup("dev" + d.f, () => { const out = []; liveDev({ f: d.f, fn: (o, f) => out.push([o, f, f.kind === "bool" ? true : 1]) }); return out; }, null, devEnsure));
defGroup("dev_active", () => { const out = []; liveDev({ f: "_active", fn: (o, f) => out.push([o, f, f.kind === "bool" ? true : (S.vals.devActive || 1)]) }); return out; }, null, devEnsure);

// ---------- wallet ----------
const INV = "Data.Save.InventorySave";
function walletAdd(kind, n) {
if (!RT || !RT.ok) throw new Error("not connected yet");
if (!RT.singleton(INV)) throw new Error("save data not loaded, open main menu");
const get = kind === "coins" ? "get_coins" : "get_keys", set = kind === "coins" ? "SetCoins" : "SetKeys";
const before = RT.staticCall(INV, get, []) | 0;
RT.staticCall(INV, set, [Math.max(0, Math.min(2000000000, before + Math.round(n)))]);
return before + " -> " + (RT.staticCall(INV, get, []) | 0);
}

// ---------- safety ----------
function releaseAll() { try { GROUPS.forEach((g) => { g.on = false; }); ovRelease("*"); HOOKS.off(); } catch (e) {} }
addEventListener("error", (ev) => { const msg = String(ev && ev.message || ""); if (/abort\(/.test(msg) && (OV.size || HK.size)) { releaseAll(); dlog("game aborted, released writes"); } });

// ---------- boot ----------
let uiOpen = { explorer: false, spawn: false, scan: false, gui: false };
async function bootTick() {
const M = getModule();
if (!M || !M.HEAPU8 || !M.asm) { if (!RT) return; return; }
if (!RT) RT = makeRT(M, dlog);
if (!RT.connected) { await RT.connect(); return; }
const active = GROUPS.size && Array.from(GROUPS.values()).some((g) => g.on) || OV.size > 0;
const age = Date.now() - RT.lastScan;
const need = !RT.ok || age > (active || uiOpen.explorer || uiOpen.spawn || uiOpen.scan || uiOpen.gui ? 4000 : 15000);
if (need) await RT.refresh(false);
}
setInterval(() => { bootTick().catch((e) => dlog("boot: " + e)); }, 1000);

// ===================================================================================================
// CODE TAB ENGINE
// ===================================================================================================
class Ptr { constructor(v) { this.v = v >>> 0; } }
const CS_PRIM = new Set(["var", "int", "float", "double", "bool", "string", "long", "uint", "object", "short", "byte", "char", "ulong", "decimal", "sbyte", "ushort"]);
const CS_CMD = new Set(["hook", "patch", "unhook", "hold", "release", "hooks", "help"]);

function csLex(src) {
const toks = []; let i = 0, line = 1; const n = src.length;
const push = (t, v, st, x) => toks.push(Object.assign({ t, v, line, pos: st, end: i }, x || {}));
while (i < n) {
const c = src[i];
if (c === "\n") { line++; i++; continue; }
if (/\s/.test(c)) { i++; continue; }
if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
if (c === "/" && src[i + 1] === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i++; } i += 2; continue; }
if (c === '"' || ((c === "$" || c === "@") && src[i + 1] === '"')) {
const st = i, verb = c === "@", interp = c === "$"; if (c !== '"') i++; i++;
let s = "";
while (i < n && src[i] !== '"') { if (src[i] === "\\" && !verb) { const e = src[i + 1]; s += e === "n" ? "\n" : e === "t" ? "\t" : e; i += 2; } else { if (src[i] === "\n") line++; s += src[i++]; } }
i++; push("str", s, st, { interp }); continue;
}
if (c === "'") { const st = i; i++; let s = ""; while (i < n && src[i] !== "'") { if (src[i] === "\\") { s += src[i + 1]; i += 2; } else s += src[i++]; } i++; push("str", s, st); continue; }
if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
const st = i; let j = i;
if (c === "0" && /[xX]/.test(src[i + 1] || "")) { j += 2; while (/[0-9a-fA-F]/.test(src[j] || "")) j++; const v = parseInt(src.slice(i, j), 16); i = j; push("num", v, st); continue; }
while (/[0-9]/.test(src[j] || "")) j++;
if (src[j] === "." && /[0-9]/.test(src[j + 1] || "")) { j++; while (/[0-9]/.test(src[j] || "")) j++; }
if (/[eE]/.test(src[j] || "") && /[-+0-9]/.test(src[j + 1] || "")) { j += 2; while (/[0-9]/.test(src[j] || "")) j++; }
const v = parseFloat(src.slice(i, j)); if (/[fFdDmMuUlL]/.test(src[j] || "")) j++; i = j; push("num", v, st); continue;
}
if (/[A-Za-z_@]/.test(c)) { const st = i; let j = i + 1; while (/[A-Za-z0-9_]/.test(src[j] || "")) j++; const v = src.slice(i, j).replace(/^@/, ""); i = j; push("id", v, st); continue; }
const two = src.substr(i, 2), st = i;
if (["==", "!=", "<=", ">=", "&&", "||", "+=", "-=", "*=", "/=", "%=", "++", "--", "=>", "?.", "??"].indexOf(two) >= 0) { i += 2; push("op", two, st); continue; }
i++; push("op", c, st);
}
toks.push({ t: "eof", v: "", line, pos: n, end: n });
return toks;
}

class CsParser {
constructor(src) { this.src = src; this.toks = csLex(src); this.p = 0; }
get tk() { return this.toks[this.p]; }
peek(o) { return this.toks[Math.min(this.p + (o || 0), this.toks.length - 1)]; }
isOp(v, o) { const t = this.peek(o); return t.t === "op" && t.v === v; }
isId(v, o) { const t = this.peek(o); return t.t === "id" && (v === undefined || t.v === v); }
err(m) { throw new Error("line " + this.tk.line + ": " + m); }
eatOp(v) { if (this.isOp(v)) { this.p++; return true; } return false; }
needOp(v) { if (!this.eatOp(v)) this.err("expected '" + v + "' but found '" + (this.tk.v || "end of code") + "'"); }
endStmt() { if (this.eatOp(";")) return; const t = this.tk, prev = this.toks[this.p - 1]; if (t.t === "eof" || this.isOp("}") || (prev && t.line > prev.line)) return; this.err("expected ';' but found '" + t.v + "'"); }
program() { const out = []; while (this.tk.t !== "eof") out.push(this.stmt()); return out; }
block() { this.needOp("{"); const b = []; while (!this.isOp("}")) { if (this.tk.t === "eof") this.err("missing '}'"); b.push(this.stmt()); } this.needOp("}"); return { k: "block", b }; }
looksLikeDecl() {
let o = 0;
if (!this.isId(undefined, o)) return false;
if (CS_PRIM.has(this.peek(o).v)) { o++; } else {
o++; while (this.isOp(".", o) && this.isId(undefined, o + 1)) o += 2;
if (this.isOp("<", o)) { let d = 0; for (;;) { const t = this.peek(o); if (t.t === "eof") return false; if (t.t === "op" && t.v === "<") d++; else if (t.t === "op" && t.v === ">") { d--; if (!d) { o++; break; } } else if (!(t.t === "id" || (t.t === "op" && (t.v === "," || t.v === ".")))) return false; o++; } }
}
if (this.isOp("[", o) && this.isOp("]", o + 1)) o += 2;
if (!this.isId(undefined, o) || CS_PRIM.has(this.peek(o).v)) return false;
return this.isOp("=", o + 1) || this.isOp(";", o + 1) || (this.peek(o + 1).t === "eof");
}
declType() { const t = this.tk.v; if (CS_PRIM.has(t)) { this.p++; } else { this.p++; while (this.isOp(".") && this.isId(undefined, 1)) this.p += 2; if (this.isOp("<")) { let d = 0; do { if (this.isOp("<")) d++; else if (this.isOp(">")) d--; this.p++; } while (d > 0 && this.tk.t !== "eof"); } } if (this.isOp("[") && this.isOp("]", 1)) this.p += 2; }
decl() { this.declType(); const n = this.tk.v; this.p++; let e = null; if (this.eatOp("=")) e = this.expr(); return { k: "var", n, e }; }
stmt() {
const t = this.tk;
if (t.t === "op") { if (t.v === "{") return this.block(); if (t.v === ";") { this.p++; return { k: "block", b: [] }; } }
if (t.t === "id") {
const w = t.v;
if (w === "const") { this.p++; return this.stmt(); }
if (w === "if") { this.p++; this.needOp("("); const c = this.expr(); this.needOp(")"); const a = this.stmt(); let b = null; if (this.isId("else")) { this.p++; b = this.stmt(); } return { k: "if", c, a, b }; }
if (w === "while") { this.p++; this.needOp("("); const c = this.expr(); this.needOp(")"); return { k: "while", c, b: this.stmt() }; }
if (w === "for") { this.p++; this.needOp("("); let init = null; if (!this.isOp(";")) init = this.looksLikeDecl() ? this.decl() : { k: "expr", e: this.expr() }; this.needOp(";"); const c = this.isOp(";") ? null : this.expr(); this.needOp(";"); const st = this.isOp(")") ? null : this.expr(); this.needOp(")"); return { k: "for", init, c, st, b: this.stmt() }; }
if (w === "foreach") { this.p++; this.needOp("("); this.declType(); const n = this.tk.v; this.p++; if (!this.isId("in")) this.err("expected 'in'"); this.p++; const e = this.expr(); this.needOp(")"); return { k: "foreach", n, e, b: this.stmt() }; }
if (w === "return") { this.p++; let e = null; if (!this.isOp(";") && this.tk.t !== "eof" && !this.isOp("}") && this.tk.line === this.toks[this.p - 1].line) e = this.expr(); this.endStmt(); return { k: "ret", e }; }
if (w === "break") { this.p++; this.endStmt(); return { k: "brk" }; }
if (w === "continue") { this.p++; this.endStmt(); return { k: "cont" }; }
if (w === "using" || w === "namespace") { while (this.tk.t !== "eof" && !this.isOp(";") && !this.isOp("{")) this.p++; if (this.isOp("{")) return this.block(); this.p++; return { k: "block", b: [] }; }
if (CS_CMD.has(w) && !this.isOp("(", 1) && !this.isOp(".", 1) && !this.isOp("=", 1)) return this.command();
if (w === "print" && !this.isOp("(", 1) && !this.isOp("=", 1)) { this.p++; const e = this.expr(); this.endStmt(); return { k: "expr", e: { k: "call", f: { k: "id", n: "print" }, a: [e] } }; }
if (this.looksLikeDecl()) { const d = this.decl(); this.endStmt(); return d; }
}
const e = this.expr(); this.endStmt(); return { k: "expr", e };
}
command() {
const name = this.tk.v, line = this.tk.line; this.p++;
if (name === "hooks" || name === "release" || name === "help") { this.endStmt(); return { k: "cmd", name }; }
if (name === "hold") { const e = this.expr(); this.endStmt(); return { k: "cmd", name, e }; }
if (name === "unhook") { if (this.isId("all")) { this.p++; this.endStmt(); return { k: "cmd", name, all: true }; } const target = this.target(); this.endStmt(); return { k: "cmd", name, target }; }
const target = this.target();
let body = null, nop = false;
if (name === "patch" && this.isId("nop")) { this.p++; nop = true; }
else { this.needOp("=>"); const st = this.tk.pos; let en = st; while (this.tk.t !== "eof" && this.tk.line === line && !this.isOp(";")) { en = this.tk.end; this.p++; } body = this.src.slice(st, en); if (name === "patch") { const sub = new CsParser(body); body = { ast: sub.expr() }; } }
this.endStmt();
return { k: "cmd", name, target, body, nop };
}
target() { const names = [this.tk.v]; if (this.tk.t !== "id") this.err("expected a Class.Method"); this.p++; while (this.isOp(".") && this.isId(undefined, 1)) { names.push(this.peek(1).v); this.p += 2; } let argc = -1; if (this.isOp("(") && this.peek(1).t === "num") { argc = this.peek(1).v; this.p += 3; } else if (this.isOp("(") && this.isOp(")", 1)) { argc = 0; this.p += 2; } return { names, argc }; }
expr() { return this.assign(); }
assign() { const l = this.cond(); if (this.tk.t === "op" && ["=", "+=", "-=", "*=", "/=", "%="].indexOf(this.tk.v) >= 0 && !this.isOp("=>")) { const op = this.tk.v; this.p++; return { k: "asg", op, l, r: this.assign() }; } return l; }
cond() { const c = this.coalesce(); if (this.eatOp("?")) { const a = this.assign(); this.needOp(":"); return { k: "cond", c, a, b: this.assign() }; } return c; }
coalesce() { let l = this.or(); while (this.eatOp("??")) l = { k: "bin", op: "??", l, r: this.or() }; return l; }
bin(next, ops) { let l = next.call(this); while (this.tk.t === "op" && ops.indexOf(this.tk.v) >= 0) { const op = this.tk.v; this.p++; l = { k: "bin", op, l, r: next.call(this) }; } return l; }
or() { return this.bin(this.and, ["||"]); }
and() { return this.bin(this.eq, ["&&"]); }
eq() { return this.bin(this.rel, ["==", "!="]); }
rel() { return this.bin(this.add, ["<", ">", "<=", ">="]); }
add() { return this.bin(this.mul, ["+", "-"]); }
mul() { return this.bin(this.unary, ["*", "/", "%"]); }
unary() {
const t = this.tk;
if (t.t === "op") {
if (t.v === "!" || t.v === "-" || t.v === "+") { this.p++; return { k: "un", op: t.v, e: this.unary() }; }
if (t.v === "++" || t.v === "--") { this.p++; return { k: "asg", op: t.v === "++" ? "+=" : "-=", l: this.unary(), r: { k: "num", v: 1 } }; }
if (t.v === "(" && this.peek(1).t === "id" && CS_PRIM.has(this.peek(1).v) && this.isOp(")", 2)) { const ty = this.peek(1).v; this.p += 3; return { k: "cast", ty, e: this.unary() }; }
}
return this.postfix();
}
postfix() {
let e = this.primary();
for (;;) {
if (this.isOp(".") || this.isOp("?.")) { this.p++; const t = this.tk; if (t.t !== "id") this.err("expected a name after '.'"); this.p++; let ga = null; if (this.isOp("<") && this.genericCall()) ga = this.genericArgs(); e = { k: "mem", o: e, n: t.v, ga }; }
else if (this.isOp("(")) { this.p++; const a = []; if (!this.isOp(")")) { do { a.push(this.expr()); } while (this.eatOp(",")); } this.needOp(")"); e = { k: "call", f: e, a }; }
else if (this.isOp("[")) { this.p++; const i = this.expr(); this.needOp("]"); e = { k: "idx", o: e, i }; }
else if ((this.isOp("++") || this.isOp("--"))) { const op = this.tk.v; this.p++; e = { k: "post", op, e }; }
else break;
}
return e;
}
genericCall() { let o = 0, d = 0; for (;;) { const t = this.peek(o); if (t.t === "eof") return false; if (t.t === "op" && t.v === "<") d++; else if (t.t === "op" && t.v === ">") { d--; if (!d) return this.isOp("(", o + 1); } else if (!(t.t === "id" || (t.t === "op" && (t.v === "," || t.v === ".")))) return false; o++; } }
genericArgs() { const names = []; let d = 0; do { const t = this.tk; if (t.t === "op" && t.v === "<") d++; else if (t.t === "op" && t.v === ">") d--; else if (t.t === "id") names.push(t.v); this.p++; } while (d > 0); return names; }
primary() {
const t = this.tk;
if (t.t === "num") { this.p++; return { k: "num", v: t.v }; }
if (t.t === "str") { this.p++; return { k: "str", v: t.v, interp: !!t.interp }; }
if (t.t === "id") {
if (t.v === "true" || t.v === "false") { this.p++; return { k: "bool", v: t.v === "true" }; }
if (t.v === "null") { this.p++; return { k: "null" }; }
if (t.v === "new") { this.p++; const names = []; if (this.tk.t !== "id") this.err("expected a type after new"); names.push(this.tk.v); this.p++; while (this.isOp(".") && this.isId(undefined, 1)) { names.push(this.peek(1).v); this.p += 2; } const a = []; if (this.eatOp("(")) { if (!this.isOp(")")) { do { a.push(this.expr()); } while (this.eatOp(",")); } this.needOp(")"); } else if (this.isOp("[")) this.err("new arrays are not supported"); return { k: "new", names, a }; }
if (t.v === "typeof" && this.isOp("(", 1)) { this.p += 2; const names = [this.tk.v]; this.p++; while (this.isOp(".") && this.isId(undefined, 1)) { names.push(this.peek(1).v); this.p += 2; } this.needOp(")"); return { k: "typeof", names }; }
this.p++; return { k: "id", n: t.v };
}
if (t.t === "op" && t.v === "(") { this.p++; const e = this.expr(); this.needOp(")"); return e; }
this.err("unexpected '" + (t.v || "end of code") + "'");
}
}

const csGlobals = new Map();
class Scope { constructor(parent) { this.vars = new Map(); this.parent = parent || null; } find(n) { for (let s = this; s; s = s.parent) if (s.vars.has(n)) return s; return null; } }
const isNil = (v) => v === null || v === undefined || (v instanceof Ptr && !v.v);
const csArg = (v) => (v instanceof Ptr ? v.v : v);
const csPtrOrVal = (v, retType) => ((retType && RT.isPtrType(retType) && retType !== "System.String" && typeof v === "number") ? (v ? new Ptr(v) : null) : v);
function csFmt(v) {
if (v === undefined) return "ok"; if (v === null) return "null";
if (v instanceof Ptr) { if (!v.v) return "null"; const i = RT.inspect(v.v); return hex(v.v) + (i ? "  (" + i.name + ")" : ""); }
if (v && v.cls) return "class " + v.cls;
if (Array.isArray(v)) return "(" + v.map((x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : csFmt(x))).join(", ") + ")";
if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000);
if (typeof v === "string") return JSON.stringify(v);
return String(v);
}
const csShortIdx = { n: -1, map: new Map() };
function csShort() {
const m = RT.meta; if (csShortIdx.n === m.T.length) return csShortIdx.map;
const sh = new Map();
for (let i = 0; i < m.T.length; i++) { const full = m.name(i); const last = full.slice(full.lastIndexOf(".") + 1).replace(/`\d+$/, ""); if (!last || /[<>]/.test(last)) continue; let l = sh.get(last); if (!l) sh.set(last, l = []); if (l.indexOf(full) < 0) l.push(full); }
csShortIdx.n = m.T.length; csShortIdx.map = sh; return sh;
}
function csClass(name) {
if (!RT || !RT.meta) return null;
if (RT.cls(name)) return name; if (RT.cls(name + "`1")) return name + "`1";
const l = csShort().get(name.slice(name.lastIndexOf(".") + 1)); if (!l) return null;
const cand = l.filter((f) => !name.includes(".") || f.endsWith(name));
const game = cand.filter((f) => (RT.cls(f) || []).some((ti) => ti >= RT.meta.gameStart));
return (game[0] || cand[0]) || null;
}
function csEnumMember(full, name) { const l = RT.cls(full); if (!l || !RT.meta.isEnum(l[0])) return undefined; const e = RT.enumOf(full).find((x) => x.name === name); return e ? e.value : undefined; }
function csConv(m, args) {
return args.map((v, i) => { v = csArg(v); const t = m.pars[i] && m.pars[i].type; if (typeof v === "string" && t) { const l = RT.cls(t); if (l && RT.meta.isEnum(l[0])) { const e = RT.enumOf(t).find((x) => x.name === v); if (e) return e.value; } } return v; });
}
function csPick(cands, args) {
const ok = cands.filter((m) => m.pars.length === args.length); if (!ok.length) return null; if (ok.length === 1) return ok[0];
let best = null, bs = -1;
for (const m of ok) { let s = 0; m.pars.forEach((p, i) => { const v = csArg(args[i]), w = RT.wtype(p.type); if (typeof v === "number") { if (Number.isInteger(v) && w === "i") s += 2; else if (!Number.isInteger(v) && (w === "f" || w === "d")) s += 2; else if (w === "f" || w === "d" || w === "i" || w === "j") s += 1; } else if (typeof v === "boolean" && p.type === "System.Boolean") s += 2; else if (typeof v === "string" && p.type === "System.String") s += 2; else if (Array.isArray(v) && w === "S") s += 2; }); if (s > bs) { bs = s; best = m; } }
return best;
}
function csCall(cands, thisPtr, args, what) {
const m = csPick(cands, args); if (!m) throw new Error("no " + what + " taking " + args.length + " argument(s)");
return csPtrOrVal(RT.invokeF(m, m.static ? 0 : thisPtr, csConv(m, args)), m.ret);
}
const VEC_SIZES = { "UnityEngine.Vector2": 2, "UnityEngine.Vector3": 3, "UnityEngine.Vector4": 4, "UnityEngine.Quaternion": 4, "UnityEngine.Color": 4 };
function csFieldVal(obj, f) {
if (VEC_SIZES[f.tn]) { try { const a = RT.fieldAddr(obj, f); if (!a) return null; const dv = new DataView(RT.M.HEAPU8.buffer), n = VEC_SIZES[f.tn], out = []; for (let i = 0; i < n; i++) out.push(dv.getFloat32(a + i * 4, true)); return out; } catch (e) { return null; } }
const v = RT.read(obj, f);
if (f.kind === "string") { const s = RT.readStr(v); return s === null ? (v ? new Ptr(v) : null) : s; }
if (["object", "array", "generic", "T", "ptr"].indexOf(f.kind) >= 0) return v ? new Ptr(v) : null;
return v;
}
function csSetField(obj, f, v) {
v = csArg(v);
if (Array.isArray(v) && VEC_SIZES[f.tn]) { const a = RT.fieldAddr(obj, f); if (!a) throw new Error("no address for " + f.name); const dv = new DataView(RT.M.HEAPU8.buffer), n = Math.min(v.length, VEC_SIZES[f.tn]); for (let i = 0; i < n; i++) dv.setFloat32(a + i * 4, +v[i], true); return; }
if (typeof v === "string") { if (f.kind === "string") v = RT.newString(v); else if (f.enumTi >= 0) { const e = RT.meta.enumMembers(f.enumTi).find((x) => x.name === v); if (!e) throw new Error("no enum value " + v); v = e.value; } else throw new Error("cannot store a string in " + f.tn); }
if (v === null) v = 0;
RT.write(obj, f, v);
}
const VEC = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 };
function arrElem(p, i) {
const a = RT.arrayInfo(p); if (!a) throw new Error("not an array");
if (i < 0 || i >= a.total) throw new Error("index " + i + " is outside the array (" + a.total + ")");
const dv = new DataView(RT.M.HEAPU8.buffer), ea = a.base + i * a.sz;
if (a.el === "Single") return dv.getFloat32(ea, true);
if (["Int32", "UInt32", "Int16", "Byte", "Boolean", "Double", "Int64"].indexOf(a.el) >= 0) return a.sz === 4 ? dv.getInt32(ea, true) : a.sz === 1 ? dv.getUint8(ea) : a.sz === 2 ? dv.getInt16(ea, true) : dv.getFloat64(ea, true);
const r = dv.getUint32(ea, true); return r ? new Ptr(r) : null;
}
function listItems(p) { const items = RT.listItems(p); return items.map((x) => (x ? new Ptr(x) : null)); }
function toIter(v) {
if (Array.isArray(v)) return v;
if (v instanceof Ptr && v.v) { const k = RT.rw(v.v), nm = RT.klassName(k); if (nm.slice(-2) === "[]") { const a = RT.arrayInfo(v.v), out = []; for (let i = 0; i < Math.min(a.total, 2000); i++) out.push(arrElem(v.v, i)); return out; } if (RT.fieldOf(v.v, "_items")) return listItems(v.v); }
throw new Error("cannot loop over " + csFmt(v));
}
function getComponent(o, T) {
const full = csClass(T); if (!full) throw new Error("unknown class " + T);
const gm = RT.methodsChain(RT.rw(csArg(o))).find((m) => m.name === "get_gameObject" && !m.pars.length);
const go = RT.klassName(RT.rw(csArg(o))) === "GameObject" ? csArg(o) : (gm ? RT.invoke(gm, csArg(o), []) >>> 0 : 0);
for (const c of RT.liveAll(full)) { const g = RT.methodsChain(RT.rw(c)).find((m) => m.name === "get_gameObject" && !m.pars.length); if (g && RT.invoke(g, c, []) >>> 0 === go) return new Ptr(c); }
return null;
}
function csMemberGet(o, name, sc, node) {
if (o && o.ns) { const full = csClass(o.ns + "." + name); return full ? { cls: full } : { ns: o.ns + "." + name }; }
if (isNil(o)) throw new Error("null reference: cannot read ." + name);
if (o.cls) return staticMember(o.cls, name, undefined, false);
if (Array.isArray(o)) { if (name in VEC) return o[VEC[name]]; if (name === "Length" || name === "Count") return o.length; throw new Error("no member " + name + " on a list/vector"); }
if (typeof o === "string") { if (name === "Length") return o.length; throw new Error("no member " + name + " on a string"); }
if (o instanceof Ptr) {
const k = RT.rw(o.v), kn = RT.klassName(k);
if (kn.slice(-2) === "[]" && (name === "Length" || name === "Count")) return RT.rw(o.v + 12);
const f = RT.fieldOf(o.v, name);
if (f) return csFieldVal(o.v, f);
if (name === "Count" && RT.fieldOf(o.v, "_size")) return RT.read(o.v, RT.fieldOf(o.v, "_size"));
const chain = RT.methodsChain(k), c = chain.filter((m) => m.name === "get_" + name && !m.pars.length);
if (c.length) return csCall(c, o.v, [], name);
throw new Error("no field or property '" + name + "' on " + kn);
}
throw new Error("cannot read ." + name + " of " + csFmt(o));
}
function staticMember(full, name, setVal, hasSet) {
if (!hasSet) { const ev = csEnumMember(full, name); if (ev !== undefined) return ev; }
const k = RT.klassByName(full); if (!k) throw new Error(full + " is not indexed yet");
const f = RT.klassFields(k).find((x) => x.name === name && x.isStatic);
if (f) { if (hasSet) { csSetField(0, f, setVal); return setVal; } return csFieldVal(0, f); }
const chain = RT.methodsChain(k), mn = hasSet ? "set_" + name : "get_" + name, args = hasSet ? [setVal] : [];
let c = chain.filter((m) => m.name === mn && m.static);
if (c.length) { const r = csCall(c, 0, args, full + "." + mn); return hasSet ? setVal : r; }
c = chain.filter((m) => m.name === mn && !m.static);
if (c.length) { const o = RT.singleton(full); if (!o) throw new Error("no live " + full + " object for " + mn); const r = csCall(c, o, args, full + "." + mn); return hasSet ? setVal : r; }
throw new Error("no member " + full + "." + name);
}
function csMemberSet(o, name, val) {
if (isNil(o)) throw new Error("null reference: cannot set ." + name);
if (o.cls) { staticMember(o.cls, name, val, true); return; }
if (Array.isArray(o)) { if (name in VEC) { o[VEC[name]] = csArg(val); return; } throw new Error("cannot set ." + name); }
if (o instanceof Ptr) { const f = RT.fieldOf(o.v, name); if (f) { csSetField(o.v, f, val); return; } const c = RT.methodsChain(RT.rw(o.v)).filter((m) => m.name === "set_" + name); if (!c.length) throw new Error("no field or property '" + name + "' to set on " + RT.klassName(RT.rw(o.v))); csCall(c, o.v, [val], "set_" + name); return; }
throw new Error("cannot set ." + name + " on " + csFmt(o));
}
function csCallMember(o, name, args, ga, out) {
if (o && o.ns) { if (/^(Debug|Console|UnityEngine\.Debug|System\.Console)$/.test(o.ns) && /^(Log|LogWarning|LogError|WriteLine|Write)$/.test(name)) { out(args.map(csFmtPlain).join(" ")); return undefined; } throw new Error("unknown name " + o.ns); }
if (isNil(o)) throw new Error("null reference: cannot call ." + name + "()");
if (o.cls) {
const full = o.cls, short = full.slice(full.lastIndexOf(".") + 1);
if (short === "Debug" || short === "Console") { if (/^(Log|LogWarning|LogError|WriteLine|Write)$/.test(name)) { out(args.map(csFmtPlain).join(" ")); return undefined; } }
const k = RT.klassByName(full); if (!k) throw new Error(full + " is not indexed yet");
const chain = RT.methodsChain(k);
let c = chain.filter((m) => m.name === name && m.static);
if (c.length && csPick(c, args)) return csCall(c, 0, args, full + "." + name);
c = chain.filter((m) => m.name === name && !m.static);
if (c.length) { const inst = RT.singleton(full); if (!inst) throw new Error("no live " + full + " object to call " + name + " on"); return csCall(c, inst, args, full + "." + name); }
throw new Error("no method " + full + "." + name + " taking " + args.length + " argument(s)");
}
if (typeof o === "string") { if (name === "ToString") return o; if (name === "Contains") return o.indexOf(args[0]) >= 0; if (name === "ToLower") return o.toLowerCase(); if (name === "ToUpper") return o.toUpperCase(); throw new Error("string has no " + name); }
if (Array.isArray(o)) { if (name === "ToString") return csFmt(o); throw new Error("vector/list has no method " + name); }
if (o instanceof Ptr) {
if (name === "GetComponent" && ga) return getComponent(o, ga[0]);
if (name === "ToString" && !args.length) { const i = RT.inspect(o.v); return i ? i.name : "object"; }
const c = RT.methodsChain(RT.rw(o.v)).filter((m) => m.name === name);
if (!c.length) throw new Error("no method " + name + " on " + RT.klassName(RT.rw(o.v)));
return csCall(c, o.v, args, name);
}
throw new Error("cannot call ." + name + " on " + csFmt(o));
}
const csFmtPlain = (v) => (typeof v === "string" ? v : csFmt(v));
const CSB = {
find: (a) => {
const x = csArg(a[0]); if (typeof x !== "string") return a[0]; if (!RT || !RT.ok) return null;
const name = x, short = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
const c = csClass(name); if (c) { const o = RT.singleton(c); if (o) return new Ptr(o); const live = RT.liveAll(c); if (live.length) return new Ptr(live[0]); }
let hits = findByName(name); if (!hits.length) { try { objectNames(true); } catch (e) {} hits = findByName(name); } if (hits.length) return new Ptr(hits[0].ptr);
for (const [full, tis] of (RT.meta ? RT.meta.byName : [])) { const s = full.slice(full.lastIndexOf(".") + 1).replace(/`\d+$/, "").toLowerCase(); if (s !== short) continue; for (const ti of tis) { const l = RT.objs.get(ti); if (l && l.length) return new Ptr(l[0]); } }
return null;
},
player: (a) => {
if (!RT || !RT.ok) return null;
const g = RT.singleton("SYBO.Subway.Game"); if (g) { const info = RT.inspect(g); if (info) for (const f of info.fields) { if (f.isStatic || !/player|character|avatar/i.test(f.name)) continue; try { const v = RT.read(g, f) >>> 0; if (v && RT.inHeap(v) && RT.inspect(v)) return new Ptr(v); } catch (e) {} } }
for (const n of ["Player", "Character", "Jake"]) { const h = findByName(n)[0]; if (h) return new Ptr(h.ptr); }
for (const [full, tis] of (RT.meta ? RT.meta.byName : [])) { if (!/Player|Character/i.test(full)) continue; for (const ti of tis) { const l = RT.objs.get(ti); if (l && l.length) return new Ptr(l[0]); } }
return null;
},
objects: (a) => { if (!RT || !RT.ok) return "not connected"; const q = a[0] ? String(csArg(a[0])).toLowerCase() : ""; return objectNames(true).filter((o) => !q || o.name.toLowerCase().includes(q)).slice(0, 200).map((o) => "0x" + o.ptr.toString(16).padStart(8, "0") + "  " + o.name); },
classes: (a) => { if (!RT || !RT.ok) return "not connected"; const q = a[0] ? String(csArg(a[0])).toLowerCase() : "", out = []; for (const [full, tis] of (RT.meta ? RT.meta.byName : [])) { if (q && !full.toLowerCase().includes(q)) continue; const live = tis.reduce((n, ti) => n + ((RT.objs.get(ti) || []).length), 0); out.push(full + (live ? "  [" + live + " live]" : "")); if (out.length >= 400) break; } return out; },
diag: () => { const M = getModule(); return ["module: " + (M ? "yes" : "no"), "RT: " + (RT ? (RT.connected ? "connected" : "not connected") : "null"), "RT.ok: " + (RT ? !!RT.ok : false), "RT.status: " + (RT ? RT.status : "n/a"), "classes: " + (RT && RT.kinv ? RT.kinv.size : 0), "objects: " + ((RT && RT.total) || 0), "layout: " + JSON.stringify((RT && RT.L) || null)].join("\n"); },
scanFirst: (a) => msScanSync(String(a[1] ? csArg(a[1]) : "int32"), +csArg(a[0])),
scanNext: (a) => { const t = String(a[1] ? csArg(a[1]) : "int32"), v = +csArg(a[0]); const prev = Array.isArray(a[2]) ? csArg(a[2]) : MS.prev; return msNextScan(t, v, prev); },
scanWrite: (a) => { msWrite(csArg(a[0]) >>> 0, String(a[2] ? csArg(a[2]) : "int32"), +csArg(a[1])); return "ok"; },
findAll: (a) => { const x = String(csArg(a[0])); const c = csClass(x); if (c) { const l = RT.liveAll(c); if (l.length) return l.map((o) => new Ptr(o)); } return findByName(x).map((h) => new Ptr(h.ptr)); },
findByName: (a) => { const h = findByName(String(csArg(a[0])))[0]; return h ? new Ptr(h.ptr) : null; },
peek: (a) => RT.M.HEAPU32[csArg(a[0]) >>> 2], peekf: (a) => RT.M.HEAPF32[csArg(a[0]) >>> 2],
poke: (a) => { RT.M.HEAPU32[csArg(a[0]) >>> 2] = csArg(a[1]) >>> 0; }, pokef: (a) => { RT.M.HEAPF32[csArg(a[0]) >>> 2] = +csArg(a[1]); },
str: (a) => { const s = RT.readStr(csArg(a[0]) >>> 0); return s === null ? "(not a string)" : s; },
inRun: () => inRun(), name: (a) => unityName(csArg(a[0])), typeName: (a) => { const i = RT.inspect(csArg(a[0]) >>> 0); return i ? i.parents.join(" < ") : "(not an object)"; },
Vector3: (a) => a.map(csArg), Vector2: (a) => a.map(csArg), Vector4: (a) => a.map(csArg), Quaternion: (a) => a.map(csArg), Color: (a) => a.map(csArg)
};
function interp(sc, str, out) { return str.replace(/\{([^{}]+)\}/g, (m0, ex) => { try { return csFmtPlain(csEval(new CsParser(ex).expr(), sc, out)); } catch (e) { return "{" + ex + "}"; } }); }
function arith(op, a, b) { if (Array.isArray(a) && Array.isArray(b)) { if (op === "+") return a.map((x, i) => x + b[i]); if (op === "-") return a.map((x, i) => x - b[i]); } if (Array.isArray(a) && typeof b === "number") { if (op === "*") return a.map((x) => x * b); if (op === "/") return a.map((x) => x / b); } if (typeof a === "number" && Array.isArray(b) && op === "*") return b.map((x) => x * a); a = csArg(a); b = csArg(b); switch (op) { case "+": return a + b; case "-": return a - b; case "*": return a * b; case "/": return a / b; case "%": return a % b; } }
function csTruthy(v) { return v instanceof Ptr ? !!v.v : !!v; }
function csEq(a, b) { if (isNil(a) || isNil(b)) return isNil(a) && isNil(b); return csArg(a) === csArg(b); }
function use(v, what) { if (v && v.ns) throw new Error("unknown name " + v.ns.split(".")[0] + " (not a variable, class or helper)"); return v; }
function csEval(n, sc, out) {
switch (n.k) {
case "num": case "bool": return n.v;
case "null": return null;
case "str": return n.interp ? interp(sc, n.v, out) : n.v;
case "id": { const s = sc.find(n.n); if (s) return s.vars.get(n.n); const c = csClass(n.n); if (c) return { cls: c }; return { ns: n.n }; }
case "mem": { const o = csEval(n.o, sc, out); return csMemberGet(o, n.n, sc, n); }
case "idx": { const o = use(csEval(n.o, sc, out)), i = csArg(csEval(n.i, sc, out)); if (Array.isArray(o)) return o[i]; if (typeof o === "string") return o[i]; if (o instanceof Ptr && o.v) { const kn = RT.klassName(RT.rw(o.v)); if (kn.slice(-2) === "[]") return arrElem(o.v, i); if (RT.fieldOf(o.v, "_items")) return listItems(o.v)[i]; } throw new Error("cannot index " + csFmt(o)); }
case "call": {
const args = n.a.map((x) => use(csEval(x, sc, out)));
const f = n.f;
if (f.k === "id") { const s = sc.find(f.n); if (s) throw new Error(f.n + " is a variable, not a method"); if (CSB[f.n]) return CSB[f.n](args); if (f.n === "print" || f.n === "Print") { out(args.map(csFmtPlain).join(" ")); return undefined; } throw new Error("unknown method " + f.n + "()"); }
if (f.k === "mem") { const o = csEval(f.o, sc, out); return csCallMember(o, f.n, args, f.ga, out); }
throw new Error("cannot call this expression");
}
case "new": { const nm = n.names[n.names.length - 1], args = n.a.map((x) => csArg(csEval(x, sc, out))); if (CSB[nm] && /^(Vector[234]|Quaternion|Color)$/.test(nm)) return CSB[nm](args); throw new Error("cannot create " + nm + " from outside the game (use find(...))"); }
case "typeof": { const c = csClass(n.names.join(".")); if (!c) throw new Error("unknown class " + n.names.join(".")); return { cls: c }; }
case "un": { const v = use(csEval(n.e, sc, out)); if (n.op === "!") return !csTruthy(v); if (n.op === "-") return Array.isArray(v) ? v.map((x) => -x) : -csArg(v); return csArg(v); }
case "cast": { const v = csArg(use(csEval(n.e, sc, out))); if (n.ty === "int" || n.ty === "long" || n.ty === "short" || n.ty === "byte" || n.ty === "uint") return Math.trunc(v); if (n.ty === "float" || n.ty === "double") return +v; if (n.ty === "string") return String(v); if (n.ty === "bool") return !!v; return v; }
case "cond": return csTruthy(use(csEval(n.c, sc, out))) ? csEval(n.a, sc, out) : csEval(n.b, sc, out);
case "bin": {
if (n.op === "&&") { const l = use(csEval(n.l, sc, out)); return csTruthy(l) ? csTruthy(use(csEval(n.r, sc, out))) : false; }
if (n.op === "||") { const l = use(csEval(n.l, sc, out)); return csTruthy(l) ? true : csTruthy(use(csEval(n.r, sc, out))); }
if (n.op === "??") { const l = csEval(n.l, sc, out); return isNil(l) ? csEval(n.r, sc, out) : l; }
const a = use(csEval(n.l, sc, out)), b = use(csEval(n.r, sc, out));
switch (n.op) {
case "==": return csEq(a, b); case "!=": return !csEq(a, b);
case "<": return csArg(a) < csArg(b); case ">": return csArg(a) > csArg(b); case "<=": return csArg(a) <= csArg(b); case ">=": return csArg(a) >= csArg(b);
case "+": if (typeof a === "string" || typeof b === "string") return csFmtPlain(a) + csFmtPlain(b); return arith("+", a, b);
default: return arith(n.op, a, b);
}
}
case "post": { const old = csEval(n.e, sc, out); csAssign(n.e, arith(n.op === "++" ? "+" : "-", old, 1), sc, out); return old; }
case "asg": { let v = use(csEval(n.r, sc, out)); if (n.op !== "=") { const cur = csEval(n.l, sc, out); v = n.op === "+=" && (typeof cur === "string") ? cur + csFmtPlain(v) : arith(n.op[0], cur, v); } csAssign(n.l, v, sc, out); return v; }
}
throw new Error("unsupported expression " + n.k);
}
function csAssign(t, v, sc, out) {
if (t.k === "id") { const s = sc.find(t.n); (s || csRoot).vars.set(t.n, v); return; }
if (t.k === "mem") { csMemberSet(use(csEval(t.o, sc, out)), t.n, v); return; }
if (t.k === "idx") { const o = use(csEval(t.o, sc, out)), i = csArg(csEval(t.i, sc, out)); if (Array.isArray(o)) { o[i] = v; return; } throw new Error("cannot assign into this array"); }
throw new Error("cannot assign to this expression");
}
const csRoot = new Scope(); csRoot.vars = csGlobals;
const SIG_BREAK = { s: "break" }, SIG_CONT = { s: "continue" };
function csTarget(t) { const joined = t.names.slice(0, -1).join("."), name = t.names[t.names.length - 1], cls = csClass(joined); if (!cls) throw new Error("unknown class " + joined); const k = RT.klassByName(cls); let kk = k, g = 0; const have = new Set(); while (kk && RT.inHeap(kk) && g++ < 14) { RT.methodsOfKlass(kk).forEach((x) => { if (x.name === name) have.add(x.pars.length); }); kk = RT.L.parent ? RT.rw(kk + RT.L.parent) : 0; } if (!have.size) throw new Error("no method " + cls + "." + name); const argc = t.argc >= 0 ? t.argc : (have.size === 1 ? Array.from(have)[0] : -1); if (argc < 0) throw new Error(name + " has overloads with " + Array.from(have).join("/") + " arguments"); return { f: findChain(cls, name, argc), label: cls.split(".").pop() + "." + name }; }
function csCommand(n, sc, out) {
switch (n.name) {
case "help": return "C# subset: diag(); player(); objects(\"jake\"); find(\"Jake\"); scanFirst(1234); scanNext(1234, prev); scanWrite(addr, 999); if/while/for/foreach; Class.Method(args); hold o.f = v; release; hook C.M(n) => expr; patch C.M => value|nop; unhook C.M|all; hooks.";
case "release": ovRelease("code"); return "released";
case "hooks": { const l = HOOKS.list(); return l.length ? l.map((r) => r.label + "  " + r.hits + " hits" + (r.err ? "  ERR " + r.err : "")).join("\n") : "no hooks"; }
case "unhook": { if (n.all) { HOOKS.off(); return "all hooks removed"; } const t = csTarget(n.target); const r = HOOKS.list().find((x) => x.fn === t.f.m.fn); if (!r) return "not hooked"; HOOKS.off(r); return "unhooked " + t.label; }
case "hold": { const a = n.e; if (a.k !== "asg" || a.l.k !== "mem") throw new Error("hold needs obj.field = value"); const o = csArg(use(csEval(a.l.o, sc, out))), f = RT.fieldOf(o, a.l.n); if (!f) throw new Error("no field " + a.l.n); ovSet("code", o, f, csArg(csEval(a.r, sc, out))); return "holding " + a.l.n; }
case "patch": case "hook": { const t = csTarget(n.target); let rec; if (n.name === "patch") { if (n.nop) rec = hookFound(t.f, () => 0, t.label + " (nop)"); else { const v = csArg(csEval(n.body.ast, sc, out)); rec = hookFound(t.f, () => v, t.label + " => " + csFmt(v)); } } else { const fn = new Function("orig", "args", "return (" + n.body + ");"); rec = hookFound(t.f, (a, orig) => fn(function () { return orig.apply(null, a); }, a.slice(0, -1)), t.label); } return (n.name === "patch" ? "patched " : "hooked ") + t.label + " (sig " + rec.sig + ")"; }
}
}
function csExec(n, sc, out, top) {
switch (n.k) {
case "block": { const s2 = new Scope(sc); for (const st of n.b) { const r = csExec(st, s2, out, false); if (r) return r; } return null; }
case "var": { const v = n.e ? use(csEval(n.e, sc, out)) : null; sc.vars.set(n.n, v); return top ? { say: n.n + " = " + csFmt(v) } : null; }
case "expr": { const v = csEval(n.e, sc, out); const pr = n.e.k === "call" && ((n.e.f.k === "id" && n.e.f.n === "print") || (n.e.f.k === "mem" && /^(Log|LogWarning|LogError|WriteLine|Write)$/.test(n.e.f.n))); if (top && !pr) out(csFmt(v)); return null; }
case "if": { if (csTruthy(use(csEval(n.c, sc, out)))) return csExec(n.a, sc, out, false); if (n.b) return csExec(n.b, sc, out, false); return null; }
case "while": { let g = 0; while (csTruthy(use(csEval(n.c, sc, out)))) { if (++g > 100000) throw new Error("loop > 100000"); const r = csExec(n.b, sc, out, false); if (r === SIG_BREAK) break; if (r && r !== SIG_CONT) return r; } return null; }
case "for": { const s2 = new Scope(sc); if (n.init) csExec(n.init, s2, out, false); let g = 0; while (!n.c || csTruthy(use(csEval(n.c, s2, out)))) { if (++g > 100000) throw new Error("loop > 100000"); const r = csExec(n.b, s2, out, false); if (r === SIG_BREAK) break; if (r && r !== SIG_CONT) return r; if (n.st) csEval(n.st, s2, out); } return null; }
case "foreach": { const items = toIter(use(csEval(n.e, sc, out))); for (const it of items) { const s2 = new Scope(sc); s2.vars.set(n.n, it); const r = csExec(n.b, s2, out, false); if (r === SIG_BREAK) break; if (r && r !== SIG_CONT) return r; } return null; }
case "ret": return { ret: n.e ? csEval(n.e, sc, out) : undefined };
case "brk": return SIG_BREAK;
case "cont": return SIG_CONT;
case "cmd": { const r = csCommand(n, sc, out); if (top && r !== undefined) out(r); return null; }
}
throw new Error("unsupported statement " + n.k);
}
function csRun(src) {
if (!RT || !RT.ok) { const trimmed = String(src || "").trim(); if (/^diag\s*\(\s*\)\s*;?$/.test(trimmed)) return CSB.diag(); return "not connected yet — type diag() for details, or wait for the green dot"; }
const lines = [], out = (x) => lines.push(x);
let prog; try { prog = new CsParser(src).program(); } catch (e) { return "syntax error, " + (e.message || e); }
for (const st of prog) { try { const r = csExec(st, csRoot, out, true); if (r && r.say) out(r.say); if (r && r.ret !== undefined) out(csFmt(r.ret)); if (r && r.ret !== undefined) break; } catch (e) { out("error" + (st.k === "expr" || st.k === "var" ? "" : " in " + st.k) + ": " + (e && e.message || e)); break; } }
return lines.join("\n");
}
const looksJS = (code) => /(^|\n)\s*\/\/\s*js\b|\bss\.|\bfunction\b|(^|\n)\s*(const|let)\s/.test(code) && !/(^|\n)\s*(hook|patch)\s/.test(code);

// ---------- Frida translator ----------
function csToFrida(src) {
let prog; try { prog = new CsParser(src).program(); } catch (e) { return "// syntax error, " + (e.message || e); }
const classes = new Map(), declared = [new Set()];
const isDecl = (n) => declared.some((s) => s.has(n));
const asmOf = (full) => { const l = RT && RT.ok && RT.cls(full); return l ? RT.meta.assemblyOf(l[0]) : "Assembly-CSharp"; };
const clsVar = (full) => { const id = "C_" + full.replace(/[^A-Za-z0-9]/g, "_"); if (!classes.has(id)) classes.set(id, { asm: asmOf(full), full }); return id; };
const chain = (n) => { if (n.k === "id") return [n.n]; if (n.k === "mem") { const l = chain(n.o); return l ? l.concat(n.n) : null; } return null; };
const asClass = (n) => { const c = chain(n); if (!c || isDecl(c[0])) return null; for (let i = c.length; i >= 1; i--) { const full = RT && RT.ok ? csClass(c.slice(0, i).join(".")) : (i === c.length ? c.join(".") : null); if (full && i === c.length) return full; } return null; };
const q = (s) => JSON.stringify(s);
const E = (n) => {
switch (n.k) {
case "num": return String(n.v); case "bool": return String(n.v); case "null": return "null";
case "str": return n.interp ? "S(`" + n.v.replace(/`/g, "\\`").replace(/\{([^{}]+)\}/g, "${$1}") + "`)" : "S(" + q(n.v) + ")";
case "id": return isDecl(n.n) ? n.n : (RT && RT.ok && csClass(n.n) ? clsVar(csClass(n.n)) : n.n);
case "typeof": return clsVar((RT && RT.ok && csClass(n.names.join("."))) || n.names.join("."));
case "mem": { const c = asClass(n); if (c) return clsVar(c); const bc = asClass(n.o); if (bc && RT && RT.ok) { const ev = csEnumMember(bc, n.n); if (ev !== undefined) return String(ev); } if (n.n === "Length" || n.n === "Count") return "len(" + E(n.o) + ")"; return "get(" + E(n.o) + ", " + q(n.n) + ")"; }
case "idx": return "idx(" + E(n.o) + ", " + E(n.i) + ")";
case "call": {
const a = n.a.map(E);
if (n.f.k === "id") { const nm = n.f.n; if (nm === "print") return "console.log(" + a.join(", ") + ")"; if (["find", "findAll", "findByName"].indexOf(nm) >= 0) return nm + "(" + n.a.map((x) => (x.k === "str" ? q(x.v) : E(x))).join(", ") + ")"; if (/^Vector[234]$|^Quaternion$|^Color$/.test(nm)) return "vec(" + clsVar("UnityEngine." + nm) + (a.length ? ", " : "") + a.join(", ") + ")"; return nm + "(" + a.join(", ") + ")"; }
if (n.f.k === "mem") { const bc = asClass(n.f.o); if (bc && /(^|\.)(Debug|Console)$/.test(bc)) return "console.log(" + a.join(", ") + ")"; if (n.f.n === "GetComponent" && n.f.ga) return "comp(" + E(n.f.o) + ", " + q(n.f.ga[0]) + ")"; return "call(" + E(n.f.o) + ", " + q(n.f.n) + (a.length ? ", " : "") + a.join(", ") + ")"; }
return "(" + E(n.f) + ")(" + a.join(", ") + ")";
}
case "new": { const nm = n.names[n.names.length - 1]; if (/^Vector[234]$|^Quaternion$|^Color$/.test(nm)) return "vec(" + clsVar("UnityEngine." + nm) + (n.a.length ? ", " : "") + n.a.map(E).join(", ") + ")"; return "/* cannot construct " + nm + " here */ null"; }
case "un": return "(" + n.op + E(n.e) + ")";
case "cast": return n.ty === "int" || n.ty === "long" ? "Math.trunc(" + E(n.e) + ")" : n.ty === "string" ? "String(" + E(n.e) + ")" : "(" + E(n.e) + ")";
case "cond": return "(" + E(n.c) + " ? " + E(n.a) + " : " + E(n.b) + ")";
case "bin": { if ((n.op === "==" || n.op === "!=") && (n.r.k === "null" || n.l.k === "null")) { const x = n.r.k === "null" ? n.l : n.r; return (n.op === "==" ? "" : "!") + "nul(" + E(x) + ")"; } if (n.op === "??") return "(nul(" + E(n.l) + ") ? " + E(n.r) + " : " + E(n.l) + ")"; return "(" + E(n.l) + " " + (n.op === "==" ? "===" : n.op === "!=" ? "!==" : n.op) + " " + E(n.r) + ")"; }
case "post": return E(n.e) + n.op;
case "asg": { if (n.l.k === "mem") { const o = E(n.l.o); if (n.op === "=") return "set(" + o + ", " + q(n.l.n) + ", " + E(n.r) + ")"; return "set(" + o + ", " + q(n.l.n) + ", get(" + o + ", " + q(n.l.n) + ") " + n.op[0] + " " + E(n.r) + ")"; } return E(n.l) + " " + n.op + " " + E(n.r); }
}
return "/* unsupported " + n.k + " */ null";
};
const lines = [];
const S_ = (n, d) => {
const p = "  ".repeat(d);
switch (n.k) {
case "block": lines.push(p + "{"); declared.push(new Set()); n.b.forEach((x) => S_(x, d + 1)); declared.pop(); lines.push(p + "}"); break;
case "var": declared[declared.length - 1].add(n.n); lines.push(p + "let " + n.n + (n.e ? " = " + E(n.e) : "") + ";"); break;
case "expr": lines.push(p + E(n.e) + ";"); break;
case "if": lines.push(p + "if (" + E(n.c) + ")"); S_(n.a, d); if (n.b) { lines.push(p + "else"); S_(n.b, d); } break;
case "while": lines.push(p + "while (" + E(n.c) + ")"); S_(n.b, d); break;
case "for": { declared.push(new Set()); const init = n.init ? (n.init.k === "var" ? (declared[declared.length - 1].add(n.init.n), "let " + n.init.n + (n.init.e ? " = " + E(n.init.e) : "")) : E(n.init.e)) : ""; lines.push(p + "for (" + init + "; " + (n.c ? E(n.c) : "") + "; " + (n.st ? E(n.st) : "") + ")"); S_(n.b, d); declared.pop(); break; }
case "foreach": declared.push(new Set([n.n])); lines.push(p + "for (const " + n.n + " of iter(" + E(n.e) + "))"); S_(n.b, d); declared.pop(); break;
case "ret": lines.push(p + "return" + (n.e ? " " + E(n.e) : "") + ";"); break;
case "brk": lines.push(p + "break;"); break;
case "cont": lines.push(p + "continue;"); break;
case "cmd": {
if (n.name === "hold") { const a = n.e; lines.push(p + "setInterval(() => set(" + E(a.l.o) + ", " + q(a.l.n) + ", " + E(a.r) + "), 100);"); break; }
if (n.name === "hooks" || n.name === "help" || n.name === "release") { lines.push(p + "// " + n.name + " (live tool command, nothing to translate)"); break; }
if (n.name === "unhook") { lines.push(p + "// unhook: revert with m.revert() on the method you hooked"); break; }
const t = n.target, joined = t.names.slice(0, -1).join("."), mname = t.names[t.names.length - 1];
const full = (RT && RT.ok && csClass(joined)) || joined, kv = clsVar(full), argc = t.argc >= 0 ? t.argc : 0;
const body = n.name === "patch" ? (n.nop ? "return;" : "return " + E(n.body.ast) + ";") : "return (" + n.body + ");";
lines.push(p + "{ const m = " + kv + ".method(" + q(mname) + ", " + argc + "); m.implementation = function (...args) { const orig = () => (this && this.method ? this.method(" + q(mname) + ", " + argc + ").invoke(...args) : m.invoke(...args)); " + body + " }; }");
break;
}
}
};
prog.forEach((st) => S_(st, 1));
const head = [
'import "frida-il2cpp-bridge";', "",
"Il2Cpp.perform(() => {",
"  const K = (asm, name) => Il2Cpp.domain.assembly(asm).image.class(name);",
"  const S = (s) => Il2Cpp.string(s);",
"  const nul = (o) => o === null || o === undefined || (o.isNull && o.isNull());",
"  const get = (o, n) => { try { return o.field(n).value; } catch (e) { return o.method(\"get_\" + n).invoke(); } };",
"  const set = (o, n, v) => { try { o.field(n).value = v; } catch (e) { o.method(\"set_\" + n).invoke(v); } };",
"  const call = (o, n, ...a) => o.method(n, a.length).invoke(...a);",
"  const len = (o) => (o.length !== undefined ? o.length : get(o, \"Count\"));",
"  const idx = (o, i) => (o.get ? o.get(i) : o[i]);",
"  const iter = (e) => (Array.isArray(e) ? e : Array.from(e));",
"  const vec = (k, ...c) => { const o = k.new(); o.method(\".ctor\", c.length).invoke(...c); return o.unbox(); };",
"  const GO = K(\"UnityEngine.CoreModule\", \"UnityEngine.GameObject\");",
"  const findAll = (x) => { const r = []; for (const a of Il2Cpp.domain.assemblies) { const k = a.image.tryClass(x); if (k) return Il2Cpp.gc.choose(k); } return Il2Cpp.gc.choose(GO).filter((g) => get(g, \"name\") === x); };",
"  const find = (x) => { if (typeof x !== \"string\") return x; const g = GO.method(\"Find\").invoke(S(x)); if (!nul(g)) return g; return findAll(x)[0] ?? null; };",
"  const findByName = (x) => { const g = GO.method(\"Find\").invoke(S(x)); return nul(g) ? null : g; };",
"  const comp = (o, T) => call(o, \"GetComponent\", Il2Cpp.domain.assemblies.map((a) => a.image.tryClass(T)).find((k) => k).type.object);"
];
const consts = Array.from(classes, ([id, c]) => "  const " + id + " = K(" + q(c.asm) + ", " + q(c.full) + ");");
return head.concat(["  // classes"], consts, ["", "  // your script"], lines, ["});"]).join("\n");
}

// ===================================================================================================
// UI
// ===================================================================================================
let D = document;
const IC = {
spawn: '<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/><path d="M19 3v4M17 5h4"/>',
dev: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
explorer: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
console: '<path d="M4 17l6-6-6-6M12 19h8"/>',
save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
prefs: '<path d="M4 6h8M16 6h4M4 12h4M12 12h8M4 18h10M18 18h2"/><circle cx="14" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
refresh: '<path d="M20 11a8 8 0 1 0-2.3 6"/><path d="M20 4v7h-7"/>',
back: '<path d="M15 6l-6 6 6 6"/>',
lock: '<rect x="6" y="11" width="12" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
play: '<path d="M7 4l12 8-12 8z"/>',
trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>',
target: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
plus: '<path d="M12 5v14M5 12h14"/>',
map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
min: '<path d="M5 12h14"/>',
dot: '<circle cx="12" cy="12" r="5" fill="currentColor"/>',
scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M21 7V5a2 2 0 0 0-2-2h-2M3 17v2a2 2 0 0 0 2 2h2M21 17v2a2 2 0 0 1-2 2h-2"/><circle cx="12" cy="12" r="3"/>',
paint: '<path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'
};
const icon = (n, s) => { const x = D.createElement("span"); x.className = "ic"; s = s || 16; x.innerHTML = '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (IC[n] || "") + "</svg>"; return x; };
const el = (tag, props, kids) => { const n = D.createElement(tag); if (props) Object.assign(n, props); (kids || []).forEach((k) => k && n.appendChild(k)); return n; };
const THEMES = {
Gold: { ac: "#ffd60a", ac2: "#ff9f0a", tx: "#f7efdc", base: "rgba(24,19,8,.97)", card: "rgba(255,214,10,.07)", inp: "rgba(0,0,0,.4)", edge: "rgba(255,214,10,.45)", btn: "rgba(255,214,10,.14)", btnTx: "#ffe27a" },
Aurora: { ac: "#64d2ff", ac2: "#5e5ce6", tx: "#e8f4ff", base: "rgba(12,16,36,.97)", card: "rgba(100,210,255,.07)", inp: "rgba(0,0,0,.4)", edge: "rgba(100,210,255,.45)", btn: "rgba(100,210,255,.14)", btnTx: "#a8e4ff" },
Neon: { ac: "#ff2d95", ac2: "#bf5af2", tx: "#ffe6f4", base: "rgba(22,8,32,.97)", card: "rgba(255,45,149,.08)", inp: "rgba(0,0,0,.4)", edge: "rgba(255,45,149,.5)", btn: "rgba(255,45,149,.16)", btnTx: "#ff9bd0" },
Matrix: { ac: "#00ff66", ac2: "#00b34a", tx: "#c8ffd9", base: "rgba(4,16,8,.97)", card: "rgba(0,255,102,.07)", inp: "rgba(0,0,0,.45)", edge: "rgba(0,255,102,.45)", btn: "rgba(0,255,102,.13)", btnTx: "#7dffb0" },
Mint: { ac: "#34c759", ac2: "#30b0c7", tx: "#10201a", base: "rgba(236,244,240,.98)", card: "rgba(0,0,0,.05)", inp: "rgba(0,0,0,.08)", edge: "rgba(52,199,89,.6)", btn: "rgba(52,199,89,.18)", btnTx: "#0d6b2b" }
};
const spring = "cubic-bezier(.34,1.56,.64,1)", MONO = "ui-monospace,Menlo,Consolas,monospace";
const CSS = `
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
body{font:13px -apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;color:var(--tx);-webkit-font-smoothing:antialiased}
.ic{display:inline-flex;vertical-align:middle}
.p{position:absolute;inset:0;display:flex;flex-direction:column;border-radius:26px;overflow:hidden;background:linear-gradient(160deg,rgba(255,214,10,.08),rgba(0,0,0,0) 40%),var(--base);box-shadow:inset 0 0 0 1px var(--edge),inset 0 1px 0 rgba(255,255,255,.12)}
.h{flex:none;padding:13px 16px 8px;display:flex;align-items:center;gap:10px;cursor:grab;touch-action:none;user-select:none}
.logo{width:30px;height:30px;border-radius:10px;display:grid;place-items:center;color:#1a1304;background:linear-gradient(135deg,var(--ac),var(--ac2));box-shadow:0 2px 10px rgba(255,214,10,.35)}
.ttl1{font-weight:800;font-size:14px;letter-spacing:.2px;line-height:1.1}
.ttl1 small{display:block;font-weight:600;font-size:10px;opacity:.6;letter-spacing:.4px;margin-top:2px}
.pro{font-size:9px;letter-spacing:1px;padding:2px 6px;border-radius:7px;margin-left:6px;color:#1a1304;font-weight:800;vertical-align:middle;background:linear-gradient(90deg,var(--ac),#fff4b0,var(--ac));background-size:200% 100%;animation:shine 3s linear infinite}
@keyframes shine{to{background-position:-200% 0}}
.sp{flex:1}
.hb{width:28px;height:28px;border-radius:9px;border:0;background:var(--btn);color:var(--btnTx);display:grid;place-items:center;cursor:pointer;padding:0}
.hb:hover{filter:brightness(1.25)}
.stat{flex:none;margin:0 14px 8px;padding:6px 10px;border-radius:12px;background:var(--card);font:11px ${MONO};display:flex;align-items:center;gap:8px;color:var(--tx)}
.stat .d{width:8px;height:8px;border-radius:50%;background:#ff453a;box-shadow:0 0 8px currentColor;flex:none}
.stat.ok .d{background:var(--ac)}.stat.mid .d{background:#ff9f0a}
.stat span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.b{flex:1;min-height:0;overflow-y:auto;padding:2px 14px 26px;display:flex;flex-direction:column;gap:10px}
.b::-webkit-scrollbar{width:6px}.b::-webkit-scrollbar-thumb{background:var(--edge);border-radius:3px}
.tabs{flex:none;display:flex;position:relative;margin:0 14px 8px;padding:3px;border-radius:16px;background:var(--card)}
.tab{flex:1;position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0 5px;font-weight:700;font-size:10px;cursor:pointer;opacity:.6;transition:opacity .2s;user-select:none}
.tab.on{opacity:1;color:#1a1304}
.pill{position:absolute;top:3px;bottom:3px;left:3px;border-radius:13px;background:linear-gradient(135deg,var(--ac),var(--ac2));box-shadow:0 3px 12px rgba(255,214,10,.3);transition:transform .35s ${spring}}
.pg{display:flex;flex-direction:column;gap:10px}.pg.hide{display:none}
.card{background:var(--card);border-radius:18px;padding:12px 13px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.05);display:flex;flex-direction:column;gap:9px}
.ttl{display:flex;align-items:center;gap:6px;font-weight:800;font-size:10.5px;letter-spacing:.7px;color:var(--ac);text-transform:uppercase}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.lbl{font-weight:650;min-width:0}.lbl small{display:block;opacity:.6;font-size:11px;font-weight:400;margin-top:1px}
.note{font-size:11px;opacity:.65;line-height:1.4}
.btn{border:0;border-radius:12px;padding:0 12px;height:30px;background:var(--btn);color:var(--btnTx);font:700 12px -apple-system,system-ui,sans-serif;cursor:pointer;flex:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}
.btn:hover{filter:brightness(1.2)}.btn:active{transform:scale(.95)}
.btn.hot{background:linear-gradient(135deg,var(--ac),var(--ac2));color:#1a1304}
.btns{display:flex;gap:6px;flex-wrap:wrap}.btns .btn{flex:1 1 auto}
.num,.sel,.txt{height:30px;background:var(--inp);border:0;border-radius:10px;padding:0 10px;color:var(--tx);font:700 12px ${MONO};outline:none;text-align:right;min-width:0}
.num{width:104px}.num.s{width:72px}.txt{width:100%;text-align:left;font:12px -apple-system,system-ui,sans-serif}
.sel{text-align:left;width:150px;font:600 12px -apple-system,system-ui,sans-serif}
.sel option{background:#1a1304;color:#fff}
textarea.txt{height:120px;padding:8px 10px;resize:vertical;font:11.5px ${MONO};line-height:1.4}
.sw{width:46px;height:28px;border-radius:14px;background:rgba(255,255,255,.14);position:relative;cursor:pointer;transition:background .25s;flex:none}
.sw i{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:11px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.45);transition:transform .3s ${spring}}
.sw.on{background:linear-gradient(135deg,var(--ac),var(--ac2))}.sw.on i{transform:translateX(18px)}
.tbl{max-height:290px;overflow-y:auto;border-radius:14px;background:rgba(0,0,0,.22)}
.tbl::-webkit-scrollbar{width:6px}.tbl::-webkit-scrollbar-thumb{background:var(--edge);border-radius:3px}
.tr{min-height:32px;display:flex;align-items:center;gap:6px;padding:3px 8px 3px 10px;border-bottom:1px solid rgba(255,255,255,.05)}
.nm{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:11px ${MONO}}
.ty{flex:none;max-width:76px;opacity:.45;font:10px ${MONO};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tr input{width:92px;flex:none;background:var(--inp);border:0;border-radius:8px;padding:4px 8px;color:var(--tx);font:600 11.5px ${MONO};outline:none;text-align:right}
.ib{flex:none;width:26px;height:24px;border:0;border-radius:8px;background:var(--btn);color:var(--btnTx);display:grid;place-items:center;cursor:pointer;padding:0}
.ib.on{background:linear-gradient(135deg,var(--ac),var(--ac2));color:#1a1304}
.link{color:var(--ac);cursor:pointer}.link:hover{text-decoration:underline}
pre.out{margin:0;padding:8px 10px;border-radius:12px;background:rgba(0,0,0,.28);font:11px/1.45 ${MONO};white-space:pre-wrap;word-break:break-all;max-height:190px;overflow:auto;user-select:text}
.sub{display:flex;gap:6px}.sub .btn{flex:1}.sub .btn.on{background:linear-gradient(135deg,var(--ac),var(--ac2));color:#1a1304}
.rs{position:absolute;right:7px;bottom:7px;width:20px;height:20px;cursor:nwse-resize;touch-action:none;opacity:.8;background:linear-gradient(135deg,transparent 0 48%,var(--ac) 48% 58%,transparent 58% 68%,var(--ac) 68% 78%,transparent 78%);border-bottom-right-radius:20px}
`;
const swDraws = [];
const lbl = (t, s) => el("div", { className: "lbl" }, [D.createTextNode(t), el("small", { textContent: s || "" })]);
const R_ = (a, b) => el("div", { className: "row" }, [a, b]);
const RR = (...k) => el("div", { className: "row", style: "gap:6px" }, k);
const card = (title, kids, ic) => el("div", { className: "card" }, (title ? [el("div", { className: "ttl" }, [ic ? icon(ic, 14) : null, D.createTextNode(title)])] : []).concat(kids));
const btn = (t, fn, cls, ic) => { const b = el("button", { className: "btn" + (cls ? " " + cls : "") }, [ic ? icon(ic, 14) : null, D.createTextNode(t)]); b.onclick = fn; return b; };
const ibtn = (ic, fn, title, on) => { const b = el("button", { className: "ib" + (on ? " on" : ""), title: title || "" }, [icon(ic, 14)]); b.onclick = fn; return b; };
const sw = (get, set) => { const n = el("div", { className: "sw" }, [el("i")]); const draw = () => n.classList.toggle("on", !!get()); n.onclick = () => { set(!get()); draw(); }; swDraws.push(draw); draw(); return n; };
const num = (get, set, small) => { const i = el("input", { type: "text", className: "num" + (small ? " s" : ""), spellcheck: false }); i.value = get(); i.onchange = () => { const v = Number(i.value); if (!isFinite(v)) { i.value = get(); return; } set(v); }; i.onkeydown = (e) => { if (e.key === "Enter") i.blur(); }; return i; };
const sel = (opts, get, set) => { const s = el("select", { className: "sel" }); opts.forEach((o) => s.appendChild(el("option", { value: o, textContent: o }))); s.value = get(); s.onchange = () => set(s.value); return s; };
const slid = (min, max, get, set, suf) => { const i = el("input", { type: "range", min, max, value: get() }); i.style.cssText = "width:110px;accent-color:var(--ac)"; const t = el("span", { className: "nm", textContent: get() + suf }); t.style.cssText = "flex:none;width:48px;text-align:right"; i.oninput = () => { set(+i.value); t.textContent = get() + suf; }; return el("div", { className: "row", style: "gap:6px" }, [i, t]); };
const groupSw = (id) => sw(() => groupOn(id), (v) => { if (v && (!RT || !RT.ok)) { say("not connected yet, wait for the green dot"); return; } setGroup(id, v); });
const copyText = (t) => { try { (window.navigator.clipboard).writeText(t); say("copied"); } catch (e) { say("copy failed"); } };

let FR = null, PANEL = null, BODY = null, bodyEls = {};
function buildUI() {
FR = document.createElement("iframe");
FR.title = "Subway Surfers mod";
FR.setAttribute("allowtransparency", "true");
const place = () => { FR.style.cssText = "position:fixed;left:" + S.x + "px;top:" + S.y + "px;width:" + S.w + "px;height:" + (S.min ? 56 * S.zoom / 100 : S.h) + "px;max-width:98vw;max-height:98vh;border:0;background:transparent;z-index:2147483647;color-scheme:normal"; };
place();
document.body.appendChild(FR);
const doc = FR.contentDocument;
doc.open(); doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'); doc.close();
D = doc;
doc.head.appendChild(el("style", { textContent: CSS }));
const applyLook = () => {
const t = THEMES[S.theme] || THEMES.Gold, st = doc.documentElement.style;
st.setProperty("--ac", t.ac); st.setProperty("--ac2", t.ac2); st.setProperty("--tx", t.tx); st.setProperty("--base", t.base); st.setProperty("--card", t.card); st.setProperty("--inp", t.inp); st.setProperty("--edge", t.edge); st.setProperty("--btn", t.btn); st.setProperty("--btnTx", t.btnTx);
FR.style.opacity = S.ui / 100;
if (PANEL) PANEL.style.zoom = S.zoom / 100;
place();
};

// ----- header -----
const statDot = el("div", { className: "d" }), statTxt = el("span", { textContent: "starting..." });
const stat = el("div", { className: "stat" }, [statDot, statTxt, ibtn("refresh", () => { if (RT && RT.ok) RT.refresh(false); say("refreshing objects"); }, "refresh the object list")]);
const minBtn = el("button", { className: "hb", title: "minimize" }, [icon("min", 14)]);
const head = el("div", { className: "h" }, [el("div", { className: "logo" }, [icon("spawn", 18)]), el("div", { className: "ttl1" }, [D.createTextNode("Subway Surfers"), el("span", { className: "pro", textContent: "PRO" }), el("small", { textContent: "mod menu v7" })]), el("div", { className: "sp" }), minBtn]);

// ===== SPAWN =====
const chunkOut = el("div", { className: "tbl" }), chunkHead = el("div", { className: "note" });
const cs = { cont: null, filter: "" };
const chunkFilter = el("input", { type: "text", className: "txt", placeholder: "filter lists or chunk names...", spellcheck: false });
function chunkRender() {
chunkOut.innerHTML = "";
if (!RT || !RT.ok) { chunkOut.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: "waiting for the game..." })])); return; }
const conts = chunkContainers(), q = chunkFilter.value.trim().toLowerCase();
if (cs.cont === null) {
chunkHead.textContent = conts.length + " weighted lists (route sections, chunks, transitions...)";
conts.filter((c) => !q || c.name.toLowerCase().indexOf(q) >= 0 || c.entries.some((e) => e.name.toLowerCase().indexOf(q) >= 0)).slice(0, 80).forEach((c) => {
const r = el("div", { className: "tr" }, [el("div", { className: "nm link", textContent: c.name + "  \u2022  " + c.entries.slice(0, 2).map((e) => e.name).join(", "), title: c.name }), el("div", { className: "ty", textContent: c.entries.length + " items" })]);
r.firstChild.onclick = () => { cs.cont = c.addr; chunkRender(); };
chunkOut.appendChild(r);
});
return;
}
const c = conts.find((x) => x.addr === cs.cont);
if (!c) { cs.cont = null; chunkRender(); return; }
chunkHead.textContent = c.name + ": " + c.entries.length + " items";
chunkOut.appendChild(el("div", { className: "tr" }, [ibtn("back", () => { cs.cont = null; chunkRender(); }, "back"), el("div", { className: "nm", textContent: "all lists" })]));
c.entries.forEach((e) => {
const inp = el("input", { type: "text", spellcheck: false, value: String(RT.read(e.addr, e.wf)) });
inp.onchange = () => { const v = Number(inp.value); if (!isFinite(v)) return; ovSet("chunkpick", e.addr, e.wf, v); rebuildContainers(); say(e.name + " weight " + v); };
inp.onkeydown = (ev) => { if (ev.key === "Enter") inp.blur(); };
chunkOut.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: e.name, title: e.name }), inp, ibtn("target", () => { chunkOnly(c, e); say("only " + e.name + " in this list"); chunkRender(); }, "only this one")]));
});
}
chunkFilter.addEventListener("input", () => { clearTimeout(chunkFilter.__t); chunkFilter.__t = setTimeout(chunkRender, 200); });
const ruleMode = sel(["Keep the first of every list", "Keep entries whose name contains"], () => (chunkRule.mode === "first" ? "Keep the first of every list" : "Keep entries whose name contains"), (v) => { chunkRule.mode = v.indexOf("first") >= 0 ? "first" : "match"; });
const ruleText = el("input", { type: "text", className: "txt", placeholder: "name text, e.g. a chunk name", spellcheck: false });
ruleText.oninput = () => { chunkRule.text = ruleText.value; };
const chunkCard = card("Chunk weights", [
el("div", { className: "note", textContent: "Every list the game picks road chunks from has weights. Setting all but one to 0 makes the game use only that chunk." }),
ruleMode, ruleText,
R_(lbl("Apply to every list", "also covers lists that load later"), groupSw("chunkrule")),
el("div", { className: "btns" }, [btn("Restore all weights", chunkRestore, "", "undo")]),
chunkFilter, chunkHead, chunkOut
], "cube");

const pkOut = el("div", { className: "tbl" });
function pkRender() {
pkOut.innerHTML = "";
const rows = pickupRows();
if (!rows.length) { pkOut.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: RT && RT.ok ? "no pickup data yet, start a run" : "waiting for the game..." })])); return; }
rows.forEach((r) => {
const w = el("input", { type: "text", spellcheck: false, value: String(RT.read(r.addr, r.fw)) });
w.onchange = () => { const v = Number(w.value); if (isFinite(v)) { ovSet("pickupweights", r.addr, r.fw, v); say(r.name + " weight " + v); } };
w.onkeydown = (ev) => { if (ev.key === "Enter") w.blur(); };
pkOut.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: r.name }), w, ibtn("target", () => { pickupOnly(r, rows); pkRender(); }, "only this pickup")]));
});
}
const typeNames = ["Key", "CoinMagnet", "SuperSneakers", "JetPack", "MysteryBox", "MultiplierScore2x", "MysteryPowerup", "LetterHuntCharacter", "SuperMysteryBox", "TokenHunt", "LetterHuntDaily", "PogoStick"];
const pickCard = card("Pickups and powerups", [
el("div", { className: "note", textContent: "Spawn points in new road chunks use these. Force one type at every spawn point to line up as many as you like." }),
R_(lbl("Force this pickup everywhere", "every spawn point makes it"), sel(typeNames, () => pk.force, (v) => { pk.force = v; })),
R_(lbl("Force it now"), groupSw("force")),
R_(lbl("No spacing between pickups", "spawn right after each other"), groupSw("nospace")),
el("div", { className: "btns" }, [btn("Powerup flood", () => { if (!RT || !RT.ok) { say("not connected yet"); return; } setGroup("force", true); setGroup("nospace", true); setGroup("flood", true); say("flood on: " + pk.force + " forced, spawned and spaced at zero"); }, "hot", "spawn"), btn("Restore pickups", () => { setGroup("flood", false); setGroup("force", false); setGroup("nospace", false); ovRelease("pickupweights"); pkRender(); say("pickups restored"); }, "", "undo")]),
el("div", { className: "ttl" }, [D.createTextNode("Spawn weights")]), pkOut,
el("div", { className: "btns" }, [btn("Refresh list", pkRender, "", "refresh")])
], "spawn");

const tuneCard = card("Powerup tuning", TUNE.map((t) => el("div", { className: "row" }, [lbl(t.title, t.sub), RR(num(() => S.vals[t.id], (v) => { S.vals[t.id] = v; persist(); }, true), groupSw(t.id))])), "spawn");
const pageSpawn = el("div", { className: "pg" }, [pickCard, chunkCard, tuneCard]);

// ===== SCAN =====
function ssScanEl() {
const wrap = el("div", {});
wrap.style.cssText = "display:flex;flex-direction:column;gap:6px;font:12px/1.35 " + MONO + ";color:#eee;";
const row = (...kids) => { const d = el("div"); d.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;align-items:center;"; kids.forEach((k) => d.appendChild(k)); return d; };
const typeSel = el("select", { className: "sel" });
["int32", "uint32", "float", "double", "int16", "int8"].forEach((t) => { const o = el("option", { value: t, textContent: t }); typeSel.appendChild(o); });
typeSel.value = MS.type; typeSel.onchange = () => MS.type = typeSel.value;
const valIn = el("input", { className: "txt", placeholder: "value", spellcheck: false }); valIn.style.flex = "1";
const first = btn("First Scan", async () => {
if (MS.busy) return; MS.busy = true;
try {
const v = parseFloat(valIn.value); if (isNaN(v)) throw new Error("enter a number");
MS.prev = await msFirstScan(MS.type, v, (p) => { status.textContent = "scanning… " + Math.round(p * 100) + "%"; });
status.textContent = MS.prev.length + " result(s)"; render();
} catch (e) { status.textContent = "error: " + e.message; }
finally { MS.busy = false; }
}, "hot");
const next = btn("Next Scan", () => {
if (!MS.prev.length) { status.textContent = "run a First Scan first"; return; }
const v = parseFloat(valIn.value); if (isNaN(v)) { status.textContent = "enter a number"; return; }
MS.prev = msNextScan(MS.type, v, MS.prev);
status.textContent = MS.prev.length + " result(s)"; render();
});
const reset = btn("Reset", () => { MS.prev = []; status.textContent = ""; render(); });
const status = el("div"); status.style.cssText = "color:#9a9;min-height:16px;white-space:pre-wrap;";
const list = el("div", { className: "tbl" });
function render() {
list.innerHTML = "";
if (!MS.prev.length) { list.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: "no results" })])); return; }
MS.prev.slice(0, 300).forEach((addr) => {
const v = msRead(addr, MS.type);
const a = el("div", { className: "nm", textContent: "0x" + addr.toString(16).padStart(8, "0") }); a.style.color = "#aaa";
const vv = el("div", { className: "nm", textContent: "= " + v });
const inp = el("input", { type: "text", spellcheck: false, placeholder: "new" });
const setBtn = ibtn("target", () => { msWrite(addr, MS.type, parseFloat(inp.value)); render(); }, "set");
list.appendChild(el("div", { className: "tr" }, [a, vv, inp, setBtn]));
});
if (MS.prev.length > 300) list.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: "… " + (MS.prev.length - 300) + " more" })]));
}
render();
wrap.append(row(typeSel, valIn), row(first, next, reset), status, list);
return wrap;
}
const scanCard = card("Raw memory scanner", [
el("div", { className: "note", textContent: "Searches the wasm heap for an exact value. Type a number, First Scan, change it in-game, Next Scan, then set the survivors. Works even if IL2CPP scanning isn't ready. Reload after edits to commit." }),
ssScanEl()
], "scan");
const pageScan = el("div", { className: "pg hide" }, [scanCard]);

// ===== DEV =====
const devActiveSel = el("div", { className: "note" });
const incC = { coins: 1000000, keys: 1000 };
const devCard = card("Developer settings", [
el("div", { className: "note", textContent: "These are the game's own debug switches (SYBO.Subway.Utilities.DebugSettings). If a switch does nothing, turn on Developer mode first." }),
R_(lbl("Developer mode", "marks debugging as allowed"), groupSw("dev_active")),
devActiveSel
].concat(DEV.map((d) => R_(lbl(d.title, d.sub), groupSw("dev" + d.f)))), "dev");
const walletCard = card("Wallet", [
R_(lbl("Add coins"), RR(num(() => incC.coins, (v) => { incC.coins = Math.round(v); }, true), btn("Add", () => { try { say("coins " + walletAdd("coins", incC.coins)); } catch (e) { say(String(e.message || e)); } }, "", "plus"))),
R_(lbl("Add keys"), RR(num(() => incC.keys, (v) => { incC.keys = Math.round(v); }, true), btn("Add", () => { try { say("keys " + walletAdd("keys", incC.keys)); } catch (e) { say(String(e.message || e)); } }, "", "plus"))),
el("div", { className: "note", textContent: "Calls the game's own InventorySave.SetCoins / SetKeys and shows the amount before and after." })
], "dev");
const pageDev = el("div", { className: "pg hide" }, [devCard, walletCard]);

// ===== GUI =====
const gui = { list: [], selected: null, busy: false };
const guiList = el("div", { className: "tbl" }), guiSearch = el("input", { type: "text", className: "txt", placeholder: "search UI elements...", spellcheck: false });
const guiPreviewBox = el("div", { style: "background:#111;border:1px solid #333;border-radius:8px;padding:10px;min-height:80px;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:10px;" });
const guiPreviewText = el("span", { style: "font-family:sans-serif;font-size:24px;font-weight:bold;color:#fff;" });
guiPreviewBox.appendChild(guiPreviewText);
const guiEditor = el("div", { style: "display:none;flex-direction:column;gap:10px;" });
const guiTextIn = el("input", { className: "txt", placeholder: "Change Text...", spellcheck: false });
const guiColorIn = el("input", { type: "color", style: "width:100%;height:30px;border:none;background:none;cursor:pointer;" });

guiTextIn.oninput = () => {
if (!gui.selected) return;
try {
const m = RT.findMethod(RT.rw(gui.selected), "set_text", 1);
if (m) RT.invoke(m, gui.selected, [RT.newString(guiTextIn.value)]);
guiPreviewText.textContent = guiTextIn.value;
} catch (e) { say("Failed to set text"); }
};
guiColorIn.oninput = () => {
if (!gui.selected) return;
try {
const hex = guiColorIn.value;
const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
const m = RT.findMethod(RT.rw(gui.selected), "set_color", 1);
if (m) RT.invoke(m, gui.selected, [[r,g,b,1]]);
guiPreviewText.style.color = hex;
} catch (e) { say("Failed to set color"); }
};

doc.addEventListener("keydown", (e) => {
if (e.ctrlKey && e.key === "c" && gui.selected) {
if (doc.activeElement.tagName === "INPUT") return;
navigator.clipboard.writeText(guiTextIn.value);
say("Copied text to clipboard");
}
});

guiEditor.append(guiPreviewBox, guiTextIn, guiColorIn);

function guiRender() {
guiList.innerHTML = "";
const q = guiSearch.value.trim().toLowerCase();
gui.list.filter(x => !q || x.name.toLowerCase().includes(q)).slice(0, 100).forEach(item => {
const r = el("div", { className: "tr", style: "cursor:pointer;" }, [
el("div", { className: "nm", textContent: item.name }),
el("div", { className: "ty", textContent: item.type })
]);
r.onclick = () => {
gui.selected = item.obj;
guiEditor.style.display = "flex";
if (item.type === "Text" || item.type === "UILabel") {
guiTextIn.disabled = false;
try {
const m = RT.findMethod(RT.rw(item.obj), "get_text", 0);
const t = m ? RT.invokeF(m, item.obj, []) : "";
guiTextIn.value = t;
guiPreviewText.textContent = t;
const cm = RT.findMethod(RT.rw(item.obj), "get_color", 0);
const c = cm ? RT.invoke(cm, item.obj, []) : [1,1,1,1];
const chex = "#" + [c[0],c[1],c[2]].map(x => Math.round(Math.max(0, Math.min(1, x))*255).toString(16).padStart(2,'0')).join("");
guiColorIn.value = chex;
guiPreviewText.style.color = chex;
} catch(e) {}
} else {
guiTextIn.value = "[Image]";
guiTextIn.disabled = true;
guiPreviewText.textContent = "";
guiPreviewBox.style.background = "#333";
}
};
guiList.appendChild(r);
});
}
guiSearch.addEventListener("input", () => guiRender());

async function scanGUI() {
    if (!RT || !RT.ok || gui.busy) return;
    gui.busy = true;
    say("Scanning UI...");
    const classesToScan = ["UnityEngine.UI.Text", "UILabel", "UnityEngine.UI.Image"];
    let found = [];
    const getActive = RT.findMethod(RT.klassByName("UnityEngine.GameObject"), "get_activeInHierarchy", 0);
    const getGo = RT.findMethod(RT.klassByName("UnityEngine.Component"), "get_gameObject", 0);

    for (const cls of classesToScan) {
        const objs = RT.liveAll(cls);
        for (let i = 0; i < objs.length; i++) {
            const obj = objs[i];
            try {
                const go = RT.invoke(getGo, obj, []);
                if (!go) continue;
                const isActive = RT.invokeF(getActive, go, []);
                if (!isActive) continue;
                const name = unityName(go) || "Unknown UI";
                found.push({ obj, type: cls.split('.').pop(), name: name });
            } catch(e) {}
            if (i % 50 === 0) await new Promise(r => setTimeout(r, 0));
        }
    }
    gui.list = found;
    gui.busy = false;
    say(`Found ${found.length} active UI elements`);
    guiRender();
}

const scanGuiBtn = btn("Rescan UI", () => scanGUI(), "hot", "scan");

const pageGui = el("div", { className: "pg hide" }, [
card("Live GUI Scanner", [scanGuiBtn, el("div", { className: "note", textContent: "Auto-scans on boot. Only shows active UI elements. Press Ctrl+C to copy selected text." }), guiSearch, guiList], "paint"),
card("GUI Editor", [guiEditor], "prefs")
]);

// ===== EXPLORER =====
const ex = { view: "objects", cls: null, objs: [], obj: null, stack: [], locks: new Map() };
const exSearch = el("input", { type: "text", className: "txt", placeholder: "search class or namespace...", spellcheck: false });
const exList = el("div", { className: "tbl" }), exHead = el("div", { className: "note" }), exFields = el("div", { className: "tbl" }), exNav = el("div", { className: "btns" });
const exObjCard = card("Objects", [exSearch, exList], "list");
const exInspCard = card("Inspector", [exHead, exNav, exFields], "explorer");
let exRows = [];
function exClasses() {
exList.innerHTML = "";
if (!RT || !RT.ok) { exList.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: "waiting for the game..." })])); return; }
const q = exSearch.value.trim().toLowerCase(), m = RT.meta, out = [];
for (let i = 0; i < m.T.length; i++) {
if (i < m.gameStart && !q) continue;
const nm = m.name(i);
if (q && nm.toLowerCase().indexOf(q) < 0) continue;
const c = (RT.objs.get(i) || []).length;
if (!q && !c) continue;
out.push([nm, i, c]);
}
out.sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : 1));
out.slice(0, 120).forEach(([nm, i, c]) => {
const r = el("div", { className: "tr" }, [el("div", { className: "nm link", textContent: nm, title: nm }), el("div", { className: "ty", textContent: c + " obj" })]);
r.firstChild.onclick = () => { ex.cls = i; ex.objs = (RT.objs.get(i) || []).slice(0, 60); ex.obj = null; ex.stack = []; exRender(); };
exList.appendChild(r);
});
if (q.length >= 3) {
const hits = objectNames().filter((h) => h.name.toLowerCase().indexOf(q) >= 0).slice(0, 60);
if (hits.length) exList.appendChild(el("div", { className: "tr" }, [el("div", { className: "ttl" }, [D.createTextNode("Objects named like \"" + q + "\"")])]));
hits.forEach((h) => {
const r = el("div", { className: "tr" }, [el("div", { className: "nm link", textContent: h.name, title: hex(h.ptr) }), el("div", { className: "ty", textContent: "GameObject" })]);
r.firstChild.onclick = () => { ex.cls = null; ex.obj = h.ptr; ex.stack = []; exRender(); };
exList.appendChild(r);
});
}
}
function exOpen(addr, push) { if (push && ex.obj) ex.stack.push(ex.obj); ex.obj = addr; exRender(); }
function getterRow(m, a) {
const out = el("div", { className: "nm", textContent: "tap get", style: "text-align:right;flex:none;max-width:130px" });
const row = el("div", { className: "tr" }, [el("div", { className: "nm", textContent: m.name.replace("get_", ""), title: m.owner + "." + m.name }), el("div", { className: "ty", textContent: m.ret.replace("System.", "") }), out, ibtn("play", () => { try { const r = RT.call(m, a, []); out.textContent = RT.fmtRet(m, r); if (m.ret !== "System.Void" && /^0x/.test(out.textContent)) { out.className = "nm link"; out.onclick = () => exOpen(parseInt(out.textContent, 16) >>> 0, true); } } catch (e) { out.textContent = "err: " + (e.message || e); } }, "read")]);
return row;
}
function parseArg(p, text) {
text = text.trim();
if (p.type === "System.Boolean") return text === "true" || text === "1";
if (p.type === "System.String") return text;
if (RT.STRUCT[p.type]) { const v = text.replace(/[()\[\]]/g, "").split(",").map(Number); if (v.some((x) => !isFinite(x))) throw new Error(p.name + " needs numbers like 1,2,3"); return v; }
const l = RT.cls(p.type);
if (l && RT.meta.isEnum(l[0]) && text && isNaN(Number(text))) { const e = RT.enumOf(p.type).find((x) => x.name.toLowerCase() === text.toLowerCase()); if (!e) throw new Error("no " + p.type + " value " + text); return e.value; }
const v = Number(text); if (!isFinite(v)) throw new Error(p.name + " needs a number"); return v;
}
function methodRow(m, a) {
const sig = m.name + "(" + m.pars.map((p) => p.type.replace("System.", "") + " " + p.name).join(", ") + ")";
const wrap = el("div", {});
const head = el("div", { className: "tr" }, [el("div", { className: "nm link", textContent: sig, title: m.ret + " " + sig })]);
const form = el("div", { className: "tr", style: "display:none;flex-wrap:wrap" });
const ins = m.pars.map((p) => el("input", { type: "text", placeholder: p.name + " (" + p.type.replace("System.", "") + ")", title: p.type, spellcheck: false, value: p.type === "System.String" ? "" : RT.STRUCT[p.type] ? RT.STRUCT[p.type] === 3 ? "0,0,0" : "0,0" : "0" }));
const res = el("div", { className: "nm", textContent: "" });
ins.forEach((i) => form.appendChild(i));
form.appendChild(btn("Run", () => { try { const args = ins.map((i, k) => parseArg(m.pars[k], i.value)); res.textContent = RT.fmtRet(m, RT.call(m, a, args)); } catch (e) { res.textContent = "err: " + (e.message || e); } }, "hot", "play"));
form.appendChild(res);
head.firstChild.onclick = () => { if (!m.pars.length) { try { res.textContent = RT.fmtRet(m, RT.call(m, a, [])); form.style.display = "flex"; } catch (e) { res.textContent = "err: " + (e.message || e); form.style.display = "flex"; } } else form.style.display = form.style.display === "none" ? "flex" : "none"; };
wrap.appendChild(head); wrap.appendChild(form);
return wrap;
}
function exRender() {
exNav.innerHTML = ""; exFields.innerHTML = ""; exRows = [];
if (!RT || !RT.ok) return;
if (ex.obj === null) {
if (ex.cls === null) { exHead.textContent = "pick a class in Objects"; return; }
exHead.textContent = RT.meta.name(ex.cls) + ": " + ex.objs.length + " live object(s)";
ex.objs.forEach((a, i) => exNav.appendChild(btn("#" + (i + 1) + "  " + hex(a), () => exOpen(a, false))));
return;
}
const a = ex.obj, ins = RT.inspect(a);
exNav.appendChild(btn("Back", () => { ex.obj = ex.stack.pop() || null; exRender(); }, "", "back"));
exNav.appendChild(btn("Refresh", exRender, "", "refresh"));
exNav.appendChild(btn("Copy address", () => copyText(hex(a)), "", "copy"));
if (ins) exNav.appendChild(btn("C# source", () => { const ti = RT.typedefOfKlass(ins.klass); if (ti >= 0) { showSource(ti); setSub("classes"); } }, "", "console"));
if (!ins) { exHead.textContent = "not a game object (" + hex(a) + ")"; return; }
exHead.textContent = ins.name + " @ " + hex(a) + "   (" + ins.parents.slice(1, 4).join(" < ") + ")";
const arr = RT.arrayInfo(a);
if (arr) {
const dv = new DataView(RT.M.HEAPU8.buffer);
for (let i = 0; i < arr.len; i++) {
const ea = arr.base + i * arr.sz;
let v;
if (arr.el === "Single") v = dv.getFloat32(ea, true); else if (arr.sz === 4) v = dv.getUint32(ea, true) >>> 0; else if (arr.sz === 1) v = dv.getUint8(ea); else if (arr.sz === 2) v = dv.getInt16(ea, true); else v = dv.getFloat64(ea, true);
const isPtr = arr.sz === 4 && ["Single", "Int32", "UInt32"].indexOf(arr.el) < 0 && v > 4096;
const val = el("div", { className: "nm" + (isPtr ? " link" : ""), textContent: isPtr ? hex(v) : String(v), style: "text-align:right" });
if (isPtr) val.onclick = () => exOpen(v, true);
exFields.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: "[" + i + "]" }), val]));
}
return;
}
const seen = new Set();
exFields.appendChild(el("div", { className: "tr" }, [el("div", { className: "ttl" }, [D.createTextNode("Variables")])]));
ins.fields.forEach((f) => {
if (f.isConst || (f.isStatic && !RT.L.statics)) return;
const key = f.owner + "." + f.name + (f.isStatic ? "#s" : "");
if (seen.has(key)) return; seen.add(key);
const editable = ["float", "double", "int", "uint", "short", "ushort", "byte", "sbyte", "bool", "long", "ulong", "char"].indexOf(f.kind) >= 0 || VEC_SIZES[f.tn];
const isRef = ["object", "array", "generic", "T", "ptr"].indexOf(f.kind) >= 0;
const nm = el("div", { className: "nm", textContent: (f.isStatic ? "static " : "") + f.name, title: f.owner + "." + f.name });
const ty = el("div", { className: "ty", textContent: f.tn, title: f.tn });
let val;
if (editable) {
const init = VEC_SIZES[f.tn] ? (csFieldVal(a, f) || []).join(",") : (f.enumTi >= 0 ? String(RT.read(a, f)) : RT.show(a, f));
val = el("input", { type: "text", spellcheck: false, value: init });
val.title = f.enumTi >= 0 ? RT.show(a, f) : "";
val.onchange = () => {
try {
let v = val.value.trim();
if (VEC_SIZES[f.tn]) { v = v.replace(/[()\[\]]/g, "").split(",").map(Number); if (v.some((x) => !isFinite(x))) { val.value = init; return; } }
else if (f.kind === "bool") v = v === "true" || v === "1";
else { v = Number(v); if (!isFinite(v)) { val.value = RT.show(a, f); return; } }
csSetField(a, f, v); if (ex.locks.has(key)) ex.locks.get(key).v = v;
say(f.name + " = " + v);
} catch (e) { say("write failed: " + e.message); }
};
val.onkeydown = (e) => { if (e.key === "Enter") val.blur(); };
exRows.push([val, f, a]);
} else {
const t = RT.show(a, f);
val = el("div", { className: "nm" + (isRef && t.indexOf("0x") === 0 ? " link" : ""), textContent: t, style: "text-align:right;flex:none;max-width:120px" });
if (isRef && t.indexOf("0x") === 0) val.onclick = () => exOpen(parseInt(t, 16) >>> 0, true);
}
const kids = [nm, ty, val];
if (editable) kids.push(ibtn("lock", function () { if (ex.locks.has(key)) ex.locks.delete(key); else ex.locks.set(key, { a, f, v: RT.read(a, f) }); this.classList.toggle("on", ex.locks.has(key)); say(ex.locks.size + " frozen"); }, "freeze this value", ex.locks.has(key)));
exFields.appendChild(el("div", { className: "tr" }, kids));
});
const chain = RT.methodsChain(ins.klass).filter((m) => !/^(\.|add_|remove_|set_)/.test(m.name) && m.name.indexOf("<") < 0);
const getters = chain.filter((m) => /^get_/.test(m.name) && m.pars.length === 0 && !m.static);
const others = chain.filter((m) => !/^get_/.test(m.name) && !m.static);
if (getters.length) { exFields.appendChild(el("div", { className: "tr" }, [el("div", { className: "ttl" }, [D.createTextNode("Properties (tap to read)")])])); getters.slice(0, 80).forEach((m) => exFields.appendChild(getterRow(m, a))); }
if (others.length) { exFields.appendChild(el("div", { className: "tr" }, [el("div", { className: "ttl" }, [D.createTextNode("Methods (tap to run)")])])); others.slice(0, 80).forEach((m) => exFields.appendChild(methodRow(m, a))); }
}
exSearch.addEventListener("input", () => { clearTimeout(exSearch.__t); exSearch.__t = setTimeout(exClasses, 200); });

const srcState = { ti: null };
const clsSearch = el("input", { type: "text", className: "txt", placeholder: "search any class, enum or namespace...", spellcheck: false });
const clsList = el("div", { className: "tbl" });
const srcHead = el("div", { className: "note", textContent: "pick a class to see its C# declaration" }), srcOut = el("pre", { className: "out", textContent: "" });
srcOut.style.maxHeight = "340px";
function clsRender() {
clsList.innerHTML = "";
if (!RT || !RT.ok) { clsList.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: "waiting for the game..." })])); return; }
const q = clsSearch.value.trim().toLowerCase(), m = RT.meta, rows = [];
for (let i = 0; i < m.T.length; i++) {
const nm = m.name(i);
if (/[<>]/.test(nm)) continue;
if (q ? nm.toLowerCase().indexOf(q) < 0 : (i < m.gameStart || i >= m.gameStart + m.gameCount)) continue;
rows.push([nm, i]);
}
rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
rows.slice(0, 200).forEach(([nm, i]) => {
const kind = m.isEnum(i) ? "enum" : (m.T[i].flags & 0x20) ? "interface" : "class";
const r = el("div", { className: "tr" }, [el("div", { className: "nm link", textContent: nm, title: nm + "  (" + m.assemblyOf(i) + ")" }), el("div", { className: "ty", textContent: kind })]);
r.firstChild.onclick = () => showSource(i);
clsList.appendChild(r);
});
if (rows.length > 200) clsList.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: "... " + (rows.length - 200) + " more, narrow the search" })]));
}
function showSource(ti) {
if (!RT || !RT.ok) return;
srcState.ti = ti;
const full = RT.meta.name(ti);
srcHead.textContent = full + "  \u2022  " + RT.meta.assemblyOf(ti) + "  \u2022  " + (RT.objs.get(ti) || []).length + " live object(s)  \u2022  view only (the method bodies are compiled to native code, so they cannot be shown or edited)";
srcOut.textContent = RT.classSource(ti); srcOut.scrollTop = 0;
}
clsSearch.addEventListener("input", () => { clearTimeout(clsSearch.__t); clsSearch.__t = setTimeout(clsRender, 200); });
const exClsCard = card("Classes", [clsSearch, clsList], "cube");
const exSrcCard = card("C# preview (view only)", [srcHead, srcOut, el("div", { className: "btns" }, [btn("Copy", () => copyText(srcOut.textContent), "", "copy"), btn("Live objects", () => { const ti = srcState.ti; if (ti === null) return; ex.cls = ti; ex.objs = (RT.objs.get(ti) || []).slice(0, 60); ex.obj = null; ex.stack = []; setSub("objects"); exRender(); }, "", "list")])], "console");
const subBar = el("div", { className: "sub" });
const pageEx = el("div", { className: "pg hide" }, [subBar, exObjCard, exInspCard, exClsCard, exSrcCard]);
function setSub(v) { ex.view = v; const o = v === "objects"; exObjCard.style.display = o ? "" : "none"; exInspCard.style.display = o ? "" : "none"; exClsCard.style.display = o ? "none" : ""; exSrcCard.style.display = o ? "none" : ""; Array.from(subBar.children).forEach((b) => b.classList.toggle("on", b.__v === v)); if (!o) clsRender(); }
[["objects", "Objects", "list"], ["classes", "Classes", "cube"]].forEach(([v, t, ic]) => { const b = btn(t, () => setSub(v), "", ic); b.__v = v; subBar.appendChild(b); });

// ===== CONSOLE =====
const conIn = el("textarea", { className: "txt", spellcheck: false, placeholder: "// C# on the live game\nvar jake = find(\"Jake\");\nif (jake != null) {\n  var t = jake.transform;\n  t.localScale = new Vector3(2f, 2f, 2f);\n}" });
const conOut = el("pre", { className: "out", textContent: "(output)" }), macroBox = el("div", { className: "btns" });
const macroName = el("input", { type: "text", className: "txt", placeholder: "name for a custom button..." });
const api = {
get RT() { return RT; }, log: LOG, hex,
find: (c) => (RT ? RT.find(c) : []),
findAll: (c) => (RT ? RT.findAll(c) : []),
inspect: (a) => (RT ? RT.inspect(a) : null),
get: (a, n) => { const f = RT.fieldOf(a, n); if (!f) throw new Error("no field " + n); return RT.read(a, f); },
set: (a, n, v) => { const f = RT.fieldOf(a, n); if (!f) throw new Error("no field " + n); RT.write(a, f, v); return v; },
hold: (a, n, v) => { const f = RT.fieldOf(a, n); if (!f) throw new Error("no field " + n); ovSet("console", a, f, v); return "holding"; },
release: () => ovRelease("console"),
call: (a, n, ...args) => { const m = RT.findMethod(RT.rw(a), n, args.length); if (!m) throw new Error("no method " + n + "/" + args.length); return RT.invoke(m, a, args); },
callStatic: (cls, n, ...args) => RT.staticCall(cls, n, args),
runtimeInvoke: (mi, obj, ...args) => RT.runtimeInvoke(mi, obj, args),
newString: (s) => RT.newString(s),
hook: HOOKS, cs: (src) => csRun(src), frida: (src) => csToFrida(src), wallet: (k, n) => walletAdd(k, n), names: () => objectNames(true), source: (ti) => RT.classSource(ti), inRun: () => inRun(),
rescan: () => RT.refresh(true), u32: (a) => RT.M.HEAPU32[a >>> 2], f32: (a) => RT.M.HEAPF32[a >>> 2],
setU32: (a, v) => { RT.M.HEAPU32[a >>> 2] = v >>> 0; }, setF32: (a, v) => { RT.M.HEAPF32[a >>> 2] = v; },
Module: () => getModule(), say,
scanFirst: (v, t) => msScanSync(t || "int32", +v),
scanNext: (v, addrs, t) => msNextScan(t || "int32", +v, addrs || MS.prev),
scanWrite: (addr, v, t) => { msWrite(addr >>> 0, t || "int32", +v); return "ok"; },
diag: () => CSB.diag()
};
window.ss = api;
const runJS = (code) => { try { return (0, eval)("(function(ss){ return (" + code + "\n)})")(api); } catch (e1) { return (0, eval)("(function(ss){" + code + "\n})")(api); } };
const runCode = (code) => (looksJS(code) ? runJS(code) : csRun(code));
function drawMacros() {
macroBox.innerHTML = "";
S.macros.forEach((m, i) => { const b = btn(m.name, () => { try { const r = runCode(m.code); say(typeof r === "string" ? r.split("\n")[0].slice(0, 70) : m.name + " ran"); } catch (e) { say(m.name + ": " + (e.message || e)); } }, "", "play"); b.oncontextmenu = (e) => { e.preventDefault(); S.macros.splice(i, 1); persist(); drawMacros(); }; macroBox.appendChild(b); });
}
if (S.seeded !== 2) {
S.seeded = 2;
const defs = [
{ name: "Jetpack", code: 'if (!inRun()) print("start a run first"); else SYBO.Subway.Game.PickupJetpack();' },
{ name: "Pogo stick", code: 'if (!inRun()) print("start a run first"); else SYBO.Subway.Game.PickupPogostick();' },
{ name: "Magnet", code: 'if (!inRun()) print("start a run first"); else GameStats.TriggerPowerup(UpgradeType.coinmagnet, false);' },
{ name: "Sneakers", code: 'if (!inRun()) print("start a run first"); else GameStats.TriggerPowerup(UpgradeType.supersneakers, false);' },
{ name: "2x score", code: 'if (!inRun()) print("start a run first"); else GameStats.TriggerPowerup(UpgradeType.doubleMultiplier, false);' },
{ name: "+1M coins", code: 'ss.wallet("coins", 1000000)' }
];
const names = new Set(defs.map((d) => d.name));
S.macros = defs.concat(S.macros.filter((m) => !names.has(m.name)));
persist();
}
const pageCon = el("div", { className: "pg hide" }, [
card("Custom code", [conIn, el("div", { className: "btns" }, [btn("Run", () => { try { const v = runCode(conIn.value); conOut.textContent = v === undefined ? "ok" : (typeof v === "object" ? JSON.stringify(v, null, 1) : String(v)); } catch (e) { conOut.textContent = "error: " + (e.message || e); } }, "hot", "play"), btn("Clear", () => { conIn.value = ""; conOut.textContent = "(output)"; }, "", "trash")]), el("div", { className: "btns" }, [btn("To Frida JS", () => { conOut.textContent = looksJS(conIn.value) ? "// this is already JavaScript" : csToFrida(conIn.value); }, "", "console"), btn("Copy output", () => copyText(conOut.textContent), "", "copy")]), conOut,
el("div", { className: "note", textContent: "C# subset on the live game. Try: diag(); player(); objects(\"jake\"); classes(\"player\"); find(\"Jake\"); if (find(\"Jake\") != null) find(\"Jake\").transform.localScale = new Vector3(2,2,2); scanFirst(1234); scanNext(1234, prev); scanWrite(addr, 999); Type help. JavaScript with ss.* still works too." })], "console"),
card("My buttons", [macroName, el("div", { className: "btns" }, [btn("Save code as button", () => { const n = macroName.value.trim(); if (!n || !conIn.value.trim()) { say("give it a name and some code"); return; } S.macros.push({ name: n, code: conIn.value }); persist(); drawMacros(); macroName.value = ""; }, "", "plus")]), macroBox, el("div", { className: "note", textContent: "Right-click or long-press a custom button to delete it." })], "console")
]);

// ===== SAVE =====
const saveInfo = el("pre", { className: "out" }), saveTa = el("textarea", { className: "txt", spellcheck: false, placeholder: "export / import text" });
let wipeArmed = 0;
const pageSave = el("div", { className: "pg hide" }, [
card("Save system", [saveInfo,
el("div", { className: "note", textContent: "The game's own save is switched on (it never saved before) and mirrored to a backup copy every few seconds and when you leave." }),
el("div", { className: "btns" }, [btn("Back up now", async () => { await saveBackup(); say("backed up " + SAVE.files + " files"); }, "hot", "save"), btn("Restore backup", async () => { const n = await saveRestore(true); say(n ? "restored " + n + " files, reload the page" : "nothing to restore"); }, "", "undo")]),
el("div", { className: "btns" }, [btn("Export", () => { saveTa.value = lsGet(MIRROR) || ""; copyText(saveTa.value); }, "", "copy"), btn("Import", async () => { const n = await saveRestore(true, saveTa.value.trim()); say(n ? "imported " + n + " files, reload the page" : "import failed"); }, "", "plus"),
btn("Wipe", function () { if (performance.now() - wipeArmed > 3000) { wipeArmed = performance.now(); this.lastChild.textContent = "Tap again"; setTimeout(() => { this.lastChild.textContent = "Wipe"; }, 3000); return; } try { localStorage.removeItem(MIRROR); indexedDB.deleteDatabase("/idbfs"); } catch (e) {} say("wiped, reload the page"); }, "", "trash")]),
saveTa], "save")
]);

// ===== PREFS =====
const logOut = el("pre", { className: "out" });
const pagePrefs = el("div", { className: "pg hide" }, [
card("Theme", [el("div", { className: "btns" }, Object.keys(THEMES).map((n) => { const b = btn(n, () => { S.theme = n; applyLook(); persist(); }); b.style.boxShadow = "inset 0 -3px 0 " + THEMES[n].ac; return b; }))], "prefs"),
card("Appearance", [
R_(lbl("Panel opacity"), slid(40, 100, () => S.ui, (v) => { S.ui = v; applyLook(); persist(); }, "%")),
R_(lbl("Text size"), slid(70, 150, () => S.zoom, (v) => { S.zoom = v; applyLook(); persist(); }, "%")),
R_(lbl("Toasts"), sw(() => S.toasts, (v) => { S.toasts = v; persist(); })),
R_(lbl("Reset panel size & position"), btn("Reset", () => { S.w = 390; S.h = 600; S.zoom = 100; S.x = 12; S.y = 12; applyLook(); persist(); })),
el("div", { className: "note", textContent: "Drag the header to move the panel and the gold corner to resize it. Press H in the game to hide or show it. If the panel ever disappears, tap the SS button in the bottom-left of the page." })
], "prefs"),
card("Log", [logOut, el("div", { className: "btns" }, [btn("Copy log", () => copyText(LOG.join("\n")), "", "copy")])], "list")
]);

const TABS = [["Spawn", "spawn", pageSpawn], ["Scan", "scan", pageScan], ["GUI", "paint", pageGui], ["Dev", "dev", pageDev], ["Explore", "explorer", pageEx], ["Code", "console", pageCon], ["Save", "save", pageSave], ["Prefs", "prefs", pagePrefs]];
const pill = el("div", { className: "pill" }); pill.style.width = "calc((100% - 6px) / " + TABS.length + ")";
const tabEls = TABS.map(([name, ic], i) => { const t = el("div", { className: "tab" }, [icon(ic, 16), D.createTextNode(name)]); t.onclick = () => setTab(i); return t; });
const setTab = (i) => {
S.tab = i; persist();
uiOpen.explorer = i === 4; uiOpen.spawn = i === 0; uiOpen.scan = i === 1; uiOpen.gui = i === 2;
pill.style.transform = "translateX(" + (i * 100) + "%)";
tabEls.forEach((t, j) => t.classList.toggle("on", j === i));
TABS.forEach(([, , p], j) => p.classList.toggle("hide", j !== i));
if (i === 0) { chunkRender(); pkRender(); }
if (i === 4) { exClasses(); exRender(); if (ex.view === "classes") clsRender(); }
if (i === 2) guiRender();
};
BODY = el("div", { className: "b" }, TABS.map((t) => t[2]));
const rs = el("div", { className: "rs", title: "drag to resize" });
PANEL = el("div", { className: "p" }, [head, stat, el("div", { className: "tabs" }, [pill].concat(tabEls)), BODY, rs]);
doc.body.appendChild(PANEL);
bodyEls = { statDot, statTxt, stat, saveInfo, logOut, devActiveSel };

// ----- toasts -----
const tbox = document.createElement("div");
tbox.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none;z-index:2147483647";
document.body.appendChild(tbox);
let lastToast = 0;
toast = (msg) => {
if (!S.toasts) return;
const nw = performance.now(); if (nw - lastToast < 250) return; lastToast = nw;
const n = document.createElement("div");
n.textContent = msg;
n.style.cssText = "padding:8px 16px;border-radius:16px;background:rgba(24,19,8,.94);color:#ffe27a;font:700 12px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,214,10,.4);opacity:0;transform:translateY(-12px);transition:opacity .3s,transform .3s";
tbox.appendChild(n);
requestAnimationFrame(() => requestAnimationFrame(() => { n.style.opacity = 1; n.style.transform = "none"; }));
setTimeout(() => { n.style.opacity = 0; setTimeout(() => n.remove(), 350); }, 2400);
while (tbox.children.length > 3) tbox.firstChild.remove();
};

// ----- main-page fallback launcher -----
const launcher = document.createElement("div");
launcher.id = "ssmod-launcher";
launcher.textContent = "SS";
launcher.style.cssText = "position:fixed;left:10px;bottom:10px;width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#ffd60a,#ff9f0a);color:#1a1304;display:flex;align-items:center;justify-content:center;font:800 14px system-ui,sans-serif;cursor:pointer;z-index:2147483647;box-shadow:0 2px 10px rgba(0,0,0,.5);user-select:none;";
launcher.onclick = () => {
if (!FR) return;
const hidden = FR.style.display === "none";
if (hidden) { FR.style.display = ""; if (S.min) { S.min = false; place(); } }
else FR.style.display = "none";
};
document.body.appendChild(launcher);
addEventListener("resize", () => {
S.x = Math.max(-S.w + 80, Math.min(innerWidth - 80, S.x));
S.y = Math.max(0, Math.min(innerHeight - 60, S.y));
place();
});

// ----- drag, resize, minimize -----
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
let drag = null;
head.addEventListener("pointerdown", (e) => { if (e.target.closest && e.target.closest(".hb")) return; drag = { sx: e.screenX, sy: e.screenY, x: S.x, y: S.y }; head.setPointerCapture(e.pointerId); head.style.cursor = "grabbing"; });
head.addEventListener("pointermove", (e) => { if (!drag) return; S.x = clamp(drag.x + e.screenX - drag.sx, -S.w + 80, innerWidth - 80); S.y = clamp(drag.y + e.screenY - drag.sy, 0, innerHeight - 60); FR.style.left = S.x + "px"; FR.style.top = S.y + "px"; });
const dEnd = () => { if (drag) persist(); drag = null; head.style.cursor = ""; };
head.addEventListener("pointerup", dEnd); head.addEventListener("pointercancel", dEnd);
minBtn.onclick = () => { S.min = !S.min; place(); persist(); };
let rsd = null;
rs.addEventListener("pointerdown", (e) => { e.preventDefault(); rsd = { sx: e.screenX, sy: e.screenY, w: S.w, h: S.h }; try { rs.setPointerCapture(e.pointerId); } catch (x) {} });
rs.addEventListener("pointermove", (e) => { if (!rsd) return; S.w = clamp(Math.round(rsd.w + e.screenX - rsd.sx), 300, 1000); S.h = clamp(Math.round(rsd.h + e.screenY - rsd.sy), 240, 1400); place(); });
const rsEnd = () => { if (rsd) persist(); rsd = null; };
rs.addEventListener("pointerup", rsEnd); rs.addEventListener("pointercancel", rsEnd);
rs.addEventListener("dblclick", () => { S.w = 390; S.h = 600; S.x = 12; S.y = 12; place(); persist(); });
addEventListener("keydown", (e) => {
const t = e.target;
if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
if ((e.key === "h" || e.key === "H") && !e.ctrlKey && !e.metaKey && !e.altKey) FR.style.display = FR.style.display === "none" ? "" : "none";
});

// ----- periodic refresh -----
setInterval(() => {
if (S.min) return;
swDraws.forEach((f) => { try { f(); } catch (e) {} });
const M = getModule();
let state = "bad", text;
if (!M || !M.HEAPU8) text = "waiting for the game to load...";
else if (!RT) text = "game loaded, starting...";
else if (RT.ok) { state = "ok"; text = "connected  \u2022  " + RT.kinv.size + " classes  \u2022  " + (RT.total || 0) + " objects"; }
else { state = "mid"; text = RT.status; }
if (OV.size) text += "  \u2022  " + OV.size + " held";
if (HK.size) text += "  \u2022  " + HK.size + " hooked";
stat.className = "stat " + state; statTxt.textContent = text;
saveInfo.textContent = "engine save sync: " + SAVE.engine + "\nbackup files: " + SAVE.files + (SAVE.lastBackup ? "  (last " + new Date(SAVE.lastBackup).toLocaleTimeString() + ")" : "") + "\nrestored this session: " + SAVE.restored + (SAVE.err ? "\nnote: " + SAVE.err : "");
if (S.tab === 6) logOut.textContent = LOG.slice(-60).join("\n");
if (S.tab === 3 && RT && RT.ok) {
const f = RT.liveAll(DEVC)[0];
devActiveSel.textContent = f ? "DebugSettings found (" + hex(f) + ")" : "DebugSettings does not exist yet, the game only creates it on demand. Switch a setting on twice to try creating it.";
}
if (S.tab === 4) exRows.forEach(([inp, f, a]) => { if (D.activeElement === inp) return; try { const s = VEC_SIZES[f.tn] ? (csFieldVal(a, f) || []).join(",") : (f.enumTi >= 0 ? String(RT.read(a, f)) : RT.show(a, f)); if (inp.value !== s) inp.value = s; } catch (e) {} });
}, 600);
setInterval(() => { ex.locks.forEach((L) => { try { RT.write(L.a, L.f, L.v); } catch (e) {} }); }, 100);

// Auto-scan UI once connected
const uiCheck = setInterval(() => {
    if (RT && RT.ok) {
        clearInterval(uiCheck);
        scanGUI();
    }
}, 2000);

applyLook(); drawMacros(); setSub("objects");
setTab(S.tab >= 0 && S.tab < TABS.length ? S.tab : 0);
dlog("Subway Surfers mod v7 ready");
}

if (document.body) buildUI(); else addEventListener("DOMContentLoaded", buildUI);
window.__ssRT = () => RT;
dlog("Subway Surfers mod v7 loaded, dedicated GUI tab active");

})();