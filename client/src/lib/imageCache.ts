/**
 * Gerenciador de Cache Persistente de Imagens para o Chat (Xolas)
 * Nível 1: Cache em Memória (Map de ObjectURLs para renderização síncrona/instantânea)
 * Nível 2: IndexedDB (Armazenamento persistente de Blobs com descarte inteligente LRU de 150 MB)
 */

const DB_NAME = 'xolas_cache_db';
const DB_VERSION = 1;
const STORE_NAME = 'chat_images';
const MAX_CACHE_SIZE_BYTES = 150 * 1024 * 1024; // 150 MB
const TARGET_CLEANUP_BYTES = 120 * 1024 * 1024; // 120 MB ao atingir limite
const MAX_ENTRIES = 500;

interface CachedImageRecord {
  url: string;
  blob: Blob;
  mimeType: string;
  size: number;
  timestamp: number;
}

// Cache L1 em memória
const memoryObjectUrlCache = new Map<string, string>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onerror = (err) => {
          console.warn('[ImageCache] Falha ao abrir IndexedDB:', err);
          resolve(null);
        };
      } catch (e) {
        console.warn('[ImageCache] Exceção ao abrir IndexedDB:', e);
        resolve(null);
      }
    });
  }

  return dbPromise;
}

/**
 * Verifica de forma síncrona se a imagem já possui ObjectURL pronta em memória.
 */
export function isImageCachedInMemory(url: string): boolean {
  if (!url) return false;
  return memoryObjectUrlCache.has(url);
}

/**
 * Retorna a ObjectURL do cache em memória caso exista.
 */
export function getMemoryCachedObjectUrl(url: string): string | null {
  if (!url) return null;
  return memoryObjectUrlCache.get(url) || null;
}

/**
 * Obtém a imagem do cache (Memória ou IndexedDB).
 * Se encontrada no IndexedDB, cria uma ObjectURL e alimenta a memória.
 */
export async function getCachedImageObjectUrl(url: string): Promise<string | null> {
  if (!url) return null;

  // 1. Verificar cache em memória
  const inMemory = memoryObjectUrlCache.get(url);
  if (inMemory) {
    return inMemory;
  }

  // 2. Verificar IndexedDB
  try {
    const db = await openDatabase();
    if (!db) return null;

    const record = await new Promise<CachedImageRecord | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(url);

        req.onsuccess = () => {
          resolve(req.result || null);
        };
        req.onerror = () => {
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });

    if (record && record.blob) {
      // Atualizar timestamp (acesso recente para LRU) em segundo plano
      touchRecordTimestamp(url).catch(() => {});

      const objectUrl = URL.createObjectURL(record.blob);
      memoryObjectUrlCache.set(url, objectUrl);
      return objectUrl;
    }
  } catch (err) {
    console.warn('[ImageCache] Erro ao recuperar imagem do cache:', err);
  }

  return null;
}

/**
 * Salva uma imagem no cache (Memória e IndexedDB com checagem de cota LRU).
 */
export async function saveImageToCache(url: string, blob: Blob): Promise<string> {
  if (!url || !blob) return url;

  // 1. Guardar em memória
  let objectUrl = memoryObjectUrlCache.get(url);
  if (!objectUrl) {
    objectUrl = URL.createObjectURL(blob);
    memoryObjectUrlCache.set(url, objectUrl);
  }

  // 2. Persistir no IndexedDB
  try {
    const db = await openDatabase();
    if (!db) return objectUrl;

    const record: CachedImageRecord = {
      url,
      blob,
      mimeType: blob.type || 'image/png',
      size: blob.size || 0,
      timestamp: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(record);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });

    // Realizar verificação de cota LRU em segundo plano
    runLruCleanupIfNeeded().catch(() => {});
  } catch (err) {
    console.warn('[ImageCache] Falha ao persistir imagem no IndexedDB:', err);
  }

  return objectUrl;
}

/**
 * Baixa uma imagem via fetch com timeout, converte para Blob e salva no cache.
 */
export async function preloadAndCacheImage(url: string, timeoutMs: number = 10000): Promise<string> {
  if (!url) throw new Error('URL inválida');

  const cached = await getCachedImageObjectUrl(url);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'force-cache',
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const blob = await response.blob();
    clearTimeout(timer);
    return await saveImageToCache(url, blob);
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

/**
 * Atualiza o timestamp do registro para manter a ordenação LRU.
 */
async function touchRecordTimestamp(url: string): Promise<void> {
  try {
    const db = await openDatabase();
    if (!db) return;

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(url);

    getReq.onsuccess = () => {
      const record = getReq.result as CachedImageRecord | undefined;
      if (record) {
        record.timestamp = Date.now();
        store.put(record);
      }
    };
  } catch {}
}

/**
 * Executa a limpeza do cache se ultrapassar MAX_CACHE_SIZE_BYTES ou MAX_ENTRIES.
 */
async function runLruCleanupIfNeeded(): Promise<void> {
  try {
    const db = await openDatabase();
    if (!db) return;

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');

    // Obter todas as chaves ordenadas por timestamp (mais antigas primeiro)
    const request = index.openCursor();
    const recordsToDelete: string[] = [];
    let totalSize = 0;
    let totalCount = 0;

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const item = cursor.value as CachedImageRecord;
        totalSize += item.size || 0;
        totalCount += 1;

        if (totalSize > MAX_CACHE_SIZE_BYTES || totalCount > MAX_ENTRIES) {
          recordsToDelete.push(item.url);
        }
        cursor.continue();
      } else {
        // Excluir registros mais antigos que excederam a cota
        if (recordsToDelete.length > 0) {
          const deleteTx = db.transaction(STORE_NAME, 'readwrite');
          const deleteStore = deleteTx.objectStore(STORE_NAME);
          recordsToDelete.forEach((key) => {
            deleteStore.delete(key);
            const inMemory = memoryObjectUrlCache.get(key);
            if (inMemory) {
              URL.revokeObjectURL(inMemory);
              memoryObjectUrlCache.delete(key);
            }
          });
        }
      }
    };
  } catch (err) {
    console.warn('[ImageCache] Falha durante limpeza LRU:', err);
  }
}
