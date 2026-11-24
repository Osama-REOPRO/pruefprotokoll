// Termin senden / empfangen: ein Termin wird mit allem, was dazugehört, zu einer Datei.
// Die Datei geht per Mail, WhatsApp, AirDrop o. ä. auf das andere Gerät und wird dort geöffnet.
// Kein Server, kein Konto. Beim Empfangen gewinnt je Datensatz die neuere Fassung (updatedAt),
// es entstehen keine Doppelten, weil alles über die id abgeglichen wird.
import { db } from './db.js';

const FORMAT = 'hotz-pruefprotokoll-termin';

const blobToDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
const dataURLToBlob = async (url) => (await fetch(url)).blob();

export async function exportVisit(visitId) {
  const visit = await db.get('visits', visitId);
  if (!visit) throw new Error('Termin nicht gefunden');
  const inspections = (await db.all('inspections')).filter(i => i.visitId === visitId);
  const custIds = new Set(), siteIds = new Set(), gateIds = new Set(), photoIds = new Set();
  for (const p of visit.pairs || []) { custIds.add(p.customerId); siteIds.add(p.siteId); }
  custIds.add(visit.customerId); siteIds.add(visit.siteId);
  for (const i of inspections) {
    custIds.add(i.customerId); siteIds.add(i.siteId); gateIds.add(i.gateId);
    for (const a of Object.values(i.answers || {})) (a.photos || []).forEach(id => photoIds.add(id));
    for (const a of Object.values(i.prev || {})) (a.photos || []).forEach(id => photoIds.add(id));
  }
  const pick = async (store, ids) => (await Promise.all([...ids].filter(Boolean).map(id => db.get(store, id)))).filter(Boolean);
  const gates = await pick('gates', gateIds);
  gates.forEach(g => { siteIds.add(g.siteId); custIds.add(g.customerId); });
  const sites = await pick('sites', siteIds);
  sites.forEach(s => custIds.add(s.customerId));
  const photos = await Promise.all((await pick('photos', photoIds)).map(async ({ blob, ...rest }) => ({ ...rest, data: blob ? await blobToDataURL(blob) : null })));
  return {
    format: FORMAT, version: 1, exportedAt: new Date().toISOString(),
    visit, inspections, customers: await pick('customers', custIds), sites, gates, photos,
  };
}

export function fileName(title, datum) {
  const clean = `${title || 'Termin'} ${datum || ''}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `Termin ${clean}.json`;
}

// Teilen-Menü (Handy) oder Download (Laptop)
export async function sendFile(data, name) {
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'downloaded';
}

// Datei lesen und einspielen. Gibt eine kurze Zusammenfassung zurück.
export async function importFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('Die Datei ist kein Termin aus dieser App.'); }
  if (data?.format !== FORMAT || !data.visit?.id) throw new Error('Die Datei ist kein Termin aus dieser App.');
  const res = { added: 0, updated: 0, keptLocal: 0, visitId: data.visit.id, isNew: !(await db.get('visits', data.visit.id)) };
  const merge = async (store, rec, prep) => {
    if (!rec?.id) return;
    const local = await db.get(store, rec.id);
    if (local && (local.updatedAt || '') >= (rec.updatedAt || '')) { if (local.updatedAt !== rec.updatedAt) res.keptLocal++; return; }
    await db.putRaw(store, prep ? await prep(rec) : rec);
    local ? res.updated++ : res.added++;
  };
  for (const r of data.customers || []) await merge('customers', r);
  for (const r of data.sites || []) await merge('sites', r);
  for (const r of data.gates || []) await merge('gates', r);
  for (const r of data.photos || []) await merge('photos', r, async ({ data: url, ...rest }) => ({ ...rest, blob: url ? await dataURLToBlob(url) : null }));
  for (const r of data.inspections || []) await merge('inspections', r);
  // Termin: neuere Fassung gewinnt, aber Paare (Kunde + Objekt) von beiden Seiten bleiben erhalten
  const localV = await db.get('visits', data.visit.id);
  await merge('visits', data.visit);
  if (localV) {
    const now = await db.get('visits', data.visit.id);
    const other = now.updatedAt === localV.updatedAt ? data.visit : localV;
    const missing = (other.pairs || []).filter(p => !(now.pairs || []).some(q => q.id === p.id));
    if (missing.length) { now.pairs = [...(now.pairs || []), ...missing]; await db.putRaw('visits', now); }
  }
  return res;
}
