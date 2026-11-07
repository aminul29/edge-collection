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
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
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
      const offset = (typeof SupabaseClient !== 'undefined' && SupabaseClient.getServerTimeOffset) ? SupabaseClient.getServerTimeOffset() : 0;

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
          await this._directLocalPutCollection(this._mapCloudToLocalCollection(cCol, null));
          localChanged = true;
        } else {
          const localUpdated = localCol.updated || localCol.created || 0;
          const isLocalDirty = !!localCol._dirty;
          const normalizedCloudUpdated = cloudUpdated - offset;

          if (isLocalDirty) {
            // Local has pending un-synced changes -> push to cloud
            collectionsToUpsertCloud.push(this._mapLocalCollectionToCloud(localCol, user.id));
          } else if (normalizedCloudUpdated > localUpdated) {
            // Cloud is genuinely newer -> update local
            await this._directLocalPutCollection(this._mapCloudToLocalCollection(cCol, localCol));
            localChanged = true;
          } else if (localUpdated > normalizedCloudUpdated) {
            // Local is newer -> push to cloud
            collectionsToUpsertCloud.push(this._mapLocalCollectionToCloud(localCol, user.id));
          }
        }
      }

      // B. Process local collections not present in cloud
      for (const lCol of localCollections) {
        if (!cloudColMap.has(lCol.id)) {
          collectionsToUpsertCloud.push(this._mapLocalCollectionToCloud(lCol, user.id));
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
          await this._directLocalPutItem(this._mapCloudToLocalItem(cItem, null));
          localChanged = true;
        } else {
          const localUpdated = localItem.updated || localItem.created || 0;
          const isLocalDirty = !!localItem._dirty;
          const normalizedCloudUpdated = cloudUpdated - offset;

          if (isLocalDirty) {
            // Local has pending un-synced changes -> push to cloud
            itemsToUpsertCloud.push(this._mapLocalItemToCloud(localItem, user.id));
          } else if (normalizedCloudUpdated > localUpdated) {
            // Cloud is genuinely newer -> update local
            await this._directLocalPutItem(this._mapCloudToLocalItem(cItem, localItem));
            localChanged = true;
          } else if (localUpdated > normalizedCloudUpdated) {
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
        const sentTimestamps = new Map(collectionsToUpsertCloud.map(c => [c.id, new Date(c.updated_at).getTime()]));
        const upsertRes = await SupabaseClient.from('collections').upsert(collectionsToUpsertCloud);
        if (Array.isArray(upsertRes)) {
          for (const updatedCol of upsertRes) {
            if (updatedCol && updatedCol.id) {
              const currentLocal = (await this._getLocalCollection(updatedCol.id)) || localColMap.get(updatedCol.id);
              if (currentLocal) {
                const sentTime = sentTimestamps.get(updatedCol.id) || 0;
                // Only clear dirty flag and update timestamp if user hasn't made another edit while upsert was in flight
                if ((currentLocal.updated || 0) <= sentTime) {
                  currentLocal.updated = new Date(updatedCol.updated_at || updatedCol.created_at).getTime();
                  currentLocal._dirty = false;
                }
                // Never overwrite valid local sortOrder with cloud's sort_order
                if ((currentLocal.sortOrder === undefined || currentLocal.sortOrder === null) &&
                    updatedCol.sort_order !== undefined && updatedCol.sort_order !== null && !isNaN(Number(updatedCol.sort_order))) {
                  currentLocal.sortOrder = Number(updatedCol.sort_order);
                }
                const { count, ...colToSave } = currentLocal;
                await this._directLocalPutCollection(colToSave);
              }
            }
          }
        }
      }

      if (itemsToUpsertCloud.length > 0) {
        const sentTimestamps = new Map(itemsToUpsertCloud.map(i => [i.id, new Date(i.updated_at).getTime()]));
        const upsertRes = await SupabaseClient.from('items').upsert(itemsToUpsertCloud);
        if (Array.isArray(upsertRes)) {
          for (const updatedItem of upsertRes) {
            if (updatedItem && updatedItem.id) {
              const currentLocal = (await this._getLocalItem(updatedItem.id)) || localItemMap.get(updatedItem.id);
              if (currentLocal) {
                const sentTime = sentTimestamps.get(updatedItem.id) || 0;
                if ((currentLocal.updated || 0) <= sentTime) {
                  currentLocal.updated = new Date(updatedItem.updated_at || updatedItem.created_at).getTime();
                  currentLocal._dirty = false;
                }
                if ((currentLocal.sortOrder === undefined || currentLocal.sortOrder === null) &&
                    updatedItem.sort_order !== undefined && updatedItem.sort_order !== null && !isNaN(Number(updatedItem.sort_order))) {
                  currentLocal.sortOrder = Number(updatedItem.sort_order);
                }
                await this._directLocalPutItem(currentLocal);
              }
            }
          }
        }
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

  _mapLocalCollectionToCloud(lCol, userId) {
    const lUpdated = lCol.updated || lCol.created || Date.now();
    return {
      id: lCol.id,
      user_id: userId,
      name: lCol.name || 'Untitled Collection',
      color: lCol.color || 'blue',
      sort_order: (lCol.sortOrder !== undefined && lCol.sortOrder !== null && !isNaN(Number(lCol.sortOrder))) ? Number(lCol.sortOrder) : 0,
      created_at: new Date(lCol.created || Date.now()).toISOString(),
      updated_at: new Date(lUpdated).toISOString()
    };
  },

  _mapCloudToLocalCollection(cCol, existingLocal = null) {
    const cloudUpdated = new Date(cCol.updated_at || cCol.created_at).getTime();
    
    // Determine sortOrder:
    // If local has a custom valid sort order and cloud has 0/null/undefined (unranked or default),
    // preserve local sortOrder. If cloud has an explicit ranking, adopt it.
    let sortOrder;
    const hasCloudSort = (cCol.sort_order !== undefined && cCol.sort_order !== null && !isNaN(Number(cCol.sort_order)));
    const hasLocalSort = existingLocal && (existingLocal.sortOrder !== undefined && existingLocal.sortOrder !== null && !isNaN(Number(existingLocal.sortOrder)));
    
    if (hasCloudSort && (Number(cCol.sort_order) > 0 || !hasLocalSort)) {
      sortOrder = Number(cCol.sort_order);
    } else if (hasLocalSort) {
      sortOrder = Number(existingLocal.sortOrder);
    } else if (hasCloudSort) {
      sortOrder = Number(cCol.sort_order);
    } else {
      sortOrder = 0;
    }

    return {
      ...(existingLocal || {}),
      id: cCol.id,
      name: cCol.name || (existingLocal && existingLocal.name) || 'Untitled Collection',
      color: cCol.color || (existingLocal && existingLocal.color) || 'blue',
      sortOrder: sortOrder,
      created: existingLocal?.created || new Date(cCol.created_at).getTime(),
      updated: cloudUpdated,
      _dirty: false
    };
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
      sort_order: (lItem.sortOrder !== undefined && lItem.sortOrder !== null && !isNaN(Number(lItem.sortOrder))) ? Number(lItem.sortOrder) : 0,
      created_at: new Date(lItem.created || Date.now()).toISOString(),
      updated_at: new Date(lUpdated).toISOString()
    };
  },

  _mapCloudToLocalItem(cItem, existingLocal = null) {
    const cloudUpdated = new Date(cItem.updated_at || cItem.created_at).getTime();
    
    let sortOrder;
    const hasCloudSort = (cItem.sort_order !== undefined && cItem.sort_order !== null && !isNaN(Number(cItem.sort_order)));
    const hasLocalSort = existingLocal && (existingLocal.sortOrder !== undefined && existingLocal.sortOrder !== null && !isNaN(Number(existingLocal.sortOrder)));
    
    if (hasCloudSort && (Number(cItem.sort_order) > 0 || !hasLocalSort)) {
      sortOrder = Number(cItem.sort_order);
    } else if (hasLocalSort) {
      sortOrder = Number(existingLocal.sortOrder);
    } else if (hasCloudSort) {
      sortOrder = Number(cItem.sort_order);
    } else {
      sortOrder = 0;
    }

    return {
      ...(existingLocal || {}),
      id: cItem.id,
      collectionId: cItem.collection_id,
      type: cItem.type || 'link',
      title: cItem.title || '',
      url: cItem.url || '',
      thumbnail: cItem.thumbnail || (existingLocal && existingLocal.thumbnail) || '',
      linkNote: cItem.link_note || (existingLocal && existingLocal.linkNote) || '',
      itemTheme: cItem.item_theme || (existingLocal && existingLocal.itemTheme) || '',
      content: cItem.content || (existingLocal && existingLocal.content) || '',
      color: cItem.item_theme || (existingLocal && existingLocal.color) || 'yellow',
      parentGroupId: cItem.parent_group_id || null,
      groupId: cItem.parent_group_id || null,
      collapsed: !!cItem.collapsed,
      viewMode: cItem.view_mode || 'list',
      sortOrder: sortOrder,
      created: existingLocal?.created || new Date(cItem.created_at).getTime(),
      updated: cloudUpdated,
      _dirty: false
    };
  },

  _getLocalCollection(id) {
    return new Promise(r => {
      if (typeof db === 'undefined' || !db) return r(null);
      try {
        const tx = db.transaction(['collections'], 'readonly');
        const req = tx.objectStore('collections').get(id);
        req.onsuccess = () => r(req.result || null);
        req.onerror = () => r(null);
      } catch (e) {
        r(null);
      }
    });
  },

  _getLocalItem(id) {
    return new Promise(r => {
      if (typeof db === 'undefined' || !db) return r(null);
      try {
        const tx = db.transaction(['items'], 'readonly');
        const req = tx.objectStore('items').get(id);
        req.onsuccess = () => r(req.result || null);
        req.onerror = () => r(null);
      } catch (e) {
        r(null);
      }
    });
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
