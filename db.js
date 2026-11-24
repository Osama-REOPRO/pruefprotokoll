// Lokale Datenbank (IndexedDB). Alles bleibt auf dem Handy, auch ohne Netz.
// Getrennte Tabellen, damit später ein Server/Sync dazukommen kann:
//   customers, sites, gates, inspections, photos (Fotos als Blob, getrennt von der Prüfung),
//   visits (Termin: ein Kunde, ein Objekt, ein Datum, mehrere Tore/Türen)
// Jeder Datensatz hat id, createdAt, updatedAt (für späteren Abgleich).

const DB_NAME = 'hotz-protokoll';
const DB_VERSION = 3;
const STORES = ['customers', 'sites', 'gates', 'inspections', 'photos', 'visits'];

let dbPromise;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) {
            const os = db.createObjectStore(s, { keyPath: 'id' });
            os.createIndex('updatedAt', 'updatedAt');
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
  }));
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const VIEW_ONLY = new Set(['createdAt', 'updatedAt', 'lastStep', 'maxStep', 'filter', 'editPair', 'lastPair']);
const canon = (o) => JSON.stringify(o, (k, v) => (VIEW_ONLY.has(k) ? undefined
  : v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v));
const sameContent = (a, b) => canon(a) === canon(b);

export const db = {
  get: (store, id) => tx(store, 'readonly', s => s.get(id)),
  all: (store) => tx(store, 'readonly', s => s.getAll()),
  // updatedAt ändert sich nur, wenn sich am Inhalt wirklich etwas geändert hat.
  // Nur Ansehen / Blättern (Ansichts-Felder unten) zählt nicht als Änderung, damit beim
  // Abgleich zwischen Handy und Laptop die echte neuere Fassung gewinnt.
  put: async (store, rec) => {
    const now = new Date().toISOString();
    const old = store === 'photos' ? null : await tx(store, 'readonly', s => s.get(rec.id));
    rec.createdAt ??= old?.createdAt ?? now;
    rec.updatedAt = old && sameContent(old, rec) ? old.updatedAt : now;
    return tx(store, 'readwrite', s => s.put(rec)).then(() => rec);
  },
  // Unverändert speichern (Empfang von einem anderen Gerät: Zeitstempel bleiben erhalten)
  putRaw: (store, rec) => tx(store, 'readwrite', s => s.put(rec)).then(() => rec),
  del: (store, id) => tx(store, 'readwrite', s => s.delete(id)),
};

// Browser bitten, die Daten nicht automatisch zu löschen (wichtig auf iPhone)
export async function requestPersistence() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch {}
  return false;
}
