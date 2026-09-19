/**
 * Synchronization Engine for Edge Collections Extension
 * Handles bidirectional delta sync between IndexedDB and Supabase Cloud.
 */

const TombstoneService = {
  async getTombstones() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const res = await chrome.storage.local.get(['tombstones_collections', 'tombstones_items']);
        return {
          collections: res.tombstones_collections || [],
          items: res.tombstones_items || []
        };
      }
      return {
        collections: JSON.parse(localStorage.getItem('tombstones_collections') || '[]'),
        items: JSON.parse(localStorage.getItem('tombstones_items') || '[]')
      };
    } catch (e) {
      return { collections: [], items: [] };
    }
  },

  async addCollectionTombstone(id) {
    try {
      const { collections, items } = await this.getTombstones();
      if (!collections.some(t => t.id === id)) {
        collections.push({ id, deleted_at: new Date().toISOString() });
        await this._save(collections, items);
      }
    } catch (e) {
      console.warn('Could not record collection tombstone:', e);
    }
  },

  async addItemTombstone(id) {
    try {
      const { collections, items } = await this.getTombstones();
      if (!items.some(t => t.id === id)) {
        items.push({ id, deleted_at: new Date().toISOString() });
        await this._save(collections, items);
      }
    } catch (e) {
      console.warn('Could not record item tombstone:', e);
    }
  },

  async removeCollectionTombstones(ids) {
    try {
      const { collections, items } = await this.getTombstones();
      const idSet = new Set(ids);
      const updated = collections.filter(t => !idSet.has(t.id));
      await this._save(updated, items);
    } catch (e) {
      console.warn('Could not clear collection tombstones:', e);
    }
  },

  async removeItemTombstones(ids) {
    try {
      const { collections, items } = await this.getTombstones();
      const idSet = new Set(ids);
      const updated = items.filter(t => !idSet.has(t.id));
      await this._save(collections, updated);
    } catch (e) {
      console.warn('Could not clear item tombstones:', e);
    }
  },

  async _save(collections, items) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({
        tombstones_collections: collections,
        tombstones_items: items
      });
    } else {
      localStorage.setItem('tombstones_collections', JSON.stringify(collections));
      localStorage.setItem('tombstones_items', JSON.stringify(items));
    }
  }
};

const SyncService = {
  _status: 'idle', // 'idle' | 'syncing' | 'error' | 'offline'
  _lastError: null,
  _listeners: new Set(),
  _debounceTimer: null,
  _isSyncInProgress: false,

  getStatus() {
    return {
      status: this._status,
      lastError: this._lastError
    };
  },

  addListener(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  },

  _setStatus(status, error = null) {
    this._status = status;
    this._lastError = error;
    this._notifyListeners();
  },

  _notifyListeners() {
    const payload = {
      status: this._status,
      error: this._lastError
    };
    for (const cb of this._listeners) {
      try {
        cb(payload);
      } catch (err) {
        console.error('Sync listener error:', err);
      }
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('supabase-sync-status', { detail: payload }));
    }
  },

  async getLastSyncTime() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const res = await chrome.storage.local.get(['supabase_last_sync']);
      return res.supabase_last_sync || null;
    }
    return localStorage.getItem('supabase_last_sync');
  },

  async _setLastSyncTime(isoString) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ supabase_last_sync: isoString });
    } else {
      localStorage.setItem('supabase_last_sync', isoString);
    }
  },

  /**
   * Schedules a debounced sync after user mutations.
   */
  scheduleSync(delayMs = 1500) {
    if (typeof SupabaseClient === 'undefined' || !SupabaseClient.isAuthenticated()) {
      return;
    }

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this.sync().catch(err => console.warn('Debounced sync error:', err));
    }, delayMs);
  },

  /**
   * Main delta synchronization algorithm.
   */
  async sync() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this._setStatus('offline', 'Internet connection offline');
      return { success: false, reason: 'offline' };
    }

    if (typeof SupabaseClient === 'undefined' || !SupabaseClient.isAuthenticated()) {
      this._setStatus('idle');
      return { success: false, reason: 'unauthenticated' };
    }

    if (this._isSyncInProgress) {
      return { inProgress: true };
    }

    this._isSyncInProgress = true;
    this._setStatus('syncing');

    try {
      const user = await SupabaseClient.getUser();
      if (!user || !user.id) {
        throw new Error('User not found in active session');
      }

      // 1. Process local tombstones (soft deletions)
      const tombstones = await TombstoneService.getTombstones();
      const syncedColTombstones = [];
      const syncedItemTombstones = [];

      for (const t of tombstones.collections) {
        try {
          await SupabaseClient.from('collections').update(t.id, {
            deleted_at: t.deleted_at,
            updated_at: t.deleted_at
          });
          syncedColTombstones.push(t.id);
        } catch (e) {
          console.warn(`Could not sync collection deletion for ${t.id}:`, e);
        }
      }

      for (const t of tombstones.items) {
        try {
          await SupabaseClient.from('items').update(t.id, {
            deleted_at: t.deleted_at,
            updated_at: t.deleted_at
          });
          syncedItemTombstones.push(t.id);
        } catch (e) {
          console.warn(`Could not sync item deletion for ${t.id}:`, e);
        }
      }

      if (syncedColTombstones.length > 0) {
        await TombstoneService.removeCollectionTombstones(syncedColTombstones);
      }
      if (syncedItemTombstones.length > 0) {
        await TombstoneService.removeItemTombstones(syncedItemTombstones);
      }

      // 2. Fetch cloud data
      const cloudCollections = await SupabaseClient.from('collections').select('*');
      const cloudItems = await SupabaseClient.from('items').select('*');

      // 3. Fetch local data from IndexedDB
      const localCollections = await DBService.getAllCollections();
      const localItems = await DBService.getAllItems();

      const localColMap = new Map(localCollections.map(c => [c.id, c]));
      const localItemMap = new Map(localItems.map(i => [i.id, i]));

      const cloudColMap = new Map(cloudCollections.map(c => [c.id, c]));
      const cloudItemMap = new Map(cloudItems.map(i => [i.id, i]));

      let localChanged = false;
      const collectionsToUpsertCloud = [];
      const itemsToUpsertCloud = [];

      // 4. Reconcile Collections
      // A. Process cloud collections
      for (const cCol of cloudCollections) {
        const localCol = localColMap.get(cCol.id);

        if (cCol.deleted_at) {
          // Soft-deleted in cloud -> remove locally if present
          if (localCol) {
            await this._directLocalDeleteCollection(cCol.id);
            localChanged = true;
          }
          continue;
        }

        const cloudUpdated = new Date(cCol.updated_at || cCol.created_at).getTime();

        if (!localCol) {
          // New in cloud -> insert locally
          await this._directLocalPutCollection({
            id: cCol.id,
            name: cCol.name,
            color: cCol.color || 'blue',
            sortOrder: cCol.sort_order !== undefined ? cCol.sort_order : 0,
            created: new Date(cCol.created_at).getTime(),
            updated: cloudUpdated
          });
          localChanged = true;
        } else {
          const localUpdated = localCol.updated || localCol.created || 0;
          if (cloudUpdated > localUpdated) {
            // Cloud is newer -> update local
            await this._directLocalPutCollection({
              ...localCol,
              name: cCol.name,
              color: cCol.color || 'blue',
              sortOrder: cCol.sort_order !== undefined ? cCol.sort_order : localCol.sortOrder,
              updated: cloudUpdated
            });
            localChanged = true;
          } else if (localUpdated > cloudUpdated) {
            // Local is newer -> push to cloud
            collectionsToUpsertCloud.push({
              id: localCol.id,
              user_id: user.id,
              name: localCol.name,
              color: localCol.color || 'blue',
              sort_order: localCol.sortOrder !== undefined ? localCol.sortOrder : 0,
              updated_at: new Date(localUpdated).toISOString()
            });
          }
        }
      }

      // B. Process local collections not present in cloud
      for (const lCol of localCollections) {
        if (!cloudColMap.has(lCol.id)) {
          const lUpdated = lCol.updated || lCol.created || Date.now();
          collectionsToUpsertCloud.push({
            id: lCol.id,
            user_id: user.id,
            name: lCol.name,
            color: lCol.color || 'blue',
            sort_order: lCol.sortOrder !== undefined ? lCol.sortOrder : 0,
            created_at: new Date(lCol.created || Date.now()).toISOString(),
            updated_at: new Date(lUpdated).toISOString()
          });
        }
      }

      // 5. Reconcile Items
      // A. Process cloud items
      for (const cItem of cloudItems) {
        const localItem = localItemMap.get(cItem.id);

        if (cItem.deleted_at) {
          // Soft-deleted in cloud -> remove locally if present
          if (localItem) {
            await this._directLocalDeleteItem(cItem.id);
            localChanged = true;
          }
          continue;
        }

        const cloudUpdated = new Date(cItem.updated_at || cItem.created_at).getTime();

        if (!localItem) {
          // New in cloud -> insert locally
          const newLocalItem = {
            id: cItem.id,
            collectionId: cItem.collection_id,
            type: cItem.type,
            title: cItem.title || '',
            url: cItem.url || '',
            thumbnail: cItem.thumbnail || '',
            linkNote: cItem.link_note || '',
            itemTheme: cItem.item_theme || '',
            content: cItem.content || '',
            color: cItem.item_theme || 'yellow',
            parentGroupId: cItem.parent_group_id || null,
            groupId: cItem.parent_group_id || null,
            collapsed: !!cItem.collapsed,
            viewMode: cItem.view_mode || 'list',
            sortOrder: cItem.sort_order !== undefined ? cItem.sort_order : 0,
            created: new Date(cItem.created_at).getTime(),
            updated: cloudUpdated
          };
          await this._directLocalPutItem(newLocalItem);
          localChanged = true;
        } else {
          const localUpdated = localItem.updated || localItem.created || 0;
          if (cloudUpdated > localUpdated) {
            // Cloud is newer -> update local
            const updatedLocalItem = {
              ...localItem,
              collectionId: cItem.collection_id,
              type: cItem.type,
              title: cItem.title || '',
              url: cItem.url || '',
              thumbnail: cItem.thumbnail || '',
              linkNote: cItem.link_note || '',
              itemTheme: cItem.item_theme || '',
              content: cItem.content || '',
              color: cItem.item_theme || localItem.color || 'yellow',
              parentGroupId: cItem.parent_group_id || null,
              groupId: cItem.parent_group_id || null,
              collapsed: !!cItem.collapsed,
              viewMode: cItem.view_mode || 'list',
              sortOrder: cItem.sort_order !== undefined ? cItem.sort_order : localItem.sortOrder,
              updated: cloudUpdated
            };
            await this._directLocalPutItem(updatedLocalItem);
            localChanged = true;
          } else if (localUpdated > cloudUpdated) {
            // Local is newer -> push to cloud
            itemsToUpsertCloud.push(this._mapLocalItemToCloud(localItem, user.id));
          }
        }
      }

      // B. Process local items not present in cloud
      for (const lItem of localItems) {
        if (!cloudItemMap.has(lItem.id)) {
          itemsToUpsertCloud.push(this._mapLocalItemToCloud(lItem, user.id));
        }
      }

      // 6. Push local pending changes to Supabase
      if (collectionsToUpsertCloud.length > 0) {
        await SupabaseClient.from('collections').upsert(collectionsToUpsertCloud);
      }

      if (itemsToUpsertCloud.length > 0) {
        await SupabaseClient.from('items').upsert(itemsToUpsertCloud);
      }

      // 7. Stamp last sync time
      const nowIso = new Date().toISOString();
      await this._setLastSyncTime(nowIso);

      this._setStatus('idle');

      // 8. If local IndexedDB was updated, trigger app re-render
      if (localChanged && typeof render === 'function') {
        try {
          await render();
        } catch (rErr) {
          console.warn('Re-render after sync failed:', rErr);
        }
      }

      return {
        success: true,
        lastSync: nowIso,
        pushedCollections: collectionsToUpsertCloud.length,
        pushedItems: itemsToUpsertCloud.length,
        localChanged
      };
    } catch (err) {
      console.error('Supabase Sync error:', err);
      this._setStatus('error', err.message || 'Sync failed');
      return { success: false, error: err.message };
    } finally {
      this._isSyncInProgress = false;
    }
  },

  _mapLocalItemToCloud(lItem, userId) {
    const lUpdated = lItem.updated || lItem.created || Date.now();
    return {
      id: lItem.id,
      user_id: userId,
      collection_id: lItem.collectionId,
      type: lItem.type,
      title: lItem.title || null,
      url: lItem.url || null,
      thumbnail: lItem.thumbnail || null,
      link_note: lItem.linkNote || null,
      item_theme: lItem.itemTheme || lItem.color || null,
      content: lItem.content || null,
      parent_group_id: lItem.parentGroupId || lItem.groupId || null,
      collapsed: !!lItem.collapsed,
      view_mode: lItem.viewMode || 'list',
      sort_order: lItem.sortOrder !== undefined ? lItem.sortOrder : 0,
      created_at: new Date(lItem.created || Date.now()).toISOString(),
      updated_at: new Date(lUpdated).toISOString()
    };
  },

  // Internal direct DB helpers that bypass tombstone recording
  _directLocalPutCollection(col) {
    return new Promise((resolve, reject) => {
      if (!db) return resolve();
      const tx = db.transaction(['collections'], 'readwrite');
      const store = tx.objectStore('collections');
      const req = store.put(col);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  },

  _directLocalDeleteCollection(id) {
    return new Promise((resolve, reject) => {
      if (!db) return resolve();
      const tx = db.transaction(['collections', 'items'], 'readwrite');
      const colStore = tx.objectStore('collections');
      colStore.delete(id);

      const itemStore = tx.objectStore('items');
      const index = itemStore.index('collectionId');
      const req = index.openCursor(IDBKeyRange.only(id));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  },

  _directLocalPutItem(item) {
    return new Promise((resolve, reject) => {
      if (!db) return resolve();
      const tx = db.transaction(['items'], 'readwrite');
      const store = tx.objectStore('items');
      const req = store.put(item);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  },

  _directLocalDeleteItem(id) {
    return new Promise((resolve, reject) => {
      if (!db) return resolve();
      const tx = db.transaction(['items'], 'readwrite');
      const store = tx.objectStore('items');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }
};
