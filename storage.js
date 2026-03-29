const DB_NAME = "hitop-suite-local-vault";
const DB_VERSION = 1;
const SECURITY_STORE = "security";
const PATIENTS_STORE = "patients";
const SESSIONS_STORE = "sessions";
const SECURITY_RECORD_ID = "app-security";
const DEFAULT_AUTO_LOCK_MS = 10 * 60 * 1000;
const PBKDF2_ITERATIONS = 210_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let dbPromise = null;
let openDb = null;

export { DEFAULT_AUTO_LOCK_MS };

function getDatabase() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(SECURITY_STORE)) {
          db.createObjectStore(SECURITY_STORE, { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains(PATIENTS_STORE)) {
          const patients = db.createObjectStore(PATIENTS_STORE, { keyPath: "id" });
          patients.createIndex("updatedAt", "updatedAt");
        }

        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          const sessions = db.createObjectStore(SESSIONS_STORE, { keyPath: "id" });
          sessions.createIndex("patientId", "patientId");
          sessions.createIndex("updatedAt", "updatedAt");
          sessions.createIndex("patientIdInstrumentIdStatus", ["patientId", "instrumentId", "status"]);
        }
      };

      request.onsuccess = () => {
        openDb = request.result;
        openDb.onversionchange = () => {
          openDb?.close();
          openDb = null;
          dbPromise = null;
        };
        resolve(openDb);
      };

      request.onerror = () => {
        reject(request.error || new Error("No pude abrir IndexedDB."));
      };
    });
  }

  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Fallo en IndexedDB."));
  });
}

async function getRecord(storeName, key) {
  const db = await getDatabase();
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  return requestToPromise(store.get(key));
}

async function getAllRecords(storeName) {
  const db = await getDatabase();
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  return requestToPromise(store.getAll());
}

async function getAllByIndex(storeName, indexName, key) {
  const db = await getDatabase();
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const index = store.index(indexName);
  return requestToPromise(index.getAll(IDBKeyRange.only(key)));
}

async function putRecord(storeName, record) {
  const db = await getDatabase();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  store.put(record);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error || new Error("No pude guardar el registro."));
    tx.onabort = () => reject(tx.error || new Error("La transacción fue abortada."));
  });
}

async function deleteRecord(storeName, key) {
  const db = await getDatabase();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  store.delete(key);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("No pude eliminar el registro."));
    tx.onabort = () => reject(tx.error || new Error("La transacción fue abortada."));
  });
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function derivePinSecrets(pin, existingSalt = null) {
  const salt = existingSalt ? base64ToBytes(existingSalt) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      keyMaterial,
      512
    )
  );

  const keyBytes = bits.slice(0, 32);
  const verifierBytes = bits.slice(32, 64);
  const encryptionKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);

  return {
    salt: bytesToBase64(salt),
    verifier: bytesToBase64(verifierBytes),
    encryptionKey,
  };
}

async function encryptPayload(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    encoder.encode(JSON.stringify(value))
  );

  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptPayload(key, value) {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(value.iv),
    },
    key,
    base64ToBytes(value.ciphertext)
  );

  return JSON.parse(decoder.decode(plaintext));
}

export async function getSecurityRecord() {
  return (await getRecord(SECURITY_STORE, SECURITY_RECORD_ID)) || null;
}

export async function createVault(pin) {
  const now = new Date().toISOString();
  const { salt, verifier, encryptionKey } = await derivePinSecrets(pin);
  const record = {
    id: SECURITY_RECORD_ID,
    salt,
    pinVerifier: verifier,
    lastUnlockedAt: now,
    settings: {
      autoLockMs: DEFAULT_AUTO_LOCK_MS,
    },
    createdAt: now,
    updatedAt: now,
  };

  await putRecord(SECURITY_STORE, record);

  return {
    record,
    key: encryptionKey,
  };
}

export async function unlockVault(pin) {
  const record = await getSecurityRecord();
  if (!record) {
    return {
      ok: false,
      reason: "missing-security",
    };
  }

  const { verifier, encryptionKey } = await derivePinSecrets(pin, record.salt);
  if (verifier !== record.pinVerifier) {
    return {
      ok: false,
      reason: "invalid-pin",
    };
  }

  const updatedRecord = {
    ...record,
    lastUnlockedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await putRecord(SECURITY_STORE, updatedRecord);

  return {
    ok: true,
    key: encryptionKey,
    record: updatedRecord,
  };
}

export async function listPatients(key) {
  const records = await getAllRecords(PATIENTS_STORE);
  const patients = await Promise.all(records.map((record) => decryptPayload(key, record.payload)));
  return patients.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
}

export async function savePatient(key, patient) {
  const payload = await encryptPayload(key, patient);
  await putRecord(PATIENTS_STORE, {
    id: patient.id,
    createdAt: patient.createdAt,
    updatedAt: patient.updatedAt,
    payload,
  });
  return patient;
}

export async function getPatient(key, patientId) {
  const record = await getRecord(PATIENTS_STORE, patientId);
  if (!record) {
    return null;
  }
  return decryptPayload(key, record.payload);
}

export async function saveSession(key, session) {
  const payload = await encryptPayload(key, session);
  await putRecord(SESSIONS_STORE, {
    id: session.id,
    patientId: session.patientId,
    instrumentId: session.instrumentId,
    status: session.status,
    startedAt: session.startedAt,
    completedAt: session.completedAt || null,
    updatedAt: session.updatedAt,
    payload,
  });
  return session;
}

export async function getSession(key, sessionId) {
  const record = await getRecord(SESSIONS_STORE, sessionId);
  if (!record) {
    return null;
  }
  return decryptPayload(key, record.payload);
}

export async function listSessionsForPatient(key, patientId) {
  const records = await getAllByIndex(SESSIONS_STORE, "patientId", patientId);
  const sessions = await Promise.all(records.map((record) => decryptPayload(key, record.payload)));
  return sessions.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
}

export async function findInProgressSession(key, patientId, instrumentId) {
  const records = await getAllByIndex(SESSIONS_STORE, "patientIdInstrumentIdStatus", [patientId, instrumentId, "in_progress"]);
  if (!records.length) {
    return null;
  }

  const sessions = await Promise.all(records.map((record) => decryptPayload(key, record.payload)));
  sessions.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
  return sessions[0];
}

export async function deleteSession(sessionId) {
  await deleteRecord(SESSIONS_STORE, sessionId);
}

export async function deletePatientAndSessions(patientId) {
  const db = await getDatabase();
  const tx = db.transaction([PATIENTS_STORE, SESSIONS_STORE], "readwrite");
  const patients = tx.objectStore(PATIENTS_STORE);
  const sessions = tx.objectStore(SESSIONS_STORE);
  const sessionsIndex = sessions.index("patientId");

  patients.delete(patientId);
  const request = sessionsIndex.getAll(IDBKeyRange.only(patientId));

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      (request.result || []).forEach((record) => {
        sessions.delete(record.id);
      });
    };
    request.onerror = () => {
      reject(request.error || new Error("No pude cargar las sesiones del paciente."));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("No pude eliminar el paciente."));
    tx.onabort = () => reject(tx.error || new Error("La transacción fue abortada."));
  });
}

export async function updateSecuritySettings(patch) {
  const record = await getSecurityRecord();
  if (!record) {
    return null;
  }

  const updated = {
    ...record,
    settings: {
      ...record.settings,
      ...patch,
    },
    updatedAt: new Date().toISOString(),
  };

  await putRecord(SECURITY_STORE, updated);
  return updated;
}

export async function resetVault() {
  if (openDb) {
    openDb.close();
    openDb = null;
  }
  dbPromise = null;

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("No pude resetear la base local."));
    request.onblocked = () => reject(new Error("La base local esta bloqueada por otra pestaña."));
  });
}
