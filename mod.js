/* Subway Surfers (Unity WebGL 2019.4, IL2CPP) mod, v2 (IL2CPP backend)
 * Auto-connects to the running game, no scans needed. The GUI is unchanged, the backend now talks to the game
 * through its own C# methods wherever the dump shows one:
 *  - Calls: real IL2CPP methods are invoked through the wasm function table (strings, structs, 64-bit, enums).
 *  - Hooks: wasm table trampolines for virtual/interface/delegate calls (counted, so you can see if they fire).
 *  - Spawn: SetSpawnPointForced / SpawnPickup / BuildRandomlyOrderedPrefabList(SyboRandom), not just field writes.
 *  - Developer: DebugSettings static setters.  Wallet: InventorySave.IncreaseCoins(int, string).
 *  - Code tab: a live C# style invoker/patcher (Class.Method(args), obj.field = v, hook / patch / hold).
 * Load it in index.html BEFORE master-loader.js:   <script src="ss_mod_v2.js"></script>
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
// SAVE SYSTEM. The engine only syncs /idbfs (PlayerPrefs, Save/local, ...) to IndexedDB when Module.indexedDB
// is truthy, and nothing in the framework sets it, so nothing persisted. This sets it, and keeps a backup copy.
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
// RUNTIME: reads the game's memory using the IL2CPP metadata that sits in the heap
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
for (let i = 0; i < m.imgs[1] / 40; i++) { const o = m.imgs[0] + i * 40; if (sname(dv.getInt32(o, true)) === "Assembly-CSharp.dll") { gs = dv.getInt32(o + 8, true); gc = dv.getInt32(o + 12, true); } }
m.gameStart = gs; m.gameCount = gc;
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

// class index: the runtime Il2CppClass for every metadata type
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

// objects: every instance of every known class, one sliced pass
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
// element i of a managed reference array (T[]): length at +12, items from +16
R.arrayItems = (arr) => { if (!inHeap(arr)) return []; const n = Math.min(rw(arr + 12), 4000), out = []; for (let i = 0; i < n; i++) out.push(rw(arr + 16 + i * 4)); return out; };

// methods
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
// the method record for a MethodInfo*, like il2cpp_method_get_... (MethodInfo+12 is its class)
R.methodByMI = (mi) => { const k = rw(mi + 12); if (!inHeap(k)) return null; return R.methodsOfKlass(k).find((x) => x.mi === mi) || null; };

// ---- subclasses and class lookup ----
R.klassByName = (full) => { const l = R.cls(full); return l ? ((R.klassOf.get(l[0]) || [])[0] || 0) : 0; };
// every metadata type whose runtime class is, or derives from, the named class (generic bases included)
R.subTypes = (full) => {
const key = full + "#" + R.kinv.size;
const hit = R.subCache.get(key); if (hit) return hit;
const base = R.cls(full); if (!base) return [];
const baseK = new Set(); for (const ti of base) for (const k of (R.klassOf.get(ti) || [])) baseK.add(k);
const out = new Set(base);
if (R.L.parent) for (const [k, ti] of R.kinv) {
if (out.has(ti)) continue;
let kk = rw(k + R.L.parent), g = 0;
while (kk && inHeap(kk) && g++ < 14) { if (baseK.has(kk)) { out.add(ti); break; } kk = rw(kk + R.L.parent); }
}
const arr = Array.from(out); R.subCache.set(key, arr); return arr;
};
R.findAll = (full) => { let out = []; for (const ti of R.subTypes(full)) out = out.concat(R.objs.get(ti) || []); return out; };

// ---- calls: through the wasm function table, the same entry the game's own indirect calls use ----
const PRIM = new Set(["System.Int32", "System.UInt32", "System.Int16", "System.UInt16", "System.Byte", "System.SByte", "System.Boolean", "System.Char", "System.IntPtr", "System.UIntPtr"]);
const STRUCT = { "UnityEngine.Vector3": 3, "UnityEngine.Vector2": 2, "UnityEngine.Quaternion": 4, "UnityEngine.Color": 4, "UnityEngine.Vector4": 4 };
R.STRUCT = STRUCT;
R.table = () => {
const c = [M.wasmTable, M.asm && M.asm.__indirect_function_table, M.asm && M.asm.table, M.asm && M.asm.__table];
return c.find((t) => t && typeof t.get === "function") || null;
};
// wasm value class of a C# type name: i f d j, v (void), S (known struct, passed by pointer) or null (unsupported struct)
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
// a managed string the game can read: String class pointer, no monitor, length, UTF-16 chars (never freed, the game may keep it)
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
// call method record m with (this, args). args: numbers, booleans, JS strings (for String parameters), float arrays (for Vector3 etc.), BigInt/numbers for 64-bit
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
if (fn) r = fn.apply(null, a);
else {
if (sig.indexOf("j") >= 0) throw new Error("64-bit values need the wasm function table, which this build does not expose");
const f = M["dynCall_" + sig]; if (!f) throw new Error("no dynCall_" + sig + " in this build");
r = f.apply(null, [m.fn].concat(a));
}
if (sret) { const out = []; for (let i = 0; i < sret; i++) out.push(M.HEAPF32[(sbuf >> 2) + i]); return out; }
if (typeof r === "bigint") r = Number(r);
return r;
} finally { bufs.forEach((b) => M._free(b)); }
};
R.call = (m, thisPtr, args) => R.invoke(m, thisPtr, args);
// the same, but results come back as friendly JS values (bool, string, unsigned pointer)
R.invokeF = (m, thisPtr, args) => {
const r = R.invoke(m, thisPtr, args);
if (Array.isArray(r) || r === undefined) return r;
if (m.ret === "System.Void") return undefined;
if (m.ret === "System.Boolean") return !!r;
if (m.ret === "System.String") { const s = R.readStr(r >>> 0); return s === null ? (r >>> 0) : s; }
if (R.isPtrType(m.ret)) return r >>> 0;
return r;
};
// il2cpp_runtime_invoke, in spirit: a MethodInfo*, an object (0 for static) and the arguments
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

// connect and refresh
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
const S = Object.assign({ w: 390, h: 600, zoom: 100, ui: 100, theme: "Gold", toasts: true, tab: 0, vals: {}, macros: [], min: false, x: 12, y: 12 }, (() => { try { return JSON.parse(lsGet("ssmod_settings_v2")) || {}; } catch (e) { return {}; } })());
const persist = () => lsSet("ssmod_settings_v2", JSON.stringify(S));
let toast = null;
const say = (s) => { dlog(s); if (toast) toast(s); };

// ---------- overrides: write a value, remember the original, restore it when switched off ----------
const OV = new Map();
const GROUPS = new Map();
const ovKey = (obj, f) => obj + ":" + f.owner + "." + f.name;
function ovSet(group, obj, f, val) {
const key = ovKey(obj, f);
let o = OV.get(key);
if (!o) { let orig; try { orig = RT.read(obj, f); } catch (e) { return; } o = { obj, f, orig, val, group }; OV.set(key, o); } else { o.val = val; o.group = group; }
}
function ovApply() {
if (!RT || !RT.ok) return;
for (const [k, o] of OV) {
try {
const cur = RT.read(o.obj, o.f);
const diff = typeof cur === "number" && typeof o.val === "number" ? Math.abs(cur - o.val) > 1e-6 * Math.max(1, Math.abs(o.val)) : cur !== o.val;
if (diff) RT.write(o.obj, o.f, o.val);
} catch (e) { OV.delete(k); }
}
}
function ovRelease(group) {
for (const [k, o] of OV) if (group === "*" || o.group === group) { try { RT.write(o.obj, o.f, o.orig); } catch (e) {} OV.delete(k); }
}
const ovCount = (group) => { let n = 0; for (const o of OV.values()) if (o.group === group) n++; return n; };
function defGroup(id, resolve, onChange) { GROUPS.set(id, { on: false, resolve, onChange, sig: -1 }); }
function setGroup(id, on) {
const g = GROUPS.get(id); if (!g) return;
g.on = on;
if (!on) { ovRelease(id); if (g.onChange) { try { g.onChange(); } catch (e) {} } g.sig = -1; } else runGroups();
}
const groupOn = (id) => !!(GROUPS.get(id) && GROUPS.get(id).on);
function runGroups() {
if (!RT || !RT.ok) return;
for (const [id, g] of GROUPS) {
if (!g.on) continue;
try {
const list = g.resolve();
for (const [obj, f, val] of list) ovSet(id, obj, f, val);
const sig = ovCount(id);
if (sig !== g.sig) { g.sig = sig; if (g.onChange) g.onChange(); }
} catch (e) { /* objects change between scans */ }
}
ovApply();
}
setInterval(runGroups, 200);

// helper: fields of every live object of a class
function eachField(cls, fname, cb) {
if (!RT || !RT.ok) return;
for (const obj of RT.find(cls)) { try { const f = RT.fieldOf(obj, fname); if (f) cb(obj, f); } catch (e) {} }
}

// ===================================================================================================
// HOOK ENGINE: swaps a wasm function table entry for a tiny wasm trampoline that calls JS first.
// Only INDIRECT calls (virtual, interface, delegates, runtime_invoke) pass through the table. Direct calls compiled
// into the wasm cannot be intercepted from JS, so every hook counts its hits and the Code tab lists them.
// ===================================================================================================
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
for (const ti of l) for (const k of (RT.klassOf.get(ti) || [])) {
const m = RT.methodsOfKlass(k).find((x) => x.name === name && x.pars.length === argc);
if (m) return { m, k };
}
throw new Error("no method " + cls + "." + name + "/" + argc);
}
const HK = new Map();
let hookId = 0;
function unhookRec(r) { const t = RT && RT.table(); try { if (t) t.set(r.fn, r.orig); } catch (e) {} HK.delete(r.fn); }
function hookMethod(cls, name, argc, make, label) { return hookFound(findOwn(cls, name, argc | 0), make, label); }
// like findOwn, but also finds a method inherited from a base class (returns the declaring class)
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
if (!rec.isStatic) { const k = RT.rw(a[0] >>> 0); if (!(k && RT.isSub(k, rec.klass))) { rec.skipped++; return orig.apply(null, a); } } // shared code (folded identical methods): not ours
rec.hits++;
try { return hcoerce(rc, make(a, orig, rec)); } catch (e) { rec.err = String(e && e.message || e); return orig.apply(null, a); }
};
rec.tramp = buildTramp(sig, js);
t.set(f.m.fn, rec.tramp);
HK.set(f.m.fn, rec);
return rec;
}
const HOOKS = {
attach(cls, name, argc, cb) {
cb = cb || {};
return hookMethod(cls, name, argc, (a, orig) => {
const args = a.slice(0, -1), ctx = {};
if (cb.onEnter) cb.onEnter.call(ctx, args);
const rv = { value: orig.apply(null, args.concat([a[a.length - 1]])) };
if (cb.onLeave) cb.onLeave.call(ctx, rv, args);
return rv.value;
});
},
replace(cls, name, argc, fn) { return hookMethod(cls, name, argc, (a, orig) => fn(function () { return orig.apply(null, a); }, a.slice(0, -1))); },
constant(cls, name, argc, v) { return hookMethod(cls, name, argc, () => v); },
nop(cls, name, argc) { return hookMethod(cls, name, argc, () => 0); },
probe(cls, name, argc) { return hookMethod(cls, name, argc, (a, orig) => orig.apply(null, a)); },
off(rec) { if (rec) unhookRec(rec); else Array.from(HK.values()).forEach(unhookRec); },
list() { return Array.from(HK.values()); }
};

// ---------- exact C# calls ----------
const ovrCls = (cls, f) => { if (!RT || !RT.ok) throw new Error("not connected yet"); return f(); };
function callOn(cls, method, args) {
return ovrCls(cls, () => {
const objs = RT.findAll(cls);
if (!objs.length) throw new Error("no live " + cls.split(".").pop() + " object yet");
const m = RT.findMethod(RT.rw(objs[0]), method, args.length);
if (!m) throw new Error(cls + "." + method + "/" + args.length + " not found");
return RT.invokeF(m, objs[0], args);
});
}
const callStatic = (cls, method, args) => ovrCls(cls, () => RT.staticCall(cls, method, args));
function posOfObj(obj) {
const gt = RT.findMethod(RT.rw(obj), "get_transform", 0); if (!gt) return null;
const tr = RT.invoke(gt, obj, []); if (!tr) return null;
const gp = RT.findMethod(RT.rw(tr), "get_position", 0);
return gp ? RT.invoke(gp, tr, []) : null;
}

// ---------- chunk weights ----------
// The picks come from cached lists (_randomlyOrderedPrefabs, _weightedRandomizedPrefabs) that are built from the weights, so after
// the weights change the game's own BuildRandomlyOrderedPrefabList(SyboRandom) has to run. Subclasses (route chunk containers) included.
const C_CONT = "SYBO.Subway.Routes.WeightRandomizedPrefabContainter`2";
const C_RANDOM = "SYBO.Common.Utilities.SyboRandom";
function chunkContainers() {
const out = [];
if (!RT || !RT.ok) return out;
for (const c of RT.findAll(C_CONT)) {
try {
const lf = RT.fieldOf(c, "_weightedPrefabs"); if (!lf) continue;
const list = RT.read(c, lf); if (!list) continue;
const nf = RT.fieldOf(c, "<Name>k__BackingField");
const name = nf ? RT.readStr(RT.read(c, nf)) : null;
const entries = RT.listItems(list).filter((e) => RT.inHeap(e)).map((e) => {
const wf = RT.fieldOf(e, "Weight"), nm = RT.fieldOf(e, "_name");
return { addr: e, wf, name: nm ? (RT.readStr(RT.read(e, nm)) || "?") : "?" };
}).filter((e) => e.wf);
if (entries.length) out.push({ addr: c, name: name || "(unnamed)", entries });
} catch (e) { /* skip */ }
}
return out;
}
function rebuildContainers() {
if (!RT || !RT.ok) return 0;
const rnd = RT.find(C_RANDOM)[0];
if (!rnd) { dlog("no live SyboRandom yet, chunk lists will rebuild on their own"); return 0; }
let n = 0;
for (const c of RT.findAll(C_CONT)) {
try { const m = RT.findMethod(RT.rw(c), "BuildRandomlyOrderedPrefabList", 1); if (m) { RT.invoke(m, c, [rnd]); n++; } } catch (e) { /* container not ready */ }
}
return n;
}
const chunkRule = { mode: "first", text: "" };
defGroup("chunkrule", () => {
const out = [];
for (const c of chunkContainers()) {
if (c.entries.length < 2) continue;
let keep = c.entries[0];
if (chunkRule.mode === "match" && chunkRule.text) { const t = chunkRule.text.toLowerCase(); const hit = c.entries.find((e) => e.name.toLowerCase().indexOf(t) >= 0); if (!hit) continue; keep = hit; }
for (const e of c.entries) if (e !== keep) out.push([e.addr, e.wf, 0]);
}
return out;
}, rebuildContainers);
function chunkOnly(cont, entry) {
for (const e of cont.entries) if (e.addr !== entry.addr) ovSet("chunkpick", e.addr, e.wf, 0);
rebuildContainers();
}
function chunkRestore() { ovRelease("chunkpick"); setGroup("chunkrule", false); rebuildContainers(); say("chunk weights restored"); }

// ---------- pickups ----------
const NSP = "SYBO.Subway.Pickups.";
const P_DATA = NSP + "PickupData", P_SPOT = NSP + "PickupSpawnPoint", P_TYPE = NSP + "PickupType", P_MODE = NSP + "SpawnPointMode", P_MGR = NSP + "PickupManager", P_PICKER = NSP + "Pickers.PickerData", P_BASE = NSP + "Picker.Pickers.BasePicker";
const pk = { force: "JetPack" };
function pickupTypeValue(name) { const e = RT && RT.ok ? RT.enumOf(P_TYPE).find((x) => x.name === name) : null; return e ? e.value : 0; }
const forcedTag = new Map();
// the game's own forcing call: SetSpawnPointForced(type, difficulty, offsetY, ignoreZ, ignoreJetpackZ) sets the mode, the type and the "Original" copies
function forceSpot(obj, tv, modeVal) {
const fm = RT.fieldOf(obj, "__spawnPointMode"), ft = RT.fieldOf(obj, "__forceSpawnPickupType");
if (fm && ft && forcedTag.get(obj) === tv && RT.read(obj, fm) === modeVal && RT.read(obj, ft) === tv) return;
const m = RT.findMethod(RT.rw(obj), "SetSpawnPointForced", 5); if (!m) return;
const fd = RT.fieldOf(obj, "_spawnPointDifficulty");
try { RT.invoke(m, obj, [tv, fd ? RT.read(obj, fd) : 1, false, true, true]); forcedTag.set(obj, tv); } catch (e) { /* object not ready */ }
}
defGroup("force", () => {
const out = [], mode = RT.enumOf(P_MODE).find((x) => x.name === "WillForcePickupType"), val = pickupTypeValue(pk.force);
if (!mode || !val) return out;
for (const obj of RT.find(P_SPOT)) {
forceSpot(obj, val, mode.value);
const f1 = RT.fieldOf(obj, "__spawnPointMode"), f2 = RT.fieldOf(obj, "__forceSpawnPickupType");
if (f1 && f2) { out.push([obj, f1, mode.value]); out.push([obj, f2, val]); }
}
return out;
});
defGroup("nospace", () => { const out = []; eachField(P_DATA, "_spawnDistanceMinToPrevious", (o, f) => out.push([o, f, 0])); return out; });

// flood: every picker rolls every time with no spacing, the chosen PickupData is enabled and compatible with all spawn points, every spawn
// point is forced through SetSpawnPointForced, blocked ones are re-armed, and spawn points ahead of you get SpawnPickup called right away.
const flooded = new Set();
function floodHooks(on) {
if (on) { for (const [n, v] of [["get_ProbabilityToSpawn", 1.0], ["get_SpawnDistanceMinToPrevious", 0.0]]) { if (!HK.size || !HOOKS.list().some((r) => r.cls === "BasePicker" && r.name === n)) { try { HOOKS.constant(P_BASE, n, 0, v); } catch (e) { dlog("flood hook " + n + ": " + e.message); } } } }
else HOOKS.list().filter((r) => r.cls === "BasePicker").forEach((r) => HOOKS.off(r));
}
function floodSpawn(tv, mgr) {
if (!mgr) return;
const gd = RT.findMethod(RT.rw(mgr), "GetPickupDataForPickupType", 1); if (!gd) return;
const pdata = RT.invoke(gd, mgr, [tv]) >>> 0; if (!pdata) return;
const fa = RT.fieldOf(mgr, "_pickerData"); const arr = fa ? RT.arrayItems(RT.read(mgr, fa)) : [];
let picker = 0;
for (const p of arr) { const f = RT.fieldOf(p, "_pickerType"); if (f && RT.read(p, f) === 1) { picker = p; break; } }
if (!picker) picker = arr[0] || 0; if (!picker) return;
const me = RT.find("SYBO.Subway.Characters.Character")[0]; const p0 = me ? posOfObj(me) : null;
let budget = 24;
for (const sp of RT.find(P_SPOT)) {
if (budget <= 0) break;
try {
const fs = RT.fieldOf(sp, "__spawnPointState"); if (!fs) continue;
const st = RT.read(sp, fs);
if (st !== 0 && st !== 1) continue;
const pos = posOfObj(sp);
if (p0 && pos && (pos[2] < p0[2] + 2 || pos[2] > p0[2] + 260)) continue; // only the road ahead
if (st === 1) RT.write(sp, fs, 0);
const avail = RT.findMethod(RT.rw(sp), "IsAvailableForSpawning", 1), spawn = RT.findMethod(RT.rw(sp), "SpawnPickup", 2);
if (!spawn || (avail && !RT.invoke(avail, sp, [false]))) continue;
RT.invoke(spawn, sp, [pdata, picker]); budget--;
} catch (e) { /* spawn point not ready */ }
}
}
defGroup("flood", () => {
const out = [], tv = pickupTypeValue(pk.force), mode = RT.enumOf(P_MODE).find((x) => x.name === "WillForcePickupType");
if (!tv || !mode) return out;
for (const o of RT.find(P_PICKER)) {
try {
const fT = RT.fieldOf(o, "_pickupType"), fP = RT.fieldOf(o, "_probabilityToSpawn"), fD = RT.fieldOf(o, "_spawnDistanceMinToPrevious"), fK = RT.fieldOf(o, "_pickerType"), fE = RT.fieldOf(o, "_pickerEnabledState");
if (fP) out.push([o, fP, 1]);
if (fD) out.push([o, fD, 0]);
if (fT) out.push([o, fT, (RT.read(o, fT) | tv) | 0]);
if (fE && fK && RT.read(o, fK) === 1) out.push([o, fE, 0]);
} catch (e) {}
}
for (const o of RT.find(P_DATA)) {
try {
const fT = RT.fieldOf(o, "_pickupType"); if (!fT) continue;
const mine = RT.read(o, fT) === tv, w = RT.fieldOf(o, "_spawnWeight");
if (w) out.push([o, w, mine ? 1000 : 0]);
if (!mine) continue;
for (const [n, v] of [["_pickupEnabledState", 0], ["_spawnDistanceMinToPrevious", 0], ["_spawnPointDifficulty", 255], ["_spawnPointHeight", 255]]) { const f = RT.fieldOf(o, n); if (f) out.push([o, f, v]); }
} catch (e) {}
}
for (const o of RT.find(P_SPOT)) {
try {
forceSpot(o, tv, mode.value);
for (const [n, v] of [["__spawnPointMode", mode.value], ["_spawnPointModeOriginal", mode.value], ["__forceSpawnPickupType", tv], ["_forceSpawnPickupTypeOriginal", tv], ["__willIgnoreZPositionBeforeSpawn", true], ["_willIgnoreZPositionBeforeSpawnOriginal", true], ["_ignoreJetpackZ", true]]) { const f = RT.fieldOf(o, n); if (f) out.push([o, f, f.kind === "bool" ? !!v : v]); }
} catch (e) {}
}
const mgr = RT.find(P_MGR)[0];
if (mgr) { for (const n of ["_spawnDistanceMinToGameStart", "SpawnDistanceMinToCharacter"]) { const f = RT.fieldOf(mgr, n); if (f) out.push([mgr, f, 0]); } }
floodSpawn(tv, mgr);
return out;
}, () => floodHooks(groupOn("flood")));
function pickupRows() {
const rows = [];
if (!RT || !RT.ok) return rows;
const tn = RT.enumOf(P_TYPE);
for (const o of RT.find(P_DATA)) {
try {
const ft = RT.fieldOf(o, "_pickupType"), fw = RT.fieldOf(o, "_spawnWeight"), fd = RT.fieldOf(o, "_spawnDistanceMinToPrevious");
if (!ft || !fw) continue;
const tv = RT.read(o, ft), e = tn.find((x) => x.value === tv);
rows.push({ addr: o, name: e ? e.name : "type " + tv, fw, fd });
} catch (e) { /* skip */ }
}
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

// ---------- developer settings (the developers' own DebugSettings object, and its static setters) ----------
const DEVC = "SYBO.Subway.Utilities.DebugSettings";
const DEV = [
{ f: "_characterInvincible", title: "Character invincible", sub: "crashes cannot end the run", set: "set_CharacterInvincible" },
{ f: "_unlockedSceneCamera", title: "Free scene camera", sub: "unlocks the camera" },
{ f: "_dontUseIdles", title: "Skip idle animations", sub: "no waiting animations", set: "set_DontUseIdles" },
{ f: "_useDebugZDistanceTargetPosition", title: "Debug distance target", sub: "start the run far ahead", set: "set_UseDebugZDistanceTargetPosition" },
{ f: "_useQueuedEnvironmentKinds", title: "Use queued environments", sub: "force the world look queue", set: "set_UseQueuedEnvironmentKinds" }
];
DEV.forEach((d) => defGroup("dev" + d.f, () => { const out = []; eachField(DEVC, d.f, (o, f) => out.push([o, f, f.kind === "bool" ? true : 1])); return out; }, d.set ? () => { try { callStatic(DEVC, d.set, [groupOn("dev" + d.f)]); } catch (e) { dlog(d.set + ": " + e.message); } } : null));
defGroup("dev_active", () => { const out = []; eachField(DEVC, "_active", (o, f) => out.push([o, f, f.kind === "bool" ? true : (S.vals.devActive || 1)])); return out; });

// ---------- wallet: the game's own InventorySave.IncreaseCoins(int, string) / IncreaseKeys(int, string) ----------
const INV = "Data.Save.InventorySave";
function walletAdd(kind, n) {
const name = kind === "coins" ? "IncreaseCoins" : "IncreaseKeys";
try { callStatic(INV, name, [n, "ssmod"]); return; } catch (e) { dlog(name + " failed (" + e.message + "), using Set" + (kind === "coins" ? "Coins" : "Keys")); }
const cur = callStatic(INV, kind === "coins" ? "get_coins" : "get_keys", []) | 0;
callStatic(INV, kind === "coins" ? "SetCoins" : "SetKeys", [Math.max(0, Math.min(2000000000, cur + n))]);
}

// ---------- boot: connect automatically and keep the object list fresh ----------
let uiOpen = { explorer: false, spawn: false };
async function bootTick() {
const M = getModule();
if (!M || !M.HEAPU8 || !M.asm) { if (!RT) return; return; }
if (!RT) RT = makeRT(M, dlog);
if (!RT.connected) { await RT.connect(); return; }
const active = GROUPS.size && Array.from(GROUPS.values()).some((g) => g.on) || OV.size > 0;
const age = Date.now() - RT.lastScan;
const need = !RT.ok || age > (active || uiOpen.explorer || uiOpen.spawn ? 4000 : 15000);
if (need) await RT.refresh(false);
}
setInterval(() => { bootTick().catch((e) => dlog("boot: " + e)); }, 1000);

// ===================================================================================================
// CODE TAB ENGINE: a C# style invoker/patcher over the live IL2CPP runtime.
//   Class.Method(args)            static call (instance methods on a class use the first live object)
//   var o = find(Class)           first live object;  findAll(Class) lists them
//   o.Method(args)  o.field  o.field = v  o.Prop = v      real methods, real field offsets, properties via get_/set_
//   Class.staticField = v         static fields;  PickupType.JetPack  enum names
//   foreach (var o in Class) o.field = 5
//   hold o.field = v              keeps writing it, release undoes it
//   hook Class.Method(2) => expr  patch Class.Method => value | nop     unhook Class.Method | all    hooks
//   peek(addr) poke(addr, v) str(ptr) typeof(ptr) Vector3(1,2,3)
// ===================================================================================================
class Ptr { constructor(v) { this.v = v >>> 0; } }
const CSK = new Set(["var", "int", "float", "double", "bool", "string", "long", "uint", "object"]);
let csIdx = { n: -1, short: new Map() };
function csShort() {
const m = RT.meta; if (csIdx.n === m.T.length) return csIdx.short;
const sh = new Map();
for (let i = 0; i < m.T.length; i++) {
const full = m.name(i); const last = full.slice(full.lastIndexOf(".") + 1).replace(/`\d+$/, "");
if (!last || /[<>]/.test(last)) continue;
let l = sh.get(last); if (!l) sh.set(last, l = []); if (l.indexOf(full) < 0) l.push(full);
}
csIdx = { n: m.T.length, short: sh }; return sh;
}
function csClass(name) {
if (!RT || !RT.meta) return null;
if (RT.cls(name)) return name;
if (RT.cls(name + "`1")) return name + "`1";
const l = csShort().get(name.slice(name.lastIndexOf(".") + 1)); if (!l) return null;
const m = RT.meta, cand = l.filter((f) => !name.includes(".") || f.endsWith(name));
const game = cand.filter((f) => (RT.cls(f) || []).some((ti) => ti >= m.gameStart));
return (game[0] || cand[0]) || null;
}
function csSplit(s, sep) {
const out = []; let d = 0, q = false, cur = "";
for (let i = 0; i < s.length; i++) {
const c = s[i];
if (q) { cur += c; if (c === "\\") { cur += s[++i] || ""; } else if (c === '"') q = false; continue; }
if (c === '"') { q = true; cur += c; continue; }
if ("([{".indexOf(c) >= 0) d++; else if (")]}".indexOf(c) >= 0) d--;
if (c === sep && d === 0) { out.push(cur); cur = ""; } else cur += c;
}
out.push(cur); return out;
}
function csStatements(src) {
const lines = src.split("\n").map((l) => { let q = false; for (let i = 0; i < l.length; i++) { if (l[i] === '"' && l[i - 1] !== "\\") q = !q; if (!q && l[i] === "/" && l[i + 1] === "/") return l.slice(0, i); } return l; });
const out = [];
for (const line of lines) { let d = 0, q = false, cur = ""; for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"' && line[i - 1] !== "\\") q = !q; if (!q) { if ("([{".indexOf(c) >= 0) d++; else if (")]}".indexOf(c) >= 0) d--; if (c === ";" && d === 0) { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; } } cur += c; } if (cur.trim()) out.push(cur.trim()); }
return out;
}
const csVars = new Map();
const csArg = (v) => (v instanceof Ptr ? v.v : v);
function csPtrOrVal(v, retType) { return (retType && RT.isPtrType(retType) && retType !== "System.String" && typeof v === "number") ? new Ptr(v) : v; }
function csFmt(v) {
if (v === undefined) return "ok";
if (v instanceof Ptr) { if (!v.v) return "null"; const i = RT.inspect(v.v); return hex(v.v) + (i ? "  (" + i.name + ")" : ""); }
if (Array.isArray(v)) return "(" + v.map((x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : csFmt(x))).join(", ") + ")";
if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000);
if (typeof v === "string") return JSON.stringify(v);
return String(v);
}
function csEnumMember(full, name) { const l = RT.cls(full); if (!l || !RT.meta.isEnum(l[0])) return undefined; const e = RT.enumOf(full).find((x) => x.name === name); return e ? e.value : undefined; }
function csConv(m, args) {
return args.map((v, i) => {
v = csArg(v); const t = m.pars[i] && m.pars[i].type;
if (typeof v === "string" && t) { const l = RT.cls(t); if (l && RT.meta.isEnum(l[0])) { const e = RT.enumOf(t).find((x) => x.name === v); if (e) return e.value; } }
return v;
});
}
function csPick(cands, args) {
const ok = cands.filter((m) => m.pars.length === args.length); if (!ok.length) return null; if (ok.length === 1) return ok[0];
let best = null, bs = -1;
for (const m of ok) {
let s = 0;
m.pars.forEach((p, i) => { const v = csArg(args[i]), w = RT.wtype(p.type);
if (typeof v === "number") { if (Number.isInteger(v) && w === "i") s += 2; else if (!Number.isInteger(v) && (w === "f" || w === "d")) s += 2; else if (w === "f" || w === "d" || w === "i" || w === "j") s += 1; }
else if (typeof v === "boolean" && p.type === "System.Boolean") s += 2;
else if (typeof v === "string" && p.type === "System.String") s += 2;
else if (Array.isArray(v) && w === "S") s += 2; });
if (s > bs) { bs = s; best = m; }
}
return best;
}
function csCall(cands, thisPtr, args, what) {
const m = csPick(cands, args); if (!m) throw new Error("no " + what + " taking " + args.length + " argument(s)");
const r = RT.invokeF(m, m.static ? 0 : thisPtr, csConv(m, args));
return csPtrOrVal(r, m.ret);
}
function csFieldVal(obj, f) {
const v = RT.read(obj, f);
if (f.kind === "string") { const s = RT.readStr(v); return s === null ? new Ptr(v) : s; }
if (["object", "array", "generic", "T", "ptr"].indexOf(f.kind) >= 0) return new Ptr(v);
return v;
}
function csSetField(obj, f, v) {
v = csArg(v);
if (typeof v === "string") { if (f.kind === "string") v = RT.newString(v); else if (f.enumTi >= 0) { const e = RT.meta.enumMembers(f.enumTi).find((x) => x.name === v); if (!e) throw new Error("no enum value " + v); v = e.value; } else throw new Error("cannot store a string in " + f.tn); }
RT.write(obj, f, v);
}
// evaluate a dotted path: head, then members
function csSegs(s) {
return csSplit(s, ".").map((t) => { t = t.trim(); const i = t.indexOf("("); if (i < 0) return { name: t, args: null }; if (!t.endsWith(")")) throw new Error("bad call syntax: " + t); const inner = t.slice(i + 1, -1).trim(); return { name: t.slice(0, i).trim(), args: inner ? csSplit(inner, ",").map((a) => csEval(a)) : [] }; });
}
function csHead(segs) {
const first = segs[0];
if (first.args === null && csVars.has(first.name)) return { cur: csVars.get(first.name), i: 1 };
for (let n = segs.length; n >= 1; n--) {
if (segs.slice(0, n).some((x) => x.args !== null && x !== segs[n - 1])) continue;
if (segs[n - 1].args !== null) continue;
const full = csClass(segs.slice(0, n).map((x) => x.name).join("."));
if (full) return { cur: { cls: full }, i: n };
}
throw new Error("unknown name " + first.name);
}
function csMember(cur, seg, setVal, hasSet) {
if (cur && cur.cls) { // static context
const full = cur.cls;
if (seg.args === null) { const ev = csEnumMember(full, seg.name); if (ev !== undefined) return ev; }
const k = RT.klassByName(full);
if (!k) throw new Error(full + " is not indexed yet");
if (seg.args === null) {
const f = RT.klassFields(k).find((x) => x.name === seg.name && x.isStatic);
if (f) { if (hasSet) { csSetField(0, f, setVal); return setVal; } return csFieldVal(0, f); }
}
const chain = RT.methodsChain(k);
const name = seg.args === null ? (hasSet ? "set_" + seg.name : "get_" + seg.name) : seg.name, args = seg.args === null ? (hasSet ? [setVal] : []) : seg.args;
let cands = chain.filter((m) => m.name === name && m.static);
if (cands.length && csPick(cands, args)) { const r = csCall(cands, 0, args, full + "." + name); return hasSet ? setVal : r; }
cands = chain.filter((m) => m.name === name && !m.static);
if (cands.length) { const o = RT.findAll(full)[0]; if (!o) throw new Error("no live " + full + " object for the instance method " + name); const r = csCall(cands, o, args, full + "." + name); return hasSet ? setVal : r; }
throw new Error("no member " + full + "." + seg.name);
}
const obj = csArg(cur);
if (typeof obj !== "number" || !obj) throw new Error("null reference before ." + seg.name);
const k = RT.rw(obj);
if (seg.args === null) {
const f = RT.fieldOf(obj, seg.name);
if (f) { if (hasSet) { csSetField(obj, f, setVal); return setVal; } return csFieldVal(obj, f); }
}
const chain = RT.methodsChain(k);
const name = seg.args === null ? (hasSet ? "set_" + seg.name : "get_" + seg.name) : seg.name, args = seg.args === null ? (hasSet ? [setVal] : []) : seg.args;
const cands = chain.filter((m) => m.name === name);
if (!cands.length) throw new Error("no member " + seg.name + " on " + RT.klassName(k));
const r = csCall(cands, obj, args, name); return hasSet ? setVal : r;
}
function csPath(s, setVal, hasSet) {
const segs = csSegs(s); const h = csHead(segs); let cur = h.cur;
for (let i = h.i; i < segs.length; i++) cur = csMember(cur, segs[i], setVal, hasSet && i === segs.length - 1);
if (segs.length === h.i && hasSet) throw new Error("cannot assign to a class or variable here");
return cur && cur.cls ? "class " + cur.cls : cur;
}
const CSB = {
find: (a) => { const c = csClass(String(csArg(a[0]))); if (!c) throw new Error("unknown class " + a[0]); const o = RT.findAll(c)[0]; return new Ptr(o || 0); },
findAll: (a) => { const c = csClass(String(csArg(a[0]))); if (!c) throw new Error("unknown class " + a[0]); return RT.findAll(c).map((o) => new Ptr(o)); },
peek: (a) => RT.M.HEAPU32[csArg(a[0]) >>> 2], peekf: (a) => RT.M.HEAPF32[csArg(a[0]) >>> 2],
poke: (a) => { RT.M.HEAPU32[csArg(a[0]) >>> 2] = csArg(a[1]) >>> 0; }, pokef: (a) => { RT.M.HEAPF32[csArg(a[0]) >>> 2] = +csArg(a[1]); },
str: (a) => { const s = RT.readStr(csArg(a[0]) >>> 0); return s === null ? "(not a string)" : s; },
"typeof": (a) => { const i = RT.inspect(csArg(a[0]) >>> 0); return i ? i.parents.join(" < ") : "(not an object)"; },
Vector3: (a) => a.map(csArg), Vector2: (a) => a.map(csArg), Quaternion: (a) => a.map(csArg), Color: (a) => a.map(csArg), Vector4: (a) => a.map(csArg)
};
function csEval(s) {
s = s.trim();
if (!s) throw new Error("empty expression");
if (/^"(?:[^"\\]|\\.)*"$/.test(s)) return JSON.parse(s);
if (/^-?\d+(\.\d+)?[fFdD]?$/.test(s)) return parseFloat(s);
if (/^-?0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
if (s === "true") return true; if (s === "false") return false; if (s === "null") return new Ptr(0);
if (s[0] === "[" && s.endsWith("]")) return csSplit(s.slice(1, -1), ",").map((x) => csEval(x));
if (/^new\s+\w+\s*\(/.test(s)) s = s.replace(/^new\s+/, "");
const bi = /^(\w+)\s*\((.*)\)$/s.exec(s);
if (bi && (bi[1] === "find" || bi[1] === "findAll") && !csVars.has(bi[1])) return CSB[bi[1]]([bi[2].trim().replace(/^"|"$/g, "")]);
if (bi && CSB[bi[1]] && !csVars.has(bi[1])) { const inner = bi[2].trim(); return CSB[bi[1]](inner ? csSplit(inner, ",").map((x) => csEval(x)) : []); }
if (/^[\d\s+\-*/().]+$/.test(s)) return Function("return (" + s + ")")();
if (/^[A-Za-z_]\w*$/.test(s) && csVars.has(s)) return csVars.get(s);
return csPath(s);
}
function csTarget(s) { // "Class.Method" or "Class.Method(2)" -> found method info
const m = /^(.*?)(?:\((\d*)\))?$/.exec(s.trim()); const segs = m[1].split(".").map((x) => x.trim()); const name = segs.pop(); const cls = csClass(segs.join("."));
if (!cls) throw new Error("unknown class " + segs.join("."));
const k = RT.klassByName(cls); let kk = k, g = 0; const have = new Set();
while (kk && RT.inHeap(kk) && g++ < 14) { RT.methodsOfKlass(kk).forEach((x) => { if (x.name === name) have.add(x.pars.length); }); kk = RT.L.parent ? RT.rw(kk + RT.L.parent) : 0; }
if (!have.size) throw new Error("no method " + cls + "." + name);
let argc = m[2] !== undefined && m[2] !== "" ? +m[2] : (have.size === 1 ? Array.from(have)[0] : -1);
if (argc < 0) throw new Error(name + " has overloads with " + Array.from(have).join("/") + " arguments, write " + name + "(n)");
return { f: findChain(cls, name, argc), label: cls.split(".").pop() + "." + name };
}
function csExec(st, out) {
let m;
if ((m = /^using\s+/.exec(st))) return undefined;
if (st === "help") return "Class.Method(args) | var o = find(Class) | o.field = v | foreach (var o in Class) stmt | hold o.f = v | release | hook C.M(n) => expr | patch C.M => value|nop | unhook C.M|all | hooks | peek/poke/str/typeof";
if (st === "release") { ovRelease("code"); return "released"; }
if (st === "hooks") { const l = HOOKS.list(); return l.length ? l.map((r) => r.label + "  " + r.hits + " hits" + (r.err ? "  ERR " + r.err : "")).join("\n") : "no hooks"; }
if ((m = /^unhook\s+(.+)$/.exec(st))) { if (m[1].trim() === "all") { HOOKS.off(); return "all hooks removed"; } const t = csTarget(m[1]); const r = HOOKS.list().find((x) => x.fn === t.f.m.fn); if (!r) return "not hooked"; HOOKS.off(r); return "unhooked " + t.label; }
if ((m = /^patch\s+(.+?)\s*(=>|\s)\s*(nop|.+)$/s.exec(st))) {
const t = csTarget(m[1]); let rec;
if (m[3].trim() === "nop") rec = hookFound(t.f, () => 0, t.label + " (nop)");
else { const v = csArg(csEval(m[3])); rec = hookFound(t.f, () => v, t.label + " => " + csFmt(v)); }
return "patched " + t.label + " (sig " + rec.sig + "), watch the hit counter with: hooks";
}
if ((m = /^hook\s+(.+?)\s*=>\s*(.+)$/s.exec(st))) {
const t = csTarget(m[1]); const fn = new Function("orig", "args", "return (" + m[2] + ");");
const rec = hookFound(t.f, (a, orig) => fn(function () { return orig.apply(null, a); }, a.slice(0, -1)), t.label);
return "hooked " + t.label + " (sig " + rec.sig + "), watch the hit counter with: hooks";
}
if ((m = /^hold\s+(.+?)\s*=\s*(.+)$/s.exec(st))) {
const lhs = m[1].trim(), i = lhs.lastIndexOf("."); if (i < 0) throw new Error("hold needs obj.field");
const o = csArg(csEval(lhs.slice(0, i))); const f = RT.fieldOf(o, lhs.slice(i + 1)); if (!f) throw new Error("no field " + lhs.slice(i + 1));
ovSet("code", o, f, csArg(csEval(m[2]))); return "holding " + lhs;
}
if ((m = /^foreach\s*\(?\s*(?:var\s+)?(\w+)\s+in\s+([\w.`]+)\s*\)?\s*(.+)$/s.exec(st))) {
const c = csClass(m[2]); if (!c) throw new Error("unknown class " + m[2]);
const body = m[3].trim().replace(/^\{/, "").replace(/\}$/, ""); const objs = RT.findAll(c).slice(0, 300); let n = 0;
for (const o of objs) { csVars.set(m[1], new Ptr(o)); for (const b of csStatements(body)) csExec(b, out); n++; }
csVars.delete(m[1]); return n + " object(s)";
}
if ((m = /^(?:(?:var|int|float|double|bool|string|long|uint|object)\s+)?([A-Za-z_]\w*)\s*=(?![=>])\s*(.+)$/s.exec(st)) && !/^[A-Za-z_]\w*\./.test(st)) {
const v = csEval(m[2]); csVars.set(m[1], v); return m[1] + " = " + csFmt(v);
}
if ((m = /^(.+?[A-Za-z_\)\]])\s*=(?![=>])\s*(.+)$/s.exec(st))) {
const v = csEval(m[2]); csPath(m[1].trim(), v, true); return m[1].trim() + " = " + csFmt(v);
}
if ((m = /^print\s+(.+)$/s.exec(st))) return csFmt(csEval(m[1]));
return csFmt(csEval(st));
}
function csRun(src) {
if (!RT || !RT.ok) return "not connected yet, wait for the green dot";
const lines = [];
for (const st of csStatements(src)) {
try { const r = csExec(st, (x) => lines.push(x)); lines.push(typeof r === "string" && !/^"/.test(r) ? r : r === undefined ? "ok" : String(r)); }
catch (e) { lines.push("error in `" + st.slice(0, 48) + "`: " + (e && e.message || e)); }
}
return lines.join("\n");
}
// JS (the old console) is still understood: anything using ss., =>, function or starting with //js
const looksJS = (code) => /(^|\n)\s*\/\/\s*js\b|\bss\.|\bfunction\b|\bconst\s|\blet\s|=>\s*\{/.test(code) && !/^\s*(hook|patch)\s/m.test(code);

// ===================================================================================================
// UI: gold glass panel in its own iframe (so the game never sees your key presses)
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
dot: '<circle cx="12" cy="12" r="5" fill="currentColor"/>'
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
canvas.map{width:100%;height:230px;border-radius:14px;background:rgba(0,0,0,.3)}
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

// ----- header, status, tabs -----
const statDot = el("div", { className: "d" }), statTxt = el("span", { textContent: "starting..." });
const stat = el("div", { className: "stat" }, [statDot, statTxt, ibtn("refresh", () => { if (RT && RT.ok) RT.refresh(false); say("refreshing objects"); }, "refresh the object list")]);
const minBtn = el("button", { className: "hb", title: "minimize" }, [icon("min", 14)]);
const head = el("div", { className: "h" }, [el("div", { className: "logo" }, [icon("spawn", 18)]), el("div", { className: "ttl1" }, [D.createTextNode("Subway Surfers"), el("span", { className: "pro", textContent: "PRO" }), el("small", { textContent: "mod menu v2" })]), el("div", { className: "sp" }), minBtn]);

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

// ===== DEVELOPER =====
const devActiveSel = el("div", { className: "note" });
const incC = { coins: 1000000, keys: 1000 };
const devCard = card("Developer settings", [
el("div", { className: "note", textContent: "These are the game's own debug switches (SYBO.Subway.Utilities.DebugSettings). If a switch does nothing, turn on Developer mode first." }),
R_(lbl("Developer mode", "marks debugging as allowed"), groupSw("dev_active")),
devActiveSel
].concat(DEV.map((d) => R_(lbl(d.title, d.sub), groupSw("dev" + d.f)))), "dev");
const walletCard = card("Wallet", [
R_(lbl("Add coins"), RR(num(() => incC.coins, (v) => { incC.coins = Math.round(v); }, true), btn("Add", () => { try { walletAdd("coins", incC.coins); say("added coins"); } catch (e) { say(String(e.message || e)); } }, "", "plus"))),
R_(lbl("Add keys"), RR(num(() => incC.keys, (v) => { incC.keys = Math.round(v); }, true), btn("Add", () => { try { walletAdd("keys", incC.keys); say("added keys"); } catch (e) { say(String(e.message || e)); } }, "", "plus"))),
el("div", { className: "note", textContent: "Calls the game's own InventorySave methods." })
], "dev");
const pageDev = el("div", { className: "pg hide" }, [devCard, walletCard]);

// ===== EXPLORER =====
const ex = { view: "objects", cls: null, objs: [], obj: null, stack: [], locks: new Map(), mapCls: "SYBO.Subway.Level.MovingTrain" };
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
}
function exOpen(addr, push) { if (push && ex.obj) ex.stack.push(ex.obj); ex.obj = addr; exRender(); }
function getterRow(m, a) {
const out = el("div", { className: "nm", textContent: "tap get", style: "text-align:right;flex:none;max-width:130px" });
const row = el("div", { className: "tr" }, [el("div", { className: "nm", textContent: m.name.replace("get_", ""), title: m.owner + "." + m.name }), el("div", { className: "ty", textContent: m.ret.replace("System.", "") }), out, ibtn("play", () => { try { const r = RT.call(m, a, []); out.textContent = RT.fmtRet(m, r); if (m.ret !== "System.Void" && /^0x/.test(out.textContent)) { out.className = "nm link"; out.onclick = () => exOpen(parseInt(out.textContent, 16) >>> 0, true); } } catch (e) { out.textContent = "err: " + (e.message || e); } }, "read")]);
return row;
}
// text box -> argument, by the parameter's real type (strings, vectors, enums by name, 64-bit)
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
const editable = ["float", "double", "int", "uint", "short", "ushort", "byte", "sbyte", "bool", "long", "ulong", "char"].indexOf(f.kind) >= 0;
const isRef = ["object", "array", "generic", "T", "ptr"].indexOf(f.kind) >= 0;
const nm = el("div", { className: "nm", textContent: (f.isStatic ? "static " : "") + f.name, title: f.owner + "." + f.name });
const ty = el("div", { className: "ty", textContent: f.tn, title: f.tn });
let val;
if (editable) {
val = el("input", { type: "text", spellcheck: false, value: f.enumTi >= 0 ? String(RT.read(a, f)) : RT.show(a, f) });
val.title = f.enumTi >= 0 ? RT.show(a, f) : "";
val.onchange = () => {
try {
let v = val.value.trim();
if (f.kind === "bool") v = v === "true" || v === "1"; else { v = Number(v); if (!isFinite(v)) { val.value = RT.show(a, f); return; } }
RT.write(a, f, v); if (ex.locks.has(key)) ex.locks.get(key).v = v;
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

// map: flat top-down view of live objects, positions read through Unity's own Transform getters
const mapCanvas = el("canvas", { className: "map", width: 700, height: 460 });
const mapIn = el("input", { type: "text", className: "txt", placeholder: "class to plot, e.g. SYBO.Subway.Level.MovingTrain", spellcheck: false, value: ex.mapCls });
const mapInfo = el("div", { className: "note" });
let mapTimer = 0;
function mapDraw() {
const c = mapCanvas.getContext("2d");
c.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
if (!RT || !RT.ok) { mapInfo.textContent = "waiting for the game..."; return; }
try {
const me = RT.find("SYBO.Subway.Characters.Character")[0];
const p0 = me ? posOfObj(me) : [0, 0, 0];
const list = RT.find(mapIn.value.trim()).slice(0, 300);
const pts = [];
for (const o of list) { try { const p = posOfObj(o); if (p) pts.push(p); } catch (e) {} }
const W_ = mapCanvas.width, H_ = mapCanvas.height, sc = 6;
c.strokeStyle = "rgba(255,255,255,.15)"; c.lineWidth = 1;
for (let x = -4; x <= 4; x += 2) { c.beginPath(); c.moveTo(W_ / 2 + x * sc * 4, 0); c.lineTo(W_ / 2 + x * sc * 4, H_); c.stroke(); }
c.fillStyle = THEMES[S.theme].ac;
pts.forEach((p) => { const x = W_ / 2 + (p[0] - p0[0]) * sc * 2, y = H_ - 40 - (p[2] - p0[2]) * sc; if (x > -10 && x < W_ + 10 && y > -10 && y < H_ + 10) c.fillRect(x - 4, y - 4, 8, 8); });
c.fillStyle = "#fff"; c.beginPath(); c.arc(W_ / 2, H_ - 40, 9, 0, 7); c.fill();
mapInfo.textContent = list.length + " objects, " + pts.length + " positions read" + (me ? "" : " (player not found)");
} catch (e) { mapInfo.textContent = "map: " + (e.message || e); }
}
const mapCard = card("Flat map", [
mapIn, mapCanvas, mapInfo,
el("div", { className: "btns" }, [btn("Plot", () => { ex.mapCls = mapIn.value.trim(); mapDraw(); }, "hot", "map"), btn("Live", function () { if (mapTimer) { clearInterval(mapTimer); mapTimer = 0; this.classList.remove("hot"); } else { mapTimer = setInterval(mapDraw, 500); this.classList.add("hot"); } }, "", "play")]),
el("div", { className: "note", textContent: "A top-down view of one class around the player (the white dot). Unity's real 3D scene cannot be drawn from outside the game, so this plots positions only." })
], "map");
const subBar = el("div", { className: "sub" });
const pageEx = el("div", { className: "pg hide" }, [subBar, exObjCard, exInspCard, mapCard]);
function setSub(v) { ex.view = v; exObjCard.style.display = v === "objects" ? "" : "none"; exInspCard.style.display = v === "objects" ? "" : "none"; mapCard.style.display = v === "map" ? "" : "none"; Array.from(subBar.children).forEach((b) => b.classList.toggle("on", b.__v === v)); }
[["objects", "Objects", "list"], ["map", "Map", "map"]].forEach(([v, t, ic]) => { const b = btn(t, () => setSub(v), "", ic); b.__v = v; subBar.appendChild(b); });

// ===== CONSOLE: C# style invoker/patcher (JavaScript with ss.* still works) =====
const conIn = el("textarea", { className: "txt", spellcheck: false, placeholder: "// C# style, runs against the live game\nvar gs = find(GameStats)\ngs.TriggerPowerup(UpgradeType.jetpack, false)\nData.Save.InventorySave.IncreaseCoins(5000, \"mod\")\nhook SYBO.Subway.Pickups.Picker.Pickers.BasePicker.get_ProbabilityToSpawn => 1.0\nhooks" });
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
hook: HOOKS, cs: (src) => csRun(src),
rescan: () => RT.refresh(true), u32: (a) => RT.M.HEAPU32[a >>> 2], f32: (a) => RT.M.HEAPF32[a >>> 2],
setU32: (a, v) => { RT.M.HEAPU32[a >>> 2] = v >>> 0; }, setF32: (a, v) => { RT.M.HEAPF32[a >>> 2] = v; },
Module: () => getModule(), say
};
window.ss = api;
const runJS = (code) => { try { return (0, eval)("(function(ss){ return (" + code + "\n)})")(api); } catch (e1) { return (0, eval)("(function(ss){" + code + "\n})")(api); } };
const runCode = (code) => (looksJS(code) ? runJS(code) : csRun(code));
function drawMacros() {
macroBox.innerHTML = "";
S.macros.forEach((m, i) => { const b = btn(m.name, () => { try { const r = runCode(m.code); say(typeof r === "string" ? r.split("\n")[0].slice(0, 70) : m.name + " ran"); } catch (e) { say(m.name + ": " + (e.message || e)); } }, "", "play"); b.oncontextmenu = (e) => { e.preventDefault(); S.macros.splice(i, 1); persist(); drawMacros(); }; macroBox.appendChild(b); });
}
if (!S.seeded) {
S.seeded = true;
S.macros = [
{ name: "Jetpack", code: "SYBO.Subway.Game.PickupJetpack()" },
{ name: "Pogo stick", code: "SYBO.Subway.Game.PickupPogostick()" },
{ name: "Magnet", code: "GameStats.TriggerPowerup(UpgradeType.coinmagnet, false)" },
{ name: "Sneakers", code: "GameStats.TriggerPowerup(UpgradeType.supersneakers, false)" },
{ name: "2x score", code: "GameStats.TriggerPowerup(UpgradeType.doubleMultiplier, false)" },
{ name: "+1M coins", code: "Data.Save.InventorySave.IncreaseCoins(1000000, \"mod\")" }
].concat(S.macros);
persist();
}
const pageCon = el("div", { className: "pg hide" }, [
card("Custom code", [conIn, el("div", { className: "btns" }, [btn("Run", () => { try { const v = runCode(conIn.value); conOut.textContent = v === undefined ? "ok" : (typeof v === "object" ? JSON.stringify(v, null, 1) : String(v)); } catch (e) { conOut.textContent = "error: " + (e.message || e); } }, "hot", "play"), btn("Clear", () => { conIn.value = ""; conOut.textContent = "(output)"; }, "", "trash")]), conOut,
el("div", { className: "note", textContent: "C# style on the live game: Class.Method(args), find(Class), obj.field = v, hold, hook / patch / unhook, hooks. Type help. JavaScript with ss.* still works too." })], "console"),
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
R_(lbl("Reset panel size"), btn("Reset", () => { S.w = 390; S.h = 600; S.zoom = 100; applyLook(); persist(); })),
el("div", { className: "note", textContent: "Drag the header to move the panel and the gold corner to resize it. Press H in the game to hide or show it." })
], "prefs"),
card("Log", [logOut, el("div", { className: "btns" }, [btn("Copy log", () => copyText(LOG.join("\n")), "", "copy")])], "list")
]);

const TABS = [["Spawn", "spawn", pageSpawn], ["Dev", "dev", pageDev], ["Explore", "explorer", pageEx], ["Code", "console", pageCon], ["Save", "save", pageSave], ["Prefs", "prefs", pagePrefs]];
const pill = el("div", { className: "pill" }); pill.style.width = "calc((100% - 6px) / " + TABS.length + ")";
const tabEls = TABS.map(([name, ic], i) => { const t = el("div", { className: "tab" }, [icon(ic, 16), D.createTextNode(name)]); t.onclick = () => setTab(i); return t; });
const setTab = (i) => {
S.tab = i; persist();
uiOpen.explorer = i === 2; uiOpen.spawn = i === 0;
pill.style.transform = "translateX(" + (i * 100) + "%)";
tabEls.forEach((t, j) => t.classList.toggle("on", j === i));
TABS.forEach(([, , p], j) => p.classList.toggle("hide", j !== i));
if (i === 0) { chunkRender(); pkRender(); }
if (i === 2) { exClasses(); exRender(); }
};
BODY = el("div", { className: "b" }, TABS.map((t) => t[2]));
const rs = el("div", { className: "rs", title: "drag to resize" });
PANEL = el("div", { className: "p" }, [head, stat, el("div", { className: "tabs" }, [pill].concat(tabEls)), BODY, rs]);
doc.body.appendChild(PANEL);
bodyEls = { statDot, statTxt, stat, saveInfo, logOut, devActiveSel };

// ----- toasts live in the main page (the iframe is too small to show them) -----
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

// ----- drag, resize, minimize (screen coordinates, so the moving iframe cannot disturb itself) -----
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
rs.addEventListener("dblclick", () => { S.w = 390; S.h = 600; place(); persist(); });
addEventListener("keydown", (e) => {
const t = e.target;
if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
if ((e.key === "h" || e.key === "H") && !e.ctrlKey && !e.metaKey && !e.altKey) FR.style.display = FR.style.display === "none" ? "" : "none";
});

// ----- periodic refresh of the panel -----
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
if (S.tab === 5) logOut.textContent = LOG.slice(-60).join("\n");
if (S.tab === 1 && RT && RT.ok) {
const f = RT.find(DEVC)[0];
devActiveSel.textContent = f ? "DebugSettings found (" + hex(f) + ")" : "DebugSettings object not found yet (it is created when a run or the menu loads)";
}
if (S.tab === 2) exRows.forEach(([inp, f, a]) => { if (D.activeElement === inp) return; try { const s = f.enumTi >= 0 ? String(RT.read(a, f)) : RT.show(a, f); if (inp.value !== s) inp.value = s; } catch (e) {} });
}, 600);
setInterval(() => { ex.locks.forEach((L) => { try { RT.write(L.a, L.f, L.v); } catch (e) {} }); }, 100);

applyLook(); drawMacros(); setSub("objects");
setTab(S.tab >= 0 && S.tab < TABS.length ? S.tab : 0);
dlog("Subway Surfers mod v2 ready");
}

if (document.body) buildUI(); else addEventListener("DOMContentLoaded", buildUI);
window.__ssRT = () => RT;
dlog("Subway Surfers mod v2 loaded, save fix active, connecting when the game starts");
})();