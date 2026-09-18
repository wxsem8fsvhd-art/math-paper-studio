const DATABASE_NAME = "math-paper-studio-recent-work";
const DATABASE_VERSION = 1;
const SESSION_KEY = "latest";

let databasePromise;

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("session")) {
          database.createObjectStore("session", { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains("documents")) {
          database.createObjectStore("documents", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

async function writeToStore(storeName, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    operation(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function readRecentWork() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["session", "documents"], "readonly");
    const sessionRequest = transaction.objectStore("session").get(SESSION_KEY);
    const documentsRequest = transaction.objectStore("documents").getAll();
    transaction.oncomplete = () =>
      resolve({ session: sessionRequest.result || null, documents: documentsRequest.result || [] });
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function saveRecentSession(session) {
  return writeToStore("session", (store) => store.put({ ...session, key: SESSION_KEY }));
}

export function saveRecentDocument(document) {
  return writeToStore("documents", (store) => store.put(document));
}

export function removeRecentDocument(id) {
  return writeToStore("documents", (store) => store.delete(id));
}

export async function clearRecentWork() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["session", "documents"], "readwrite");
    transaction.objectStore("session").clear();
    transaction.objectStore("documents").clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
