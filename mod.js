/* Subway Surfers (Unity WebGL 2019.4, IL2CPP) mod, v3 - Feature & C# Injection Upgrade
 * Auto-connects to the running game, no scans needed.
 *  - Save fix: the game's own save is switched on and mirrored to a backup copy.
 *  - Spawn control: chunk weights, pickup weights, force any powerup at every spawn point.
 *  - Developer: the developers' own DebugSettings (invincible, free camera, ...).
 *  - Explorer: UnityExplorer-style objects, every variable live, getters, method calls, flat map.
 *  - Code / C# Injection: Runtime method hooking, IL2CPP native detour/interception, and script macros.
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
// SAVE SYSTEM
// ===================================================================================================
const SAVE = { engine: "waiting", lastBackup: 0, files: 0, restored: 0, err: "" };
const MIRROR = "ssmod_save_mirror_v3";
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
if (n) dlog("restored " + n + " save files from backup");
return n;
}
function engineTick() {
const M = getModule();
if (!M) return;
if (!M.indexedDB) { M.indexedDB = window.indexedDB; dlog("set Module.indexedDB"); }
SAVE.engine = M.indexedDB ? "on" : "OFF";
try { if (M.asmLibraryArg && M.asmLibraryArg._JS_FileSystem_Sync) M.asmLibraryArg._JS_FileSystem_Sync(); } catch (e) {}
}
saveRestore(false);
setInterval(engineTick, 1500);
setInterval(() => { if (getModule()) saveBackup(); }, 6000);
addEventListener("pagehide", engineTick);
document.addEventListener("visibilitychange", () => { if (document.hidden) { engineTick(); saveBackup(); } });

// ===================================================================================================
// RUNTIME: IL2CPP Metadata & Advanced Hooking / C# Injection Subsystem
// <RT>
function makeRT(M, log) {
const R = { M, ok: false, status: "idle", L: {}, meta: null, klassOf: new Map(), kinv: new Map(), objs: new Map(), lastScan: 0, cache: new Map(), enums: new Map(), mcache: new Map(), hooks: new Map(), cycles: 0 };
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
if (dv.getInt32(4, true) !== 24) throw new Error("metadata version " + dv.getInt32(4, true));
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
}
const klassOf = new Map(), kinv = new Map();
for (const [k, ti] of cand) {
if (R.L.td >= 0 && rw(k + R.L.td) !== m.tdAddr(ti)) continue;
if (!klassOf.has(ti)) klassOf.set(ti, []);
klassOf.get(ti).push(k); kinv.set(k, ti);
}
R.klassOf = klassOf; R.kinv = kinv;
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

// C# Method Hooking & Injection Engine
R.methodsOfKlass = (k) => {
const hit = R.mcache.get(k); if (hit) return hit;
const L = R.L; if (!L.methods) return [];
const ti = R.typedefOfKlass(k); if (ti < 0) return [];
const md = R.meta.methodsOf(ti), mp = rw(k + L.methods), out = [];
if (!mp) return out;
for (let j = 0; j < md.length; j++) {
const mi = rw(mp + j * 4);
if (!inHeap(mi)) continue;
out.push({ name: md[j].name, mi, fn: rw(mi), static: !!(md[j].flags & 0x10), pars: md[j].pars.map((p) => ({ name: p.name, type: R.meta.tname(p.typeIdx) || "?" })), ret: R.meta.tname(md[j].ret) || "?", owner: R.klassName(k) });
}
if (out.length) R.mcache.set(k, out);
return out;
};
R.methodsChain = (k) => { const out = []; let kk = k, g = 0; while (kk && inHeap(kk) && g++ < 14) { for (const m of R.methodsOfKlass(kk)) out.push(m); kk = R.L.parent ? rw(kk + R.L.parent) : 0; } return out; };
R.findMethod = (k, name, argc) => R.methodsChain(k).find((m) => m.name === name && m.pars.length === argc) || null;

R.hookMethod = (className, methodName, argc, interceptorFn) => {
const l = R.cls(className);
if (!l || !l.length) throw new Error("Class not found: " + className);
const k = (R.klassOf.get(l[0]) || [])[0];
if (!k) throw new Error("Runtime class instance not found for: " + className);
const m = R.findMethod(k, methodName, argc);
if (!m) throw new Error("Method not found: " + methodName + " with " + argc + " args");

const origFn = m.fn;
const hookKey = className + "." + methodName + ":" + argc;
R.hooks.set(hookKey, { m, origFn, interceptorFn });
// Overwrite the native function pointer in the method info struct
const u32 = U32();
u32[m.mi >>> 2] = M.addFunction(function(...args) {
try {
return interceptorFn(function(actualArgs) {
// Call original function wrapper
return M.dynCall_i ? M.dynCall_i(origFn, ...actualArgs) : 0;
}, ...args);
} catch (err) {
dlog("Hook error in " + methodName + ": " + err.message);
return 0;
}, "i", []);
return true;
};

const SIG = (t) => { if (!t) return "i"; if (t === "System.Single") return "f"; if (t === "System.Double") return "d"; if (t === "System.Int64" || t === "System.UInt64") return "j"; if (t === "System.Void") return "v"; return "i"; };
const STRUCT = { "UnityEngine.Vector3": 3, "UnityEngine.Vector2": 2, "UnityEngine.Quaternion": 4, "UnityEngine.Color": 4 };
R.call = (m, thisPtr, args) => {
args = args || [];
if (m.pars.length !== args.length) throw new Error(m.name + " needs " + m.pars.length + " argument(s)");
const sret = STRUCT[m.ret] || 0;
let sig = sret ? "v" : SIG(m.ret);
if (sig === "j") throw new Error("64-bit return values not supported");
const a = [];
let buf = 0;
if (sret) { buf = M._malloc(sret * 4 + 16); sig += "i"; a.push(buf); }
if (!m.static) { sig += "i"; a.push(thisPtr); }
args.forEach((v, i) => { const t = m.pars[i].type, s = SIG(t); if (s === "j" || s === "v") throw new Error("64-bit arguments not supported"); sig += s; a.push(s === "i" ? (v === true ? 1 : v === false ? 0 : v | 0) : +v); });
sig += "i"; a.push(m.mi);
const f = M["dynCall_" + sig];
if (!f) { if (buf) M._free(buf); throw new Error("no dynCall_" + sig); }
try {
const r = f.apply(null, [m.fn].concat(a));
if (sret) { const out = []; for (let i = 0; i < sret; i++) out.push(M.HEAPF32[(buf >> 2) + i]); return out; }
return r;
} finally { if (buf) M._free(buf); }
};
R.fmtRet = (m, v) => {
if (Array.isArray(v)) return "(" + v.map((x) => Math.round(x * 1000) / 1000).join(", ") + ")";
if (m.ret === "System.Void") return "ok";
if (m.ret === "System.Boolean") return String(!!v);
if (m.ret === "System.String") { const s = R.readStr(v >>> 0); return s === null ? hex(v) : JSON.stringify(s); }
if (m.ret === "System.Single" || m.ret === "System.Double") return String(Math.round(v * 10000) / 10000);
if (m.ret === "System.Int32" || m.ret === "System.UInt32" || m.ret === "System.Int16" || m.ret === "System.Byte") return String(v);
return v ? hex(v) : "null";
};

R.refresh = async (full) => {
if (R.refreshing) return;
R.refreshing = true;
try {
if (full || R.cycles % 5 === 0 || !R.kinv.size) await R.scanClasses();
if (!R.ok && !R.calibrate()) { R.status = "waiting for load (" + R.kinv.size + " classes)"; return; }
await R.scanObjects();
R.status = "connected";
R.cycles++;
} catch (e) { R.status = "error: " + e.message; log("refresh failed: " + e.message); }
finally { R.refreshing = false; }
};
R.connect = async () => {
try {
R.status = "locating metadata";
await yieldNow();
const b = R.findMeta();
if (b < 0) { R.status = "waiting for metadata"; return false; }
R.meta = R.parseMeta(b);
R.connected = true;
return true;
} catch (e) { R.status = "failed: " + e.message; return false; }
};
R.cls = (full) => { const l = R.meta && R.meta.byName.get(full); return l || null; };
R.find = (full) => { const l = R.cls(full); if (!l) return []; let out = []; for (const ti of l) out = out.concat(R.objs.get(ti) || []); return out; };
R.enumOf = (full) => { const l = R.cls(full); return l ? R.meta.enumMembers(l[0]) : []; };
return R;
}
// </RT>
// ===================================================================================================

let RT = null;
const S = Object.assign({ w: 390, h: 600, zoom: 100, ui: 100, theme: "Gold", toasts: true, tab: 0, vals: {}, macros: [], min: false, x: 12, y: 12 }, (() => { try { return JSON.parse(lsGet("ssmod_settings_v3")) || {}; } catch (e) { return {}; } })());
const persist = () => lsSet("ssmod_settings_v3", JSON.stringify(S));
let toast = null;
const say = (s) => { dlog(s); if (toast) toast(s); };

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
} catch (e) {}
}
ovApply();
}
setInterval(runGroups, 200);

function eachField(cls, fname, cb) {
if (!RT || !RT.ok) return;
for (const obj of RT.find(cls)) { try { const f = RT.fieldOf(obj, fname); if (f) cb(obj, f); } catch (e) {} }
}

const C_CONT = "SYBO.Subway.Routes.WeightRandomizedPrefabContainter`2";
function chunkContainers() {
const out = [];
if (!RT || !RT.ok) return out;
for (const c of RT.find(C_CONT)) {
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
} catch (e) {}
}
return out;
}
function rebuildContainers() {
if (!RT || !RT.ok) return 0;
let n = 0;
for (const c of RT.find(C_CONT)) {
try { const m = RT.findMethod(RT.rw(c), "BuildRandomlyOrderedPrefabList", 0); if (m) { RT.call(m, c, []); n++; } } catch (e) {}
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

const P_DATA = "SYBO.Subway.Pickups.PickupData", P_SPOT = "SYBO.Subway.Pickups.PickupSpawnPoint", P_TYPE = "SYBO.Subway.Pickups.PickupType", P_MODE = "SYBO.Subway.Pickups.SpawnPointMode";
const pk = { force: "JetPack" };
function pickupTypeValue(name) { const e = RT && RT.ok ? RT.enumOf(P_TYPE).find((x) => x.name === name) : null; return e ? e.value : 0; }
defGroup("force", () => {
const out = [], mode = RT.enumOf(P_MODE).find((x) => x.name === "WillForcePickupType"), val = pickupTypeValue(pk.force);
if (!mode || !val) return out;
for (const obj of RT.find(P_SPOT)) {
const f1 = RT.fieldOf(obj, "__spawnPointMode"), f2 = RT.fieldOf(obj, "__forceSpawnPickupType");
if (f1 && f2) { out.push([obj, f1, mode.value]); out.push([obj, f2, val]); }
}
return out;
});
defGroup("nospace", () => { const out = []; eachField(P_DATA, "_spawnDistanceMinToPrevious", (o, f) => out.push([o, f, 0])); return out; });
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
} catch (e) {}
}
return rows;
}
function pickupOnly(row, rows) { for (const r of rows) ovSet("pickupweights", r.addr, r.fw, r === row ? Math.max(100, RT.read(r.addr, r.fw)) : 0); say("only " + row.name + " will spawn"); }

const TUNE = [
{ id: "ptimer", title: "Powerup timers", sub: "seconds left on every active powerup", def: 30000000, cls: [["Info.ActivePowerup", "timeLeft"]] },
{ id: "pmagnet", title: "Magnet pull speed", sub: "how fast coins fly to you", def: 300, cls: [["CoinMagnet", "pullSpeed"], ["LongMagnet", "pullSpeed"]] },
{ id: "pdouble", title: "Double coins value", sub: "coins per pickup while active", def: 50, cls: [["DoubleCoins", "ratio"]] }
];
TUNE.forEach((t) => { if (S.vals[t.id] === undefined) S.vals[t.id] = t.def; defGroup(t.id, () => { const out = []; for (const [c, f] of t.cls) eachField(c, f, (o, fl) => out.push([o, fl, S.vals[t.id]])); return out; }); });

const DEVC = "SYBO.Subway.Utilities.DebugSettings";
const DEV = [
{ f: "_characterInvincible", title: "Character invincible", sub: "crashes cannot end the run" },
{ f: "_unlockedSceneCamera", title: "Free scene camera", sub: "unlocks the camera" },
{ f: "_dontUseIdles", title: "Skip idle animations", sub: "no waiting animations" },
{ f: "_useDebugZDistanceTargetPosition", title: "Debug distance target", sub: "start the run far ahead" },
{ f: "_useQueuedEnvironmentKinds", title: "Use queued environments", sub: "force the world look queue" }
];
DEV.forEach((d) => defGroup("dev" + d.f, () => { const out = []; eachField(DEVC, d.f, (o, f) => out.push([o, f, f.kind === "bool" ? true : 1])); return out; }));
defGroup("dev_active", () => { const out = []; eachField(DEVC, "_active", (o, f) => out.push([o, f, f.kind === "bool" ? true : (S.vals.devActive || 1)])); return out; });

function callOn(cls, method, args) {
if (!RT || !RT.ok) throw new Error("not connected yet");
const objs = RT.find(cls);
if (!objs.length) throw new Error("no live " + cls.split(".").pop() + " object yet");
const m = RT.findMethod(RT.rw(objs[0]), method, args.length);
if (!m) throw new Error(cls + "." + method + " not found");
return RT.call(m, objs[0], args);
}

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
// UI (Unchanged Layout & Styling)
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
const groupSw = (id) => sw(() => groupOn(id), (v) => { if (v && (!RT || !RT.ok)) { say("not connected yet"); return; } setGroup(id, v); });
const copyText = (t) => { try { (window.navigator.clipboard).writeText(t); say("copied"); } catch (e) { say("copy failed"); } };

let FR = null, PANEL = null, BODY = null, bodyEls = {};
function buildUI() {
FR = document.createElement("iframe");
FR.title = "Subway Surfers mod v3";
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

const statDot = el("div", { className: "d" }), statTxt = el("span", { textContent: "starting..." });
const stat = el("div", { className: "stat" }, [statDot, statTxt, ibtn("refresh", () => { if (RT && RT.ok) RT.refresh(false); say("refreshing objects"); }, "refresh")]);
const minBtn = el("button", { className: "hb", title: "minimize" }, [icon("min", 14)]);
const head = el("div", { className: "h" }, [el("div", { className: "logo" }, [icon("spawn", 18)]), el("div", { className: "ttl1" }, [D.createTextNode("Subway Surfers"), el("span", { className: "pro", textContent: "PRO" }), el("small", { textContent: "mod menu v3 (C# Injection)" })]), el("div", { className: "sp" }), minBtn]);

// ===== SPAWN =====
const chunkOut = el("div", { className: "tbl" }), chunkHead = el("div", { className: "note" });
const cs = { cont: null, filter: "" };
const chunkFilter = el("input", { type: "text", className: "txt", placeholder: "filter lists or chunk names...", spellcheck: false });
function chunkRender() {
chunkOut.innerHTML = "";
if (!RT || !RT.ok) { chunkOut.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: "waiting for the game..." })])); return; }
const conts = chunkContainers(), q = chunkFilter.value.trim().toLowerCase();
if (cs.cont === null) {
chunkHead.textContent = conts.length + " weighted lists";
conts.filter((c) => !q || c.name.toLowerCase().indexOf(q) >= 0 || c.entries.some((e) => e.name.toLowerCase().indexOf(q) >= 0)).slice(0, 80).forEach((c) => {
const r = el("div", { className: "tr" }, [el("div", { className: "nm link", textContent: c.name + "  \u2022  " + c.entries.slice(0, 2).map((e) => e.name).join(", ") }), el("div", { className: "ty", textContent: c.entries.length + " items" })]);
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
chunkOut.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: e.name }), inp, ibtn("target", () => { chunkOnly(c, e); chunkRender(); }, "only this")]));
});
}
chunkFilter.addEventListener("input", () => { clearTimeout(chunkFilter.__t); chunkFilter.__t = setTimeout(chunkRender, 200); });
const ruleMode = sel(["Keep the first of every list", "Keep entries whose name contains"], () => (chunkRule.mode === "first" ? "Keep the first of every list" : "Keep entries whose name contains"), (v) => { chunkRule.mode = v.indexOf("first") >= 0 ? "first" : "match"; });
const ruleText = el("input", { type: "text", className: "txt", placeholder: "name text", spellcheck: false });
ruleText.oninput = () => { chunkRule.text = ruleText.value; };
const chunkCard = card("Chunk weights", [
el("div", { className: "note", textContent: "Control road generator weights dynamically." }),
ruleMode, ruleText,
R_(lbl("Apply to every list"), groupSw("chunkrule")),
el("div", { className: "btns" }, [btn("Restore all weights", chunkRestore, "", "undo")]),
chunkFilter, chunkHead, chunkOut
], "cube");

const pkOut = el("div", { className: "tbl" });
function pkRender() {
pkOut.innerHTML = "";
const rows = pickupRows();
if (!rows.length) { pkOut.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: RT && RT.ok ? "no pickup data yet" : "waiting..." })])); return; }
rows.forEach((r) => {
const w = el("input", { type: "text", spellcheck: false, value: String(RT.read(r.addr, r.fw)) });
w.onchange = () => { const v = Number(w.value); if (isFinite(v)) { ovSet("pickupweights", r.addr, r.fw, v); say(r.name + " weight " + v); } };
w.onkeydown = (ev) => { if (ev.key === "Enter") w.blur(); };
pkOut.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: r.name }), w, ibtn("target", () => { pickupOnly(r, rows); pkRender(); }, "only this")]));
});
}
const typeNames = ["Key", "CoinMagnet", "SuperSneakers", "JetPack", "MysteryBox", "MultiplierScore2x", "MysteryPowerup", "LetterHuntCharacter", "SuperMysteryBox", "TokenHunt", "LetterHuntDaily", "PogoStick"];
const pickCard = card("Pickups and powerups", [
el("div", { className: "note", textContent: "Force powerups at every spawn point." }),
R_(lbl("Force this pickup everywhere"), sel(typeNames, () => pk.force, (v) => { pk.force = v; })),
R_(lbl("Force it now"), groupSw("force")),
R_(lbl("No spacing between pickups"), groupSw("nospace")),
el("div", { className: "btns" }, [btn("Powerup flood", () => { setGroup("force", true); setGroup("nospace", true); say("flood on"); }, "hot", "spawn"), btn("Restore", () => { setGroup("force", false); setGroup("nospace", false); ovRelease("pickupweights"); pkRender(); say("restored"); }, "", "undo")]),
el("div", { className: "ttl" }, [D.createTextNode("Spawn weights")]), pkOut,
el("div", { className: "btns" }, [btn("Refresh", pkRender, "", "refresh")])
], "spawn");

const tuneCard = card("Powerup tuning", TUNE.map((t) => el("div", { className: "row" }, [lbl(t.title, t.sub), RR(num(() => S.vals[t.id], (v) => { S.vals[t.id] = v; persist(); }, true), groupSw(t.id))])), "spawn");
const pageSpawn = el("div", { className: "pg" }, [pickCard, chunkCard, tuneCard]);

// ===== DEVELOPER =====
const devActiveSel = el("div", { className: "note" });
const incC = { coins: 1000000, keys: 1000 };
const devCard = card("Developer settings", [
el("div", { className: "note", textContent: "Built-in debug switches." }),
R_(lbl("Developer mode"), groupSw("dev_active")),
devActiveSel
].concat(DEV.map((d) => R_(lbl(d.title, d.sub), groupSw("dev" + d.f)))), "dev");
const walletCard = card("Wallet", [
R_(lbl("Add coins"), RR(num(() => incC.coins, (v) => { incC.coins = Math.round(v); }, true), btn("Add", () => { try { callOn("Data.Save.InventorySave", "IncreaseCoins", [incC.coins]); say("added coins"); } catch (e) { say(e.message); } }, "", "plus"))),
R_(lbl("Add keys"), RR(num(() => incC.keys, (v) => { incC.keys = Math.round(v); }, true), btn("Add", () => { try { callOn("Data.Save.InventorySave", "IncreaseKeys", [incC.keys]); say("added keys"); } catch (e) { say(e.message); } }, "", "plus")))
], "dev");
const pageDev = el("div", { className: "pg hide" }, [devCard, walletCard]);

// ===== EXPLORER =====
const ex = { view: "objects", cls: null, objs: [], obj: null, stack: [], locks: new Map(), mapCls: "SYBO.Subway.Level.MovingTrain" };
const exSearch = el("input", { type: "text", className: "txt", placeholder: "search class...", spellcheck: false });
const exList = el("div", { className: "tbl" }), exHead = el("div", { className: "note" }), exFields = el("div", { className: "tbl" }), exNav = el("div", { className: "btns" });
const exObjCard = card("Objects", [exSearch, exList], "list");
const exInspCard = card("Inspector", [exHead, exNav, exFields], "explorer");
let exRows = [];
function exClasses() {
exList.innerHTML = "";
if (!RT || !RT.ok) return;
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
const r = el("div", { className: "tr" }, [el("div", { className: "nm link", textContent: nm }), el("div", { className: "ty", textContent: c + " obj" })]);
r.firstChild.onclick = () => { ex.cls = i; ex.objs = (RT.objs.get(i) || []).slice(0, 60); ex.obj = null; ex.stack = []; exRender(); };
exList.appendChild(r);
});
}
function exOpen(addr, push) { if (push && ex.obj) ex.stack.push(ex.obj); ex.obj = addr; exRender(); }
function getterRow(m, a) {
const out = el("div", { className: "nm", textContent: "tap get", style: "text-align:right;flex:none;max-width:130px" });
return el("div", { className: "tr" }, [el("div", { className: "nm", textContent: m.name.replace("get_", "") }), el("div", { className: "ty", textContent: m.ret.replace("System.", "") }), out, ibtn("play", () => { try { const r = RT.call(m, a, []); out.textContent = RT.fmtRet(m, r); if (m.ret !== "System.Void" && /^0x/.test(out.textContent)) { out.className = "nm link"; out.onclick = () => exOpen(parseInt(out.textContent, 16) >>> 0, true); } } catch (e) { out.textContent = "err"; } }, "read")]);
}
function methodRow(m, a) {
const sig = m.name + "(" + m.pars.map((p) => p.type.replace("System.", "") + " " + p.name).join(", ") + ")";
const wrap = el("div", {}), head = el("div", { className: "tr" }, [el("div", { className: "nm link", textContent: sig })]), form = el("div", { className: "tr", style: "display:none;flex-wrap:wrap" });
const ins = m.pars.map((p) => el("input", { type: "text", placeholder: p.name, spellcheck: false, value: "0" }));
const res = el("div", { className: "nm", textContent: "" });
ins.forEach((i) => form.appendChild(i));
form.appendChild(btn("Run", () => { try { const args = ins.map((i, k) => (m.pars[k].type === "System.Boolean" ? (i.value === "true" || i.value === "1") : Number(i.value))); res.textContent = RT.fmtRet(m, RT.call(m, a, args)); } catch (e) { res.textContent = "err"; } }, "hot", "play"));
form.appendChild(res);
head.firstChild.onclick = () => { if (!m.pars.length) { try { res.textContent = RT.fmtRet(m, RT.call(m, a, [])); form.style.display = "flex"; } catch (e) { form.style.display = "flex"; } } else form.style.display = form.style.display === "none" ? "flex" : "none"; };
wrap.appendChild(head); wrap.appendChild(form);
return wrap;
}
function exRender() {
exNav.innerHTML = ""; exFields.innerHTML = ""; exRows = [];
if (!RT || !RT.ok) return;
if (ex.obj === null) {
if (ex.cls === null) { exHead.textContent = "pick a class"; return; }
exHead.textContent = RT.meta.name(ex.cls) + ": " + ex.objs.length + " objects";
ex.objs.forEach((a, i) => exNav.appendChild(btn("#" + (i + 1) + "  " + hex(a), () => exOpen(a, false))));
return;
}
const a = ex.obj, ins = RT.inspect(a);
exNav.appendChild(btn("Back", () => { ex.obj = ex.stack.pop() || null; exRender(); }, "", "back"));
exNav.appendChild(btn("Refresh", exRender, "", "refresh"));
exNav.appendChild(btn("Copy", () => copyText(hex(a)), "", "copy"));
if (!ins) { exHead.textContent = "invalid object"; return; }
exHead.textContent = ins.name + " @ " + hex(a);
const arr = RT.arrayInfo(a);
if (arr) {
const dv = new DataView(RT.M.HEAPU8.buffer);
for (let i = 0; i < arr.len; i++) {
const ea = arr.base + i * arr.sz, v = arr.sz === 4 ? dv.getUint32(ea, true) >>> 0 : 0;
exFields.appendChild(el("div", { className: "tr" }, [el("div", { className: "nm", textContent: "[" + i + "]" }), el("div", { className: "nm", textContent: hex(v), style: "text-align:right" })]));
}
return;
}
const seen = new Set();
exFields.appendChild(el("div", { className: "tr" }, [el("div", { className: "ttl" }, [D.createTextNode("Variables")])]));
ins.fields.forEach((f) => {
if (f.isConst || (f.isStatic && !RT.L.statics)) return;
const key = f.owner + "." + f.name;
if (seen.has(key)) return; seen.add(key);
const editable = ["float", "double", "int", "uint", "short", "ushort", "byte", "sbyte", "bool", "long", "ulong", "char"].indexOf(f.kind) >= 0;
const nm = el("div", { className: "nm", textContent: f.name }), ty = el("div", { className: "ty", textContent: f.tn });
let val;
if (editable) {
val = el("input", { type: "text", spellcheck: false, value: RT.show(a, f) });
val.onchange = () => { try { RT.write(a, f, Number(val.value)); } catch (e) {} };
exRows.push([val, f, a]);
} else {
val = el("div", { className: "nm", textContent: RT.show(a, f), style: "text-align:right;flex:none;max-width:120px" });
}
exFields.appendChild(el("div", { className: "tr" }, [nm, ty, val]));
});
const chain = RT.methodsChain(ins.klass).filter((m) => !/^(\.|add_|remove_|set_)/.test(m.name));
chain.filter((m) => /^get_/.test(m.name) && m.pars.length === 0 && !m.static).slice(0, 40).forEach((m) => exFields.appendChild(getterRow(m, a)));
}
exSearch.addEventListener("input", () => { clearTimeout(exSearch.__t); exSearch.__t = setTimeout(exClasses, 200); });

const mapCanvas = el("canvas", { className: "map", width: 700, height: 460 });
const mapIn = el("input", { type: "text", className: "txt", value: ex.mapCls });
const mapInfo = el("div", { className: "note" });
let mapTimer = 0;
function posOf(obj) {
const k = RT.rw(obj), gt = RT.findMethod(k, "get_transform", 0);
if (!gt) return null;
const tr = RT.call(gt, obj, []);
if (!tr) return null;
const gp = RT.findMethod(RT.rw(tr), "get_position", 0);
return gp ? RT.call(gp, tr, []) : null;
}
function mapDraw() {
const c = mapCanvas.getContext("2d");
c.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
if (!RT || !RT.ok) return;
try {
const me = RT.find("SYBO.Subway.Characters.Character")[0], p0 = me ? posOf(me) : [0, 0, 0];
const list = RT.find(mapIn.value.trim()).slice(0, 300), pts = [];
for (const o of list) { const p = posOf(o); if (p) pts.push(p); }
const W_ = mapCanvas.width, H_ = mapCanvas.height, sc = 6;
c.fillStyle = THEMES[S.theme].ac;
pts.forEach((p) => { const x = W_ / 2 + (p[0] - p0[0]) * sc * 2, y = H_ - 40 - (p[2] - p0[2]) * sc; if (x > 0 && x < W_ && y > 0 && y < H_) c.fillRect(x - 3, y - 3, 6, 6); });
c.fillStyle = "#fff"; c.beginPath(); c.arc(W_ / 2, H_ - 40, 7, 0, 7); c.fill();
mapInfo.textContent = pts.length + " positions plotted";
} catch (e) {}
}
const mapCard = card("Flat map", [mapIn, mapCanvas, mapInfo, el("div", { className: "btns" }, [btn("Plot", mapDraw, "hot", "map"), btn("Live", function () { if (mapTimer) { clearInterval(mapTimer); mapTimer = 0; this.classList.remove("hot"); } else { mapTimer = setInterval(mapDraw, 500); this.classList.add("hot"); } }, "", "play")])], "map");
const subBar = el("div", { className: "sub" });
const pageEx = el("div", { className: "pg hide" }, [subBar, exObjCard, exInspCard, mapCard]);
function setSub(v) { ex.view = v; exObjCard.style.display = v === "objects" ? "" : "none"; exInspCard.style.display = v === "objects" ? "" : "none"; mapCard.style.display = v === "map" ? "" : "none"; Array.from(subBar.children).forEach((b) => b.classList.toggle("on", b.__v === v)); }
[["objects", "Objects", "list"], ["map", "Map", "map"]].forEach(([v, t, ic]) => { const b = btn(t, () => setSub(v), "", ic); b.__v = v; subBar.appendChild(b); });

// ===== CONSOLE / C# INJECTION TAB =====
const conIn = el("textarea", { className: "txt", spellcheck: false, placeholder: "// Advanced C# Hooking & Injection\n// Example: Hook player jump power or character stumbles\nss.hook('SYBO.Subway.Characters.Character', 'Jump', 0, (orig, self) => {\n    say('Jump intercepted!');\n    return orig([self]);\n});" });
const conOut = el("pre", { className: "out", textContent: "(output)" }), macroBox = el("div", { className: "btns" });
const macroName = el("input", { type: "text", className: "txt", placeholder: "Macro button name..." });

const api = {
get RT() { return RT; }, log: LOG, hex,
find: (c) => (RT ? RT.find(c) : []),
inspect: (a) => (RT ? RT.inspect(a) : null),
hook: (cls, method, argc, fn) => { if (!RT || !RT.ok) throw new Error("Not connected"); return RT.hookMethod(cls, method, argc, fn); },
call: (a, n, ...args) => { const m = RT.findMethod(RT.rw(a), n, args.length); if (!m) throw new Error("Method not found"); return RT.call(m, a, args); },
callStatic: (cls, n, ...args) => { const l = RT.cls(cls); if (!l) throw new Error("Class not found"); const k = (RT.klassOf.get(l[0]) || [])[0]; const m = RT.methodsChain(k).find((x) => x.name === n && x.pars.length === args.length && x.static); if (!m) throw new Error("Static method not found"); return RT.call(m, 0, args); },
rescan: () => RT.refresh(true), say
};
window.ss = api;
const runCode = (code) => { try { return (0, eval)("(function(ss){ return (" + code + "\n)})")(api); } catch (e1) { return (0, eval)("(function(ss){" + code + "\n})")(api); } };
function drawMacros() {
macroBox.innerHTML = "";
S.macros.forEach((m, i) => { const b = btn(m.name, () => { try { runCode(m.code); say(m.name + " executed"); } catch (e) { say("Error: " + e.message); } }, "", "play"); b.oncontextmenu = (e) => { e.preventDefault(); S.macros.splice(i, 1); persist(); drawMacros(); }; macroBox.appendChild(b); });
}
const pageCon = el("div", { className: "pg hide" }, [
card("C# Runtime Injection & Hooking", [conIn, el("div", { className: "btns" }, [btn("Inject Hook", () => { try { const v = runCode(conIn.value); conOut.textContent = v === undefined ? "Hook injected successfully!" : String(v); } catch (e) { conOut.textContent = "error: " + e.message; } }, "hot", "play"), btn("Clear", () => { conIn.value = ""; conOut.textContent = "(output)"; }, "", "trash")]), conOut,
el("div", { className: "note", textContent: "Inject C# hooks and intercept live engine method invocations using ss.hook(className, methodName, argc, callback)." })], "console"),
card("Custom Buttons", [macroName, el("div", { className: "btns" }, [btn("Save Script as Button", () => { const n = macroName.value.trim(); if (!n || !conIn.value.trim()) return; S.macros.push({ name: n, code: conIn.value }); persist(); drawMacros(); macroName.value = ""; }, "", "plus")]), macroBox], "console")
]);

// ===== SAVE & PREFS =====
const saveInfo = el("pre", { className: "out" }), saveTa = el("textarea", { className: "txt", spellcheck: false, placeholder: "export/import" });
let wipeArmed = 0;
const pageSave = el("div", { className: "pg hide" }, [
card("Save System", [saveInfo, el("div", { className: "btns" }, [btn("Back up", async () => { await saveBackup(); say("backed up " + SAVE.files + " files"); }, "hot", "save"), btn("Restore", async () => { const n = await saveRestore(true); say("restored " + n + " files"); }, "", "undo")]), saveTa], "save")
]);

const logOut = el("pre", { className: "out" });
const pagePrefs = el("div", { className: "pg hide" }, [
card("Theme", [el("div", { className: "btns" }, Object.keys(THEMES).map((n) => { const b = btn(n, () => { S.theme = n; applyLook(); persist(); }); return b; }))], "prefs"),
card("Log", [logOut], "list")
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
const rs = el("div", { className: "rs", title: "resize" });
PANEL = el("div", { className: "p" }, [head, stat, el("div", { className: "tabs" }, [pill].concat(tabEls)), BODY, rs]);
doc.body.appendChild(PANEL);
bodyEls = { statDot, statTxt, stat, saveInfo, logOut, devActiveSel };

const tbox = document.createElement("div");
tbox.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none;z-index:2147483647";
document.body.appendChild(tbox);
toast = (msg) => {
const n = document.createElement("div");
n.textContent = msg;
n.style.cssText = "padding:8px 16px;border-radius:16px;background:rgba(24,19,8,.94);color:#ffe27a;font:700 12px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.45);opacity:0;transition:opacity .3s";
tbox.appendChild(n);
requestAnimationFrame(() => { n.style.opacity = 1; });
setTimeout(() => { n.style.opacity = 0; setTimeout(() => n.remove(), 350); }, 2400);
};

let drag = null;
head.addEventListener("pointerdown", (e) => { if (e.target.closest && e.target.closest(".hb")) return; drag = { sx: e.screenX, sy: e.screenY, x: S.x, y: S.y }; head.setPointerCapture(e.pointerId); });
head.addEventListener("pointermove", (e) => { if (!drag) return; S.x = clamp(drag.x + e.screenX - drag.sx, -S.w + 80, innerWidth - 80); S.y = clamp(drag.y + e.screenY - drag.sy, 0, innerHeight - 60); FR.style.left = S.x + "px"; FR.style.top = S.y + "px"; });
head.addEventListener("pointerup", () => { drag = null; persist(); });
minBtn.onclick = () => { S.min = !S.min; place(); persist(); };
let rsd = null;
rs.addEventListener("pointerdown", (e) => { rsd = { sx: e.screenX, sy: e.screenY, w: S.w, h: S.h }; });
rs.addEventListener("pointermove", (e) => { if (!rsd) return; S.w = Math.max(300, rsd.w + e.screenX - rsd.sx); S.h = Math.max(240, rsd.h + e.screenY - rsd.sy); place(); });
rs.addEventListener("pointerup", () => { rsd = null; persist(); });

setInterval(() => {
if (S.min) return;
swDraws.forEach((f) => { try { f(); } catch (e) {} });
const M = getModule();
let state = "bad", text;
if (!M || !M.HEAPU8) text = "waiting for game...";
else if (!RT) text = "starting...";
else if (RT.ok) { state = "ok"; text = "connected  \u2022  " + RT.kinv.size + " classes  \u2022  " + (RT.total || 0) + " objects"; }
else { state = "mid"; text = RT.status; }
stat.className = "stat " + state; statTxt.textContent = text;
saveInfo.textContent = "engine save sync: " + SAVE.engine + "\nbackup files: " + SAVE.files;
if (S.tab === 5) logOut.textContent = LOG.slice(-60).join("\n");
}, 600);

applyLook(); drawMacros(); setSub("objects");
setTab(S.tab >= 0 && S.tab < TABS.length ? S.tab : 0);
dlog("Subway Surfers mod v3 ready");
}

if (document.body) buildUI(); else addEventListener("DOMContentLoaded", buildUI);
window.__ssRT = () => RT;
dlog("Subway Surfers mod v3 loaded with C# Hooking engine");
})();