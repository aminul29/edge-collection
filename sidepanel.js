// State Management
let db = null;
let currentView = 'master'; // 'master' or 'detail'
let activeCollectionId = null;
let collectionsList = []; // Caching collections for search filtering
let activeCollectionItems = []; // Caching items for search filtering

let draggedCollectionId = null;
let draggedItemId = null;
let draggedGroupId = null;
let draggedType = null; // 'collection', 'item', or 'group'
let backDragTimeout = null;

let selectionModeActive = false;
let selectedItemIds = new Set();
let preSearchView = null;
let isProUser = false;
const GUMROAD_PRODUCT_ID = "OoY9cskAiTFzrZBCDYUDWw==";
const GUMROAD_PRODUCT_URL = "https://aminulist0.gumroad.com/l/fzkozw";
const MAX_LICENSE_USES = 1;
const PROMO_FOOTER_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

const DB_NAME = 'CollectionsDB';
const DB_VERSION = 1;

// Helper to generate unique IDs
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2, 9) + Math.random().toString(36).substring(2, 9);

// --- IndexedDB Database Service ---
const DBService = {
  init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = (e) => {
        console.error("Database open error:", e.target.error);
        reject(e.target.error);
      };
      
      request.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
      
      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains('collections')) {
          database.createObjectStore('collections', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('items')) {
          const itemStore = database.createObjectStore('items', { keyPath: 'id' });
          itemStore.createIndex('collectionId', 'collectionId', { unique: false });
        }
      };
    });
  },

  getAllCollections() {
    return new Promise(async (resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      try {
        const collections = await new Promise((res, rej) => {
          const tx = db.transaction(['collections'], 'readonly');
          const store = tx.objectStore('collections');
          const req = store.getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror = () => rej(req.error);
        });
        
        const items = await new Promise((res, rej) => {
          const tx = db.transaction(['items'], 'readonly');
          const store = tx.objectStore('items');
          const req = store.getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror = () => rej(req.error);
        });
        
        // Count items for each collection (excluding group containers)
        const counts = {};
        items.forEach(item => {
          if (item.type !== 'group') {
            counts[item.collectionId] = (counts[item.collectionId] || 0) + 1;
          }
        });
        
        const result = collections.map(col => ({
          ...col,
          count: counts[col.id] || 0
        }));
        
        // Sort collections by custom order or creation date
        result.sort((a, b) => {
          const orderA = a.sortOrder !== undefined ? a.sortOrder : -a.created;
          const orderB = b.sortOrder !== undefined ? b.sortOrder : -b.created;
          return orderA - orderB;
        });
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  },

  addCollection(name) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['collections'], 'readwrite');
      const store = transaction.objectStore('collections');
      const collection = {
        id: generateId(),
        name: name,
        created: Date.now(),
        updated: Date.now()
      };
      
      const request = store.add(collection);
      request.onsuccess = () => {
        if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
        resolve(collection);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  },

  updateCollectionName(id, newName) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['collections'], 'readwrite');
      const store = transaction.objectStore('collections');
      
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const col = getReq.result;
        if (!col) return reject(new Error("Collection not found"));
        col.name = newName;
        col.updated = Date.now();
        const updateReq = store.put(col);
        updateReq.onsuccess = () => {
          if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
          resolve(col);
        };
        updateReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  },

  updateCollectionColor(id, color) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['collections'], 'readwrite');
      const store = transaction.objectStore('collections');
      
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const col = getReq.result;
        if (!col) return reject(new Error("Collection not found"));
        col.color = color;
        col.updated = Date.now();
        const updateReq = store.put(col);
        updateReq.onsuccess = () => {
          if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
          resolve(col);
        };
        updateReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  },


  deleteCollection(id) {
    return new Promise(async (resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      try {
        if (typeof TombstoneService !== 'undefined') {
          await TombstoneService.addCollectionTombstone(id);
          const allItems = await DBService.getItems(id);
          for (const item of allItems) {
            await TombstoneService.addItemTombstone(item.id);
          }
        }
      } catch (e) {
        console.warn('Could not record tombstones for collection deletion:', e);
      }

      const transaction = db.transaction(['collections', 'items'], 'readwrite');
      
      transaction.onerror = (e) => reject(e.target.error);
      transaction.oncomplete = () => {
        if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
        resolve();
      };
      
      const colStore = transaction.objectStore('collections');
      colStore.delete(id);
      
      const itemStore = transaction.objectStore('items');
      const index = itemStore.index('collectionId');
      const request = index.openCursor(IDBKeyRange.only(id));
      
      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    });
  },

  getItems(collectionId) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['items'], 'readonly');
      const store = transaction.objectStore('items');
      const index = store.index('collectionId');
      const request = index.getAll(collectionId);
      
      request.onsuccess = (e) => {
        const items = e.target.result || [];
        // Sort items by custom order or creation date
        items.sort((a, b) => {
          const orderA = a.sortOrder !== undefined ? a.sortOrder : -a.created;
          const orderB = b.sortOrder !== undefined ? b.sortOrder : -b.created;
          return orderA - orderB;
        });
        resolve(items);
      };
      
      request.onerror = (e) => reject(e.target.error);
    });
  },

  getAllItems() {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      const transaction = db.transaction(['items'], 'readonly');
      const store = transaction.objectStore('items');
      const request = store.getAll();
      request.onsuccess = (e) => resolve(e.target.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
  },


  addItem(collectionId, title, url, favicon, thumbnail, groupId = null) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const cleanGroupId = (typeof groupId === 'string' && groupId.trim()) ? groupId.trim() : null;
      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      const now = Date.now();
      const item = {
        id: generateId(),
        collectionId: collectionId,
        groupId: cleanGroupId,
        title: title || "Untitled Page",
        url: url,
        favicon: favicon || "",
        thumbnail: thumbnail || "",
        linkNote: "",
        itemTheme: "",
        type: "link",
        created: now,
        updated: now
      };
      
      const request = store.add(item);
      request.onsuccess = () => {
        if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
        resolve(item);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  },

  updateItemThumbnail(id, thumbnail) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));

      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const item = getReq.result;
        if (!item) return reject(new Error("Item not found"));
        item.thumbnail = thumbnail || "";
        item.updated = Date.now();

        const updateReq = store.put(item);
        updateReq.onsuccess = () => {
          if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
          resolve(item);
        };
        updateReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  },

  updateLinkNote(id, linkNote) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));

      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const item = getReq.result;
        if (!item) return reject(new Error("Link not found"));
        item.linkNote = linkNote || "";
        item.updated = Date.now();

        const updateReq = store.put(item);
        updateReq.onsuccess = () => {
          if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
          resolve(item);
        };
        updateReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  },

  updateItemTheme(id, itemTheme) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));

      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const item = getReq.result;
        if (!item) return reject(new Error("Link not found"));
        item.itemTheme = itemTheme || "";
        item.updated = Date.now();

        const updateReq = store.put(item);
        updateReq.onsuccess = () => {
          if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
          resolve(item);
        };
        updateReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  },

  addNote(collectionId, content, color, groupId = null) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      const now = Date.now();
      const item = {
        id: generateId(),
        collectionId: collectionId,
        groupId: groupId || null,
        type: "note",
        content: content || "",
        color: color || "yellow",
        created: now,
        updated: now
      };
      
      const request = store.add(item);
      request.onsuccess = () => {
        if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
        resolve(item);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  },

  updateNoteContent(id, newContent) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (!item) return reject(new Error("Note not found"));
        item.content = newContent;
        item.updated = Date.now();
        const updateReq = store.put(item);
        updateReq.onsuccess = () => {
          if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
          resolve(item);
        };
        updateReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  },

  updateNoteColor(id, newColor) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (!item) return reject(new Error("Note not found"));
        item.color = newColor;
        item.updated = Date.now();
        const updateReq = store.put(item);
        updateReq.onsuccess = () => {
          if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
          resolve(item);
        };
        updateReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  },

  deleteItem(id) {
    return new Promise(async (resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      try {
        if (typeof TombstoneService !== 'undefined') {
          await TombstoneService.addItemTombstone(id);
        }
      } catch (e) {
        console.warn('Could not record item tombstone:', e);
      }

      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      const request = store.delete(id);
      
      request.onsuccess = () => {
        if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
        resolve();
      };
      request.onerror = (e) => reject(e.target.error);
    });
  },

  addGroup(collectionId, title, parentGroupId = null, color = 'blue', viewMode = 'list') {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      const now = Date.now();
      const group = {
        id: 'grp_' + generateId(),
        collectionId: collectionId,
        type: 'group',
        title: title || "New Tab Group",
        parentGroupId: parentGroupId || null,
        color: color || 'blue',
        collapsed: false,
        viewMode: viewMode || 'list',
        created: now,
        updated: now
      };
      
      const request = store.add(group);
      request.onsuccess = () => {
        if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
        resolve(group);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  },

  updateGroupViewMode(id, newViewMode) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      const getReq = store.get(id);
      
      getReq.onsuccess = () => {
        const group = getReq.result;
        if (!group) return reject(new Error("Group not found"));
        group.viewMode = newViewMode;
        group.updated = Date.now();
        const updateReq = store.put(group);
        updateReq.onsuccess = () => {
          if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
          resolve(group);
        };
        updateReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  },

  updateGroupTitle(id, newTitle) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      const getReq = store.get(id);
      
      getReq.onsuccess = () => {
        const group = getReq.result;
        if (!group) return reject(new Error("Group not found"));
        group.title = newTitle;
        group.updated = Date.now();
        const updateReq = store.put(group);
        updateReq.onsuccess = () => {
          if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
          resolve(group);
        };
        updateReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  },

  updateGroupColor(id, newColor) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      const getReq = store.get(id);
      
      getReq.onsuccess = () => {
        const group = getReq.result;
        if (!group) return reject(new Error("Group not found"));
        group.color = newColor;
        group.updated = Date.now();
        const updateReq = store.put(group);
        updateReq.onsuccess = () => {
          if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
          resolve(group);
        };
        updateReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  },

  toggleGroupCollapse(id, collapsed) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      const getReq = store.get(id);
      
      getReq.onsuccess = () => {
        const group = getReq.result;
        if (!group) return reject(new Error("Group not found"));
        group.collapsed = collapsed !== undefined ? collapsed : !group.collapsed;
        group.updated = Date.now();
        const updateReq = store.put(group);
        updateReq.onsuccess = () => {
          if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
          resolve(group);
        };
        updateReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  },

  deleteGroup(id, deleteContents = false) {
    return new Promise(async (resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      try {
        const allItems = await DBService.getAllItems();
        const targetGroup = allItems.find(i => i.id === id && i.type === 'group');
        const parentId = targetGroup ? targetGroup.parentGroupId : null;
        
        if (typeof TombstoneService !== 'undefined') {
          await TombstoneService.addItemTombstone(id);
        }

        const transaction = db.transaction(['items'], 'readwrite');
        const store = transaction.objectStore('items');
        
        if (deleteContents) {
          const groupsToDelete = new Set([id]);
          let added = true;
          while (added) {
            added = false;
            allItems.forEach(i => {
              if (i.type === 'group' && i.parentGroupId && groupsToDelete.has(i.parentGroupId) && !groupsToDelete.has(i.id)) {
                groupsToDelete.add(i.id);
                added = true;
              }
            });
          }
          
          for (const i of allItems) {
            if (groupsToDelete.has(i.id) || (i.groupId && groupsToDelete.has(i.groupId))) {
              store.delete(i.id);
              if (typeof TombstoneService !== 'undefined') {
                await TombstoneService.addItemTombstone(i.id);
              }
            }
          }
        } else {
          allItems.forEach(i => {
            if (i.groupId === id) {
              i.groupId = parentId || null;
              i.updated = Date.now();
              store.put(i);
            } else if (i.type === 'group' && i.parentGroupId === id) {
              i.parentGroupId = parentId || null;
              i.updated = Date.now();
              store.put(i);
            }
          });
          store.delete(id);
        }
        
        transaction.oncomplete = () => {
          if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
          resolve();
        };
        transaction.onerror = (e) => reject(e.target.error);
      } catch (err) {
        reject(err);
      }
    });
  },

  moveItemToGroup(itemId, targetGroupId) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      const getReq = store.get(itemId);
      
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (!item) return reject(new Error("Item not found"));
        item.groupId = targetGroupId || null;
        item.updated = Date.now();
        delete item.sortOrder;
        const updateReq = store.put(item);
        updateReq.onsuccess = () => {
          if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
          resolve(item);
        };
        updateReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  },

  moveGroupToParent(groupId, targetParentGroupId) {
    return new Promise(async (resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      if (groupId === targetParentGroupId) return resolve();
      
      try {
        const allItems = await DBService.getAllItems();
        // Prevent cyclic nesting
        let curr = targetParentGroupId;
        while (curr) {
          if (curr === groupId) {
            return reject(new Error("Cannot nest a group inside its own child group."));
          }
          const parentGrp = allItems.find(i => i.id === curr && i.type === 'group');
          curr = parentGrp ? parentGrp.parentGroupId : null;
        }
        
        const transaction = db.transaction(['items'], 'readwrite');
        const store = transaction.objectStore('items');
        const getReq = store.get(groupId);
        
        getReq.onsuccess = () => {
          const group = getReq.result;
          if (!group) return reject(new Error("Group not found"));
          group.parentGroupId = targetParentGroupId || null;
          group.updated = Date.now();
          delete group.sortOrder;
          const updateReq = store.put(group);
          updateReq.onsuccess = () => {
            if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
            resolve(group);
          };
          updateReq.onerror = (e) => reject(e.target.error);
        };
        getReq.onerror = (e) => reject(e.target.error);
      } catch (err) {
        reject(err);
      }
    });
  },

  importBackupData(collectionsData) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['collections', 'items'], 'readwrite');
      const colStore = transaction.objectStore('collections');
      const itemStore = transaction.objectStore('items');
      
      let collectionsImported = 0;
      let itemsImported = 0;
      
      transaction.onerror = (e) => reject(e.target.error);
      transaction.oncomplete = () => resolve({ collectionsImported, itemsImported });
      
      collectionsData.forEach((group, index) => {
        const colId = generateId() + '_' + index;
        const collection = {
          id: colId,
          name: group.name,
          created: Date.now() - (collectionsData.length - index) * 1000 // slightly spacing creation times
        };
        colStore.add(collection);
        collectionsImported++;
        
        // Map old group IDs to new group IDs for integrity
        const groupIdMap = {};
        if (Array.isArray(group.items)) {
          group.items.forEach((item, itemIndex) => {
            if (item.type === 'group') {
              const newGrpId = 'grp_' + generateId() + '_' + index + '_' + itemIndex;
              if (item.id) {
                groupIdMap[item.id] = newGrpId;
              }
            }
          });

          group.items.forEach((item, itemIndex) => {
            const isGroup = item.type === 'group';
            const itemStoreObj = {
              id: isGroup && item.id && groupIdMap[item.id] ? groupIdMap[item.id] : generateId() + '_' + index + '_' + itemIndex,
              collectionId: colId,
              created: Date.now() - (group.items.length - itemIndex) * 10
            };
            
            if (isGroup) {
              itemStoreObj.type = 'group';
              itemStoreObj.title = item.title || 'Tab Group';
              itemStoreObj.parentGroupId = item.parentGroupId && groupIdMap[item.parentGroupId] ? groupIdMap[item.parentGroupId] : null;
              itemStoreObj.color = item.color || 'blue';
              itemStoreObj.collapsed = !!item.collapsed;
            } else if (item.type === 'note') {
              itemStoreObj.type = 'note';
              itemStoreObj.content = item.content || '';
              itemStoreObj.color = item.color || 'yellow';
              itemStoreObj.groupId = item.groupId && groupIdMap[item.groupId] ? groupIdMap[item.groupId] : null;
            } else {
              itemStoreObj.type = 'link';
              itemStoreObj.title = item.title || "Untitled";
              itemStoreObj.url = item.url;
              itemStoreObj.favicon = item.favicon || "";
              itemStoreObj.thumbnail = item.thumbnail || "";
              itemStoreObj.linkNote = item.linkNote || "";
              itemStoreObj.itemTheme = item.itemTheme || "";
              itemStoreObj.groupId = item.groupId && groupIdMap[item.groupId] ? groupIdMap[item.groupId] : null;
            }
            
            itemStore.add(itemStoreObj);
            itemsImported++;
          });
        }
      });
    });
  },
 
  exportBackupData() {
    return new Promise(async (resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      try {
        const collections = await new Promise((res, rej) => {
          const tx = db.transaction(['collections'], 'readonly');
          const store = tx.objectStore('collections');
          const req = store.getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror = () => rej(req.error);
        });
        
        const items = await new Promise((res, rej) => {
          const tx = db.transaction(['items'], 'readonly');
          const store = tx.objectStore('items');
          const req = store.getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror = () => rej(req.error);
        });
        
        // Group items by collectionId
        const itemsMap = {};
        items.forEach(item => {
          if (!itemsMap[item.collectionId]) {
            itemsMap[item.collectionId] = [];
          }
          if (item.type === 'group') {
            itemsMap[item.collectionId].push({
              id: item.id,
              type: 'group',
              title: item.title,
              parentGroupId: item.parentGroupId || null,
              color: item.color || 'blue',
              collapsed: !!item.collapsed
            });
          } else if (item.type === 'note') {
            itemsMap[item.collectionId].push({
              type: 'note',
              content: item.content,
              color: item.color || 'yellow',
              groupId: item.groupId || null
            });
          } else {
            itemsMap[item.collectionId].push({
              type: 'link',
              title: item.title,
              url: item.url,
              favicon: item.favicon || "",
              thumbnail: item.thumbnail || "",
              linkNote: item.linkNote || "",
              itemTheme: item.itemTheme || "",
              groupId: item.groupId || null
            });
          }
        });
        
        // Build export payload
        const result = collections.map(col => ({
          name: col.name,
          items: itemsMap[col.id] || []
        }));
        
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  }
};

// --- Reordering and Move Operations ---
async function reorderCollections(draggedId, targetId) {
  if (!db) return;
  const collections = await DBService.getAllCollections();
  const draggedIdx = collections.findIndex(c => c.id === draggedId);
  const targetIdx = collections.findIndex(c => c.id === targetId);
  if (draggedIdx === -1 || targetIdx === -1) return;
  
  const [draggedCol] = collections.splice(draggedIdx, 1);
  collections.splice(targetIdx, 0, draggedCol);
  
  const transaction = db.transaction(['collections'], 'readwrite');
  const store = transaction.objectStore('collections');
  const now = Date.now();
  
  for (let i = 0; i < collections.length; i++) {
    collections[i].sortOrder = i;
    collections[i].updated = now;
    store.put(collections[i]);
  }
  if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
}

async function reorderItems(collectionId, draggedId, targetId) {
  if (!db) return;
  const items = await DBService.getItems(collectionId);
  const draggedIdx = items.findIndex(i => i.id === draggedId);
  const targetIdx = items.findIndex(i => i.id === targetId);
  if (draggedIdx === -1 || targetIdx === -1) return;
  
  const targetItem = items[targetIdx];
  const [draggedItem] = items.splice(draggedIdx, 1);
  
  if (draggedItem.type !== 'group' && targetItem) {
    draggedItem.groupId = targetItem.type === 'group' ? targetItem.id : (targetItem.groupId || null);
  }
  
  items.splice(targetIdx, 0, draggedItem);
  
  const transaction = db.transaction(['items'], 'readwrite');
  const store = transaction.objectStore('items');
  const now = Date.now();
  
  for (let i = 0; i < items.length; i++) {
    items[i].sortOrder = i;
    items[i].updated = now;
    store.put(items[i]);
  }
  if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
}

async function moveItemToCollection(itemId, targetCollectionId) {
  if (!db) return;
  const transaction = db.transaction(['items'], 'readwrite');
  const store = transaction.objectStore('items');
  
  return new Promise((resolve, reject) => {
    const getReq = store.get(itemId);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (!item) return reject(new Error("Item not found"));
      
      item.collectionId = targetCollectionId;
      item.updated = Date.now();
      delete item.sortOrder; // falls back to newest inside the target collection
      
      const updateReq = store.put(item);
      updateReq.onsuccess = () => {
        if (typeof SyncService !== 'undefined') SyncService.scheduleSync();
        resolve(item);
      };
      updateReq.onerror = (e) => reject(e.target.error);
    };
    getReq.onerror = (e) => reject(e.target.error);
  });
}

// --- DOM and Event Listeners Setup ---
async function initApp() {
  try {
    setupEventListeners();

    await DBService.init();
    await checkProStatusOnStartup();
    
    if (typeof SupabaseClient !== 'undefined') {
      await SupabaseClient.init();
    }
    initCloudSyncUI();

    // Check if the pin extension banner should be shown
    if (!localStorage.getItem('pin-banner-dismissed')) {
      const banner = document.getElementById('pin-extension-banner');
      if (banner) {
        banner.classList.remove('hidden');
      }
    }

    await render();

    if (typeof SupabaseClient !== 'undefined' && SupabaseClient.isAuthenticated() && typeof SyncService !== 'undefined') {
      SyncService.sync().catch(err => console.warn('Initial cloud sync failed:', err));
    }
  } catch (err) {
    console.error("Initialization failed:", err);
    showToast("Error initializing local storage.");
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

function setupEventListeners() {
  // Pin Banner Dismissal
  const closePinBannerBtn = document.getElementById('close-pin-banner-btn');
  if (closePinBannerBtn) {
    closePinBannerBtn.addEventListener('click', () => {
      const banner = document.getElementById('pin-extension-banner');
      if (banner) {
        banner.classList.add('hidden');
      }
      localStorage.setItem('pin-banner-dismissed', 'true');
    });
  }
  // Navigation
  const backBtn = document.getElementById('back-button');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      setView('master');
    });
    
    backBtn.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    
    backBtn.addEventListener('dragenter', () => {
      if (draggedType === 'item' && currentView === 'detail') {
        backBtn.classList.add('drag-hover');
        if (backDragTimeout) clearTimeout(backDragTimeout);
        backDragTimeout = setTimeout(() => {
          setView('master');
          backBtn.classList.remove('drag-hover');
        }, 600);
      }
    });
    
    backBtn.addEventListener('dragleave', () => {
      backBtn.classList.remove('drag-hover');
      if (backDragTimeout) {
        clearTimeout(backDragTimeout);
        backDragTimeout = null;
      }
    });
  }

  // Action Bar Buttons
  document.getElementById('add-current-tab-btn').addEventListener('click', () => handleAddCurrentTab());
  
  const addNoteBtn = document.getElementById('add-note-btn');
  if (addNoteBtn) {
    addNoteBtn.addEventListener('click', handleAddNote);
  }
  
  const toggleViewBtn = document.getElementById('toggle-view-btn');
  if (toggleViewBtn) {
    toggleViewBtn.addEventListener('click', handleToggleView);
  }
  
  const selectItemsBtn = document.getElementById('select-items-btn');
  if (selectItemsBtn) {
    selectItemsBtn.addEventListener('click', handleToggleSelectionMode);
  }
  
  const selectAllBtn = document.getElementById('select-all-btn');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', handleSelectAll);
  }
  
  // Bulk Actions
  const bulkOpenBtn = document.getElementById('bulk-open-btn');
  if (bulkOpenBtn) bulkOpenBtn.addEventListener('click', handleBulkOpen);
  
  const bulkCopyBtn = document.getElementById('bulk-copy-btn');
  if (bulkCopyBtn) bulkCopyBtn.addEventListener('click', handleBulkCopy);
  
  const bulkMoveBtn = document.getElementById('bulk-move-btn');
  if (bulkMoveBtn) bulkMoveBtn.addEventListener('click', handleBulkMove);
  
  const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
  if (bulkDeleteBtn) bulkDeleteBtn.addEventListener('click', handleBulkDelete);
  
  const closeMoveModalBtn = document.getElementById('close-move-modal-btn');
  if (closeMoveModalBtn) {
    closeMoveModalBtn.addEventListener('click', () => {
      document.getElementById('move-modal').classList.add('hidden');
    });
  }

  const clearSearchBtn = document.getElementById('clear-search-btn');
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      const searchInput = document.getElementById('search-input');
      if (searchInput) {
        searchInput.value = '';
        handleSearch({ target: searchInput });
      }
    });
  }
  
  const createBtn = document.getElementById('create-collection-btn');
  const emptyCreateBtn = document.getElementById('empty-state-create-btn');
  
  const toggleCreateForm = () => {
    const form = document.getElementById('inline-creation-form');
    const input = document.getElementById('new-collection-input');
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) {
      input.value = '';
      input.focus();
    }
  };
  
  createBtn.addEventListener('click', toggleCreateForm);
  emptyCreateBtn.addEventListener('click', toggleCreateForm);

  document.getElementById('cancel-new-collection-btn').addEventListener('click', () => {
    document.getElementById('inline-creation-form').classList.add('hidden');
  });

  document.getElementById('save-new-collection-btn').addEventListener('click', handleCreateCollection);
  document.getElementById('new-collection-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleCreateCollection();
    if (e.key === 'Escape') document.getElementById('inline-creation-form').classList.add('hidden');
  });

  // Tab Group Creation Form wiring
  const addTabGroupBtn = document.getElementById('add-tab-group-btn');
  if (addTabGroupBtn) {
    addTabGroupBtn.addEventListener('click', () => {
      toggleTabGroupForm();
    });
  }

  const cancelNewTabGroupBtn = document.getElementById('cancel-new-tab-group-btn');
  if (cancelNewTabGroupBtn) {
    cancelNewTabGroupBtn.addEventListener('click', () => {
      document.getElementById('inline-tab-group-form').classList.add('hidden');
    });
  }

  const saveNewTabGroupBtn = document.getElementById('save-new-tab-group-btn');
  if (saveNewTabGroupBtn) {
    saveNewTabGroupBtn.addEventListener('click', handleCreateTabGroup);
  }

  const newTabGroupInput = document.getElementById('new-tab-group-input');
  if (newTabGroupInput) {
    newTabGroupInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleCreateTabGroup();
      if (e.key === 'Escape') document.getElementById('inline-tab-group-form').classList.add('hidden');
    });
  }

  // Dropdown Menu Toggling
  const menuTrigger = document.getElementById('menu-trigger-btn');
  const dropdownMenu = document.getElementById('more-actions-menu');
  
  if (menuTrigger && dropdownMenu) {
    menuTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('hidden');
    });
    
    document.addEventListener('click', (e) => {
      if (!dropdownMenu.classList.contains('hidden') && !e.target.closest('#more-actions-menu') && !e.target.closest('#menu-trigger-btn')) {
        dropdownMenu.classList.add('hidden');
      }
    });
  }

  // Backup file input
  const fileInput = document.getElementById('backup-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', handleImportBackup);
  }

  // Dropdown Menu Item Event Listeners
  const menuBingImport = document.getElementById('menu-bing-import');
  const menuPasteImport = document.getElementById('menu-paste-import');
  const menuFileImport = document.getElementById('menu-file-import');
  const menuFileExport = document.getElementById('menu-file-export');

  if (menuBingImport) {
    menuBingImport.addEventListener('click', () => {
      dropdownMenu.classList.add('hidden');
      if (!isProUser) {
        showPaywallModal();
        return;
      }
      handleBingImportButtonClick();
    });
  }

  const clipboardModal = document.getElementById('clipboard-modal');
  const pasteArea = document.getElementById('paste-area');
  const pasteNameInput = document.getElementById('paste-collection-name');
  const confirmClipboardBtn = document.getElementById('confirm-clipboard-import-btn');

  if (menuPasteImport) {
    menuPasteImport.addEventListener('click', () => {
      dropdownMenu.classList.add('hidden');
      pasteArea.innerHTML = '';
      pasteNameInput.value = '';
      document.getElementById('detected-links-count').textContent = 'No links detected yet';
      document.getElementById('detected-links-count').className = 'modal-status';
      confirmClipboardBtn.disabled = true;
      clipboardModal.classList.remove('hidden');
      pasteArea.focus();
    });
  }

  if (menuFileImport && fileInput) {
    menuFileImport.addEventListener('click', () => {
      dropdownMenu.classList.add('hidden');
      fileInput.click();
    });
  }

  if (menuFileExport) {
    menuFileExport.addEventListener('click', () => {
      dropdownMenu.classList.add('hidden');
      handleExportBackup();
    });
  }

  // Clipboard Paste Modal controls
  const closeClipboardBtn = document.getElementById('close-clipboard-modal-btn');
  const cancelClipboardBtn = document.getElementById('cancel-clipboard-import-btn');

  const hideClipboardModal = () => {
    clipboardModal.classList.add('hidden');
  };

  if (closeClipboardBtn) closeClipboardBtn.addEventListener('click', hideClipboardModal);
  if (cancelClipboardBtn) cancelClipboardBtn.addEventListener('click', hideClipboardModal);

  // Parse paste area content as you type/paste
  if (pasteArea) {
    pasteArea.addEventListener('input', handlePasteAreaInput);
    pasteArea.addEventListener('paste', () => {
      setTimeout(handlePasteAreaInput, 50);
    });
  }

  if (confirmClipboardBtn) {
    confirmClipboardBtn.addEventListener('click', handleConfirmClipboardImport);
  }

  // Search Input
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', handleSearch);
  }

  // Collection Details View Actions
  const editNameBtn = document.getElementById('edit-collection-name-btn');
  if (editNameBtn) {
    editNameBtn.addEventListener('click', () => {
      const nameHeading = document.getElementById('active-collection-name');
      const renameForm = document.getElementById('rename-collection-form');
      const renameInput = document.getElementById('rename-collection-input');
      
      nameHeading.classList.add('hidden');
      renameForm.classList.remove('hidden');
      renameInput.value = nameHeading.textContent;
      renameInput.focus();
      renameInput.select();
    });
  }

  const cancelRenameBtn = document.getElementById('cancel-rename-btn');
  if (cancelRenameBtn) {
    cancelRenameBtn.addEventListener('click', () => {
      document.getElementById('active-collection-name').classList.remove('hidden');
      document.getElementById('rename-collection-form').classList.add('hidden');
    });
  }

  const saveRenameBtn = document.getElementById('save-rename-btn');
  if (saveRenameBtn) {
    saveRenameBtn.addEventListener('click', handleRenameCollection);
  }

  const renameInput = document.getElementById('rename-collection-input');
  if (renameInput) {
    renameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleRenameCollection();
      if (e.key === 'Escape') {
        document.getElementById('active-collection-name').classList.remove('hidden');
        document.getElementById('rename-collection-form').classList.add('hidden');
      }
    });
  }

  const deleteColBtn = document.getElementById('delete-collection-btn');
  if (deleteColBtn) {
    deleteColBtn.addEventListener('click', handleDeleteCollection);
  }

  // Bing Saves Import Modal Event Listeners
  const closeBingBtn = document.getElementById('close-bing-modal-btn');
  const cancelBingBtn = document.getElementById('cancel-bing-import-btn');
  const startBingBtn = document.getElementById('start-bing-import-btn');
  const openBingBtn = document.getElementById('open-bing-saves-btn');

  if (closeBingBtn) closeBingBtn.addEventListener('click', handleCloseBingModal);
  if (cancelBingBtn) cancelBingBtn.addEventListener('click', handleCloseBingModal);
  if (startBingBtn) startBingBtn.addEventListener('click', handleStartBingImport);
  if (openBingBtn) {
    openBingBtn.addEventListener('click', () => {
      if (chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: 'https://www.bing.com/saves' });
      } else {
        window.open('https://www.bing.com/saves', '_blank');
      }
    });
  }

  // Dismiss collection color picker popover on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.color-picker-popover') && !e.target.closest('.change-color-btn')) {
      document.querySelectorAll('.color-picker-popover').forEach(el => el.remove());
    }
  });

  // Gumroad Paywall Modal controls
  const buyProBtn = document.getElementById('buy-pro-btn');
  if (buyProBtn) {
    buyProBtn.href = GUMROAD_PRODUCT_URL;
  }

  const promoFooterBuyBtn = document.getElementById('promo-footer-buy-btn');
  if (promoFooterBuyBtn) {
    promoFooterBuyBtn.href = GUMROAD_PRODUCT_URL;
  }

  const closePaywallBtn = document.getElementById('close-paywall-modal-btn');
  if (closePaywallBtn) {
    closePaywallBtn.addEventListener('click', () => {
      document.getElementById('paywall-modal').classList.add('hidden');
    });
  }
  
  const activateProBtn = document.getElementById('activate-pro-btn');
  if (activateProBtn) {
    activateProBtn.addEventListener('click', async () => {
      const input = document.getElementById('license-input');
      const key = input ? input.value.trim() : '';
      if (!key) {
        const statusMsg = document.getElementById('paywall-status-message');
        if (statusMsg) {
          statusMsg.className = 'paywall-error-text';
          statusMsg.style.display = 'block';
          statusMsg.style.color = 'var(--danger-color)';
          statusMsg.textContent = 'Please enter a license key.';
        }
        return;
      }
      activateProBtn.disabled = true;
      await verifyGumroadLicense(key);
      activateProBtn.disabled = false;
    });
  }
}

// --- View Router ---
function setView(view, collectionId = null) {
  currentView = view;
  activeCollectionId = collectionId;
  
  // Reset selection states
  selectionModeActive = false;
  selectedItemIds.clear();
  const selectItemsBtn = document.getElementById('select-items-btn');
  if (selectItemsBtn) selectItemsBtn.classList.remove('active');
  const selectAllBtn = document.getElementById('select-all-btn');
  if (selectAllBtn) selectAllBtn.classList.add('hidden');
  updateBulkActionsBar();

  const backBtn = document.getElementById('back-button');
  const viewTitle = document.getElementById('view-title');
  const masterPanel = document.getElementById('collections-list-view');
  const detailPanel = document.getElementById('collection-items-view');
  const searchInput = document.getElementById('search-input');
  const inlineForm = document.getElementById('inline-creation-form');
  const addNoteBtn = document.getElementById('add-note-btn');
  const createCollectionBtn = document.getElementById('create-collection-btn');
  
  const searchResultsPanel = document.getElementById('search-results-view');
  if (searchResultsPanel) searchResultsPanel.classList.add('hidden');
  
  preSearchView = null;
  inlineForm.classList.add('hidden');
  const addTabGroupBtn = document.getElementById('add-tab-group-btn');
  const inlineTabGroupForm = document.getElementById('inline-tab-group-form');
  if (inlineTabGroupForm) inlineTabGroupForm.classList.add('hidden');
  searchInput.value = '';

  if (view === 'master') {
    backBtn.classList.add('hidden');
    viewTitle.textContent = "Collections";
    masterPanel.classList.remove('hidden');
    detailPanel.classList.add('hidden');
    searchInput.placeholder = "Search collections...";
    if (addNoteBtn) addNoteBtn.classList.add('hidden');
    if (addTabGroupBtn) addTabGroupBtn.classList.add('hidden');
    if (createCollectionBtn) createCollectionBtn.classList.remove('hidden');
  } else if (view === 'detail') {
    backBtn.classList.remove('hidden');
    masterPanel.classList.add('hidden');
    detailPanel.classList.remove('hidden');
    searchInput.placeholder = "Search items...";
    if (addNoteBtn) addNoteBtn.classList.remove('hidden');
    if (addTabGroupBtn) addTabGroupBtn.classList.remove('hidden');
    if (createCollectionBtn) createCollectionBtn.classList.add('hidden');
  }
  
  render();
}

// --- Render Controller ---
async function render() {
  if (currentView === 'master') {
    await renderCollectionsList();
  } else if (currentView === 'detail' && activeCollectionId) {
    await renderCollectionDetails();
  }
}

// Render Master View (List of collections)
async function renderCollectionsList() {
  const container = document.getElementById('collections-container');
  const emptyState = document.getElementById('collections-empty-state');
  
  try {
    collectionsList = await DBService.getAllCollections();
    
    // Clear list
    container.innerHTML = '';
    
    if (collectionsList.length === 0) {
      emptyState.classList.remove('hidden');
      container.classList.add('hidden');
      return;
    }
    
    emptyState.classList.add('hidden');
    container.classList.remove('hidden');
    
    // Apply search filter if active
    const searchVal = document.getElementById('search-input').value.toLowerCase().trim();
    const filteredCols = collectionsList.filter(col => col.name.toLowerCase().includes(searchVal));
    
    filteredCols.forEach(col => {
      const card = document.createElement('div');
      card.className = `collection-card col-color-${col.color || 'blue'}`;
      card.dataset.id = col.id;
      
      card.innerHTML = `
        <div class="collection-card-left">
          <div class="collection-icon-box">
            <svg class="icon-inline" viewBox="0 0 24 24" width="20" height="20">
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
          </div>
          <div class="collection-info">
            <span class="collection-name" title="${escapeHTML(col.name)}">${escapeHTML(col.name)}</span>
            <span class="collection-count">${col.count} ${col.count === 1 ? 'item' : 'items'}</span>
          </div>
        </div>
        <div class="collection-card-actions">
          <button class="icon-button-small change-color-btn" title="Change Color" data-id="${col.id}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
            </svg>
          </button>
          <button class="icon-button-small delete-col-shortcut" title="Delete Collection" data-id="${col.id}">
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      `;
      
      // Click to open collection
      card.addEventListener('click', (e) => {
        // Prevent opening if clicking shortcut delete, palette button, or popover
        if (e.target.closest('.delete-col-shortcut') || e.target.closest('.change-color-btn') || e.target.closest('.color-picker-popover')) return;
        setView('detail', col.id);
      });

      // Color change listener
      const changeColorBtn = card.querySelector('.change-color-btn');
      if (changeColorBtn) {
        changeColorBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          
          if (!isProUser) {
            showPaywallModal();
            return;
          }
          
          const actions = card.querySelector('.collection-card-actions');
          const existingPopover = actions ? actions.querySelector('.color-picker-popover') : null;
          if (existingPopover) {
            existingPopover.remove();
            return;
          }
          
          document.querySelectorAll('.color-picker-popover').forEach(el => el.remove());
          
          const popover = document.createElement('div');
          popover.className = 'color-picker-popover collection-color-popover';
          
          const colors = ['blue', 'purple', 'red', 'green', 'orange'];
          colors.forEach(color => {
            const btn = document.createElement('button');
            btn.className = `color-dot-btn btn-${color} ${col.color === color || (!col.color && color === 'blue') ? 'active' : ''}`;
            btn.title = color.charAt(0).toUpperCase() + color.slice(1);
            btn.addEventListener('click', async (evt) => {
              evt.stopPropagation();
              await DBService.updateCollectionColor(col.id, color);
              showToast(`Collection color updated to ${color}`);
              render();
            });
            popover.appendChild(btn);
          });
          
          if (actions) {
            actions.appendChild(popover);
          }
        });
      }
      
      // Shortcut delete listener
      card.querySelector('.delete-col-shortcut').addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        const name = col.name;
        if (confirm(`Are you sure you want to delete the collection "${name}" and all its saved items?`)) {
          await DBService.deleteCollection(id);
          showToast(`Deleted "${name}"`);
          render();
        }
      });
      
      // Drag and drop setup for reordering collections and moving items into collections
      card.setAttribute('draggable', 'true');
      
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        draggedCollectionId = col.id;
        draggedType = 'collection';
        e.dataTransfer.effectAllowed = 'move';
      });
      
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        draggedCollectionId = null;
        draggedType = null;
        document.querySelectorAll('.collection-card').forEach(el => el.classList.remove('drag-hover'));
      });
      
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (draggedType === 'collection' && draggedCollectionId !== col.id) {
          card.classList.add('drag-hover');
        } else if (draggedType === 'item') {
          card.classList.add('drag-hover');
        }
      });
      
      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-hover');
      });
      
      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        card.classList.remove('drag-hover');
        
        if (draggedType === 'collection' && draggedCollectionId && draggedCollectionId !== col.id) {
          await reorderCollections(draggedCollectionId, col.id);
          render();
        } else if (draggedType === 'item' && draggedItemId) {
          await moveItemToCollection(draggedItemId, col.id);
          showToast(`Moved item to "${col.name}"`);
          render();
        }
      });
      
      container.appendChild(card);
    });
  } catch (err) {
    console.error("Render collections error:", err);
  }
}

// Render Detail View (List of items in a single collection)
async function renderCollectionDetails() {
  const container = document.getElementById('items-container');
  const emptyState = document.getElementById('items-empty-state');
  const titleHeading = document.getElementById('active-collection-name');
  
  // Apply Grid/List view preference layout class
  const pref = localStorage.getItem('collections_view_pref') || 'grid';
  updateViewPrefUI(pref);
  
  // Update select buttons visibility
  const selectItemsBtn = document.getElementById('select-items-btn');
  const selectAllBtn = document.getElementById('select-all-btn');
  
  if (selectItemsBtn) {
    if (selectionModeActive) {
      selectItemsBtn.classList.add('active');
      selectItemsBtn.title = "Cancel Selection";
      if (selectAllBtn) {
        selectAllBtn.classList.remove('hidden');
        // Check if all items are selected
        const allItemIds = activeCollectionItems.map(item => item.id);
        const allSelected = allItemIds.length > 0 && allItemIds.every(id => selectedItemIds.has(id));
        selectAllBtn.textContent = allSelected ? "Deselect All" : "Select All";
      }
    } else {
      selectItemsBtn.classList.remove('active');
      selectItemsBtn.title = "Select Items";
      if (selectAllBtn) selectAllBtn.classList.add('hidden');
    }
  }
  
  updateBulkActionsBar();
  
  try {
    // Refresh collection metadata (for name/rename sync)
    const collections = await DBService.getAllCollections();
    const activeCol = collections.find(c => c.id === activeCollectionId);
    
    if (!activeCol) {
      // Collection deleted elsewhere
      setView('master');
      return;
    }
    
    const detailPanel = document.getElementById('collection-items-view');
    if (detailPanel) {
      detailPanel.className = 'view-panel col-color-' + (activeCol.color || 'blue');
    }

    const detailColorPicker = document.getElementById('detail-color-picker');
    if (detailColorPicker) {
      detailColorPicker.innerHTML = '';
      const colors = ['blue', 'purple', 'red', 'green', 'orange'];
      const activeColor = activeCol.color || 'blue';

      const label = document.createElement('span');
      label.className = 'detail-color-label';
      label.textContent = 'Theme';
      detailColorPicker.appendChild(label);

      const themeBtn = document.createElement('button');
      themeBtn.className = `detail-color-menu-btn change-color-btn btn-${activeColor}`;
      themeBtn.type = 'button';
      themeBtn.title = 'Change collection theme';
      themeBtn.setAttribute('aria-label', 'Change collection theme');
      themeBtn.innerHTML = `
        <span class="detail-color-current"></span>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M7 10l5 5 5-5H7z"/>
        </svg>
      `;
      themeBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        const existingPopover = detailColorPicker.querySelector('.color-picker-popover');
        document.querySelectorAll('.color-picker-popover').forEach(el => el.remove());
        if (existingPopover) return;

        const popover = document.createElement('div');
        popover.className = 'color-picker-popover detail-color-popover';

        colors.forEach(color => {
          const btn = document.createElement('button');
          btn.className = `color-dot-btn btn-${color} ${activeColor === color ? 'active' : ''}`;
          btn.title = color.charAt(0).toUpperCase() + color.slice(1);
          btn.type = 'button';
          btn.addEventListener('click', async (event) => {
            event.stopPropagation();

            if (!isProUser) {
              showPaywallModal();
              return;
            }

            await DBService.updateCollectionColor(activeCol.id, color);
            showToast(`Theme updated to ${color}`);
            render();
          });
          popover.appendChild(btn);
        });

        detailColorPicker.appendChild(popover);
      });

      detailColorPicker.appendChild(themeBtn);
    }

    titleHeading.textContent = activeCol.name;
    document.getElementById('view-title').textContent = activeCol.name;
    
    activeCollectionItems = await DBService.getItems(activeCollectionId);
    
    // Clear list
    container.innerHTML = '';
    
    if (activeCollectionItems.length === 0) {
      emptyState.classList.remove('hidden');
      container.classList.add('hidden');
      return;
    }
    
    emptyState.classList.add('hidden');
    container.classList.remove('hidden');
    
    // Apply search filter if active
    const searchVal = document.getElementById('search-input').value.toLowerCase().trim();
    
    // Separate groups and content items
    const allGroups = activeCollectionItems.filter(i => i.type === 'group');
    const allContentItems = activeCollectionItems.filter(i => i.type !== 'group');

    // Build hierarchy maps
    const groupMap = new Map();
    allGroups.forEach(g => {
      groupMap.set(g.id, {
        ...g,
        childGroups: [],
        items: []
      });
    });

    const rootGroups = [];
    allGroups.forEach(g => {
      const node = groupMap.get(g.id);
      if (g.parentGroupId && groupMap.has(g.parentGroupId)) {
        groupMap.get(g.parentGroupId).childGroups.push(node);
      } else {
        rootGroups.push(node);
      }
    });

    const ungroupedItems = [];
    allContentItems.forEach(item => {
      if (item.groupId && groupMap.has(item.groupId)) {
        groupMap.get(item.groupId).items.push(item);
      } else {
        ungroupedItems.push(item);
      }
    });

    // If search active, filter items and only keep matching groups/items
    if (searchVal) {
      const matchesSearch = (item) => {
        if (item.type === 'note') {
          return (item.content || "").toLowerCase().includes(searchVal);
        }
        return (item.title || "").toLowerCase().includes(searchVal) || 
               (item.url || "").toLowerCase().includes(searchVal) ||
               (item.linkNote || "").toLowerCase().includes(searchVal);
      };

      const filterNode = (node) => {
        node.items = node.items.filter(matchesSearch);
        node.childGroups = node.childGroups.filter(filterNode);
        const groupTitleMatch = (node.title || "").toLowerCase().includes(searchVal);
        if (groupTitleMatch) {
          // If group matches, auto-expand so user sees it
          node.collapsed = false;
        }
        return groupTitleMatch || node.items.length > 0 || node.childGroups.length > 0;
      };

      const filteredRoots = rootGroups.filter(filterNode);
      const filteredUngrouped = ungroupedItems.filter(matchesSearch);

      if (filteredRoots.length === 0 && filteredUngrouped.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding: 24px 0;"><p style="font-size: 12px; color: var(--text-secondary);">No items match "${escapeHTML(searchVal)}".</p></div>`;
        return;
      }

      filteredRoots.forEach(node => {
        container.appendChild(renderTabGroupNode(node, 0));
      });

      if (filteredUngrouped.length > 0) {
        const ungrContainer = document.createElement('div');
        ungrContainer.className = 'ungrouped-items-container';
        if (filteredRoots.length > 0) {
          const header = document.createElement('div');
          header.className = 'ungrouped-items-header';
          header.innerHTML = `<span>Ungrouped Items (${filteredUngrouped.length})</span>`;
          ungrContainer.appendChild(header);
        }
        filteredUngrouped.forEach(item => {
          if (item.type === 'note') ungrContainer.appendChild(createNoteCardElement(item));
          else ungrContainer.appendChild(createLinkCardElement(item));
        });
        container.appendChild(ungrContainer);
      }
      return;
    }

    // Normal rendering
    rootGroups.forEach(node => {
      container.appendChild(renderTabGroupNode(node, 0));
    });

    if (ungroupedItems.length > 0) {
      const ungrContainer = document.createElement('div');
      ungrContainer.className = 'ungrouped-items-container';
      if (rootGroups.length > 0) {
        const header = document.createElement('div');
        header.className = 'ungrouped-items-header';
        header.innerHTML = `<span>Ungrouped Tabs & Notes (${ungroupedItems.length})</span>`;
        ungrContainer.appendChild(header);
      }
      ungroupedItems.forEach(item => {
        if (item.type === 'note') ungrContainer.appendChild(createNoteCardElement(item));
        else ungrContainer.appendChild(createLinkCardElement(item));
      });
      container.appendChild(ungrContainer);
    }

    // Enable dropping directly on container or ungrouped header to un-group
    container.ondragover = (e) => {
      e.preventDefault();
      if (draggedType === 'item' || draggedType === 'group') {
        e.dataTransfer.dropEffect = 'move';
      }
    };

    container.ondrop = async (e) => {
      if (e.target === container || e.target.classList.contains('ungrouped-items-header') || e.target.closest('.ungrouped-items-header')) {
        e.preventDefault();
        if (draggedType === 'item' && draggedItemId) {
          await DBService.moveItemToGroup(draggedItemId, null);
          showToast("Moved to ungrouped");
          render();
        } else if (draggedType === 'group' && draggedGroupId) {
          await DBService.moveGroupToParent(draggedGroupId, null);
          showToast("Moved to root");
          render();
        }
      }
    };

  } catch (err) {
    console.error("Render items error:", err);
  }
}

// Calculate total items recursively inside a group node
function getGroupTotalCount(node) {
  let count = node.items ? node.items.length : 0;
  if (node.childGroups && node.childGroups.length > 0) {
    count += node.childGroups.reduce((sum, child) => sum + getGroupTotalCount(child), 0);
  }
  return count;
}

// Render Tab Group Tree Node
function renderTabGroupNode(groupNode, level = 0) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tab-group-wrapper';
  wrapper.dataset.groupId = groupNode.id;
  wrapper.dataset.level = level;
  if (groupNode.color) {
    wrapper.style.setProperty('--group-accent', `var(--col-${groupNode.color})`);
  }

  // Content body
  const content = document.createElement('div');
  const groupViewMode = groupNode.viewMode || 'list';
  content.className = `tab-group-content ${groupViewMode === 'grid' ? 'grid-view' : 'list-view'}${groupNode.collapsed ? ' collapsed' : ''}`;

  const totalCount = getGroupTotalCount(groupNode);

  const header = document.createElement('div');
  header.className = `tab-group-header group-header-color-${groupNode.color || 'blue'}`;
  header.setAttribute('draggable', 'true');

  header.innerHTML = `
    <button class="tab-group-collapse-btn ${groupNode.collapsed ? 'collapsed' : ''}" title="${groupNode.collapsed ? 'Expand group' : 'Collapse group'}">
      <svg viewBox="0 0 24 24" width="16" height="16">
        <path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
      </svg>
    </button>
    <div class="tab-group-color-indicator dot-${groupNode.color || 'blue'}" title="Change color"></div>
    <span class="tab-group-title" title="Click or double-click to rename">${escapeHTML(groupNode.title)}</span>
    <span class="tab-group-count">${totalCount}</span>
    <div class="tab-group-actions">
      <button class="icon-button-small tab-group-add-tab-btn" title="Add Current Tab to this Group">
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
        </svg>
      </button>
      <button class="icon-button-small tab-group-add-subgroup-btn" title="Add Sub-Group">
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path d="M20 6h-8l-2-2H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-1 8h-3v3h-2v-3h-3v-2h3V9h2v3h3v2z"/>
        </svg>
      </button>
      <button class="icon-button-small tab-group-view-btn" title="${(groupNode.viewMode || 'list') === 'grid' ? 'Switch to List View' : 'Switch to Grid View'}">
        <svg viewBox="0 0 24 24" width="13" height="13">
          ${(groupNode.viewMode || 'list') === 'grid' 
            ? '<path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>' 
            : '<path d="M4 11h5V5H4v6zm0 7h5v-6H4v6zm6 0h5v-6h-5v6zm6 0h5v-6h-5v6zm-6-7h5V5h-5v6zm6-6v6h5V5h-5z"/>'}
        </svg>
      </button>
      <button class="icon-button-small tab-group-color-btn" title="Change Color">
        <svg viewBox="0 0 24 24" width="13" height="13">
          <path d="M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
        </svg>
      </button>
      <button class="icon-button-small tab-group-delete-btn" title="Delete Group">
        <svg viewBox="0 0 24 24" width="13" height="13">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
        </svg>
      </button>
    </div>
  `;

  // Group View Mode toggle
  const viewBtn = header.querySelector('.tab-group-view-btn');
  if (viewBtn) {
    viewBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const currentMode = groupNode.viewMode || 'list';
      const newMode = currentMode === 'grid' ? 'list' : 'grid';
      groupNode.viewMode = newMode;
      await DBService.updateGroupViewMode(groupNode.id, newMode);
      render();
    });
  }

  // Collapse / Expand toggle
  const collapseBtn = header.querySelector('.tab-group-collapse-btn');
  const toggleCollapse = async (e) => {
    if (e) e.stopPropagation();
    const newCollapsed = !groupNode.collapsed;
    groupNode.collapsed = newCollapsed;
    await DBService.toggleGroupCollapse(groupNode.id, newCollapsed);
    content.classList.toggle('collapsed', newCollapsed);
    if (collapseBtn) {
      collapseBtn.classList.toggle('collapsed', newCollapsed);
      collapseBtn.title = newCollapsed ? "Expand group" : "Collapse group";
    }
  };
  collapseBtn.addEventListener('click', toggleCollapse);

  // Clicking header area toggles collapse as well
  header.addEventListener('click', (e) => {
    if (e.target.closest('.tab-group-actions') || 
        e.target.closest('.tab-group-color-indicator') || 
        e.target.closest('.color-picker-popover') || 
        e.target.closest('.tab-group-title-input') ||
        e.target.closest('.tab-group-collapse-btn')) {
      return;
    }
    toggleCollapse(e);
  });

  // Rename Title
  const titleEl = header.querySelector('.tab-group-title');
  const startRename = (e) => {
    e.stopPropagation();
    if (header.querySelector('.tab-group-title-input')) return;

    const currentTitle = groupNode.title;
    const input = document.createElement('input');
    input.className = 'tab-group-title-input';
    input.value = currentTitle;
    input.maxLength = 50;

    titleEl.classList.add('editing');
    header.insertBefore(input, header.querySelector('.tab-group-count'));
    input.focus();
    input.select();

    const saveRename = async () => {
      const val = input.value.trim();
      input.remove();
      titleEl.classList.remove('editing');
      if (val && val !== currentTitle) {
        groupNode.title = val;
        titleEl.textContent = val;
        await DBService.updateGroupTitle(groupNode.id, val);
        showToast("Group renamed");
      }
    };

    input.addEventListener('blur', saveRename);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        input.blur();
      } else if (ev.key === 'Escape') {
        input.value = currentTitle;
        input.blur();
      }
    });
  };
  titleEl.addEventListener('dblclick', startRename);

  // Color picker
  const colorIndicator = header.querySelector('.tab-group-color-indicator');
  const colorBtn = header.querySelector('.tab-group-color-btn');
  const openColorPicker = (e) => {
    e.stopPropagation();
    const actions = header.querySelector('.tab-group-actions');
    const existing = actions.querySelector('.tab-group-color-popover');
    if (existing) {
      existing.remove();
      return;
    }
    document.querySelectorAll('.color-picker-popover').forEach(el => el.remove());

    const popover = document.createElement('div');
    popover.className = 'color-picker-popover tab-group-color-popover';
    const colors = ['blue', 'purple', 'red', 'green', 'orange'];
    colors.forEach(color => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `color-dot-btn btn-${color} ${groupNode.color === color ? 'active' : ''}`;
      btn.title = color.charAt(0).toUpperCase() + color.slice(1);
      btn.addEventListener('click', async (evt) => {
        evt.stopPropagation();
        await DBService.updateGroupColor(groupNode.id, color);
        groupNode.color = color;
        popover.remove();
        showToast(`Group color updated to ${color}`);
        render();
      });
      popover.appendChild(btn);
    });
    actions.appendChild(popover);
  };
  colorIndicator.addEventListener('click', openColorPicker);
  colorBtn.addEventListener('click', openColorPicker);

  // Add tab to this group
  header.querySelector('.tab-group-add-tab-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    await handleAddCurrentTab(groupNode.id);
  });

  // Add sub-group
  header.querySelector('.tab-group-add-subgroup-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTabGroupForm(groupNode.id, groupNode.title);
  });

  // Delete Group
  header.querySelector('.tab-group-delete-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const count = getGroupTotalCount(groupNode);
    if (count > 0) {
      const keepItems = confirm(`Delete group "${groupNode.title}"?\n\n- Click OK to delete the group but KEEP all items (move to collection root).\n- Click Cancel to abort.`);
      if (keepItems) {
        await DBService.deleteGroup(groupNode.id, false);
        showToast("Group deleted (tabs retained)");
        render();
      }
    } else {
      await DBService.deleteGroup(groupNode.id, false);
      showToast("Group deleted");
      render();
    }
  });

  // Drag and Drop for Group Header
  header.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    wrapper.classList.add('dragging');
    draggedGroupId = groupNode.id;
    draggedType = 'group';
    e.dataTransfer.effectAllowed = 'move';
  });

  header.addEventListener('dragend', () => {
    wrapper.classList.remove('dragging');
    draggedGroupId = null;
    draggedType = null;
    document.querySelectorAll('.tab-group-wrapper').forEach(el => el.classList.remove('group-drag-hover', 'group-drop-nested-hover'));
  });

  // Drag and drop target on group wrapper
  wrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedType === 'item') {
      wrapper.classList.add('group-drag-hover');
    } else if (draggedType === 'group' && draggedGroupId !== groupNode.id) {
      wrapper.classList.add('group-drop-nested-hover');
    }
  });

  wrapper.addEventListener('dragleave', (e) => {
    if (!wrapper.contains(e.relatedTarget)) {
      wrapper.classList.remove('group-drag-hover', 'group-drop-nested-hover');
    }
  });

  wrapper.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    wrapper.classList.remove('group-drag-hover', 'group-drop-nested-hover');

    if (draggedType === 'item' && draggedItemId) {
      await DBService.moveItemToGroup(draggedItemId, groupNode.id);
      showToast(`Moved to "${groupNode.title}"`);
      render();
    } else if (draggedType === 'group' && draggedGroupId && draggedGroupId !== groupNode.id) {
      try {
        await DBService.moveGroupToParent(draggedGroupId, groupNode.id);
        showToast(`Nested into "${groupNode.title}"`);
        render();
      } catch (err) {
        showToast(err.message || "Cannot nest group.");
      }
    }
  });

  wrapper.appendChild(header);

  // Recursively render child groups
  if (groupNode.childGroups && groupNode.childGroups.length > 0) {
    groupNode.childGroups.forEach(child => {
      content.appendChild(renderTabGroupNode(child, level + 1));
    });
  }

  // Render items inside this group
  if (groupNode.items && groupNode.items.length > 0) {
    groupNode.items.forEach(item => {
      if (item.type === 'note') {
        content.appendChild(createNoteCardElement(item));
      } else {
        content.appendChild(createLinkCardElement(item));
      }
    });
  }

  // Empty drop hint if no children and no items
  if ((!groupNode.childGroups || groupNode.childGroups.length === 0) && (!groupNode.items || groupNode.items.length === 0)) {
    const hint = document.createElement('div');
    hint.className = 'tab-group-empty-hint';
    hint.textContent = 'Drop tabs here or click + Tab';
    content.appendChild(hint);
  }

  wrapper.appendChild(content);
  return wrapper;
}

// Helper: Create Note Card Element
function createNoteCardElement(item) {
  const card = document.createElement('div');
  card.className = `note-card note-${item.color || 'yellow'}`;
  card.dataset.id = item.id;
  
  const checkboxHTML = selectionModeActive ? `
    <div class="item-checkbox-wrapper">
      <input type="checkbox" class="item-checkbox" data-id="${item.id}" ${selectedItemIds.has(item.id) ? 'checked' : ''} />
    </div>
  ` : '';

  card.innerHTML = `
    ${checkboxHTML}
    <div class="note-content" contenteditable="${selectionModeActive ? 'false' : 'true'}" placeholder="Write a note...">${escapeHTML(item.content)}</div>
    <div class="note-footer">
      <div class="note-color-picker">
        <div class="color-dot dot-yellow ${item.color === 'yellow' || !item.color ? 'active' : ''}" data-color="yellow" title="Yellow"></div>
        <div class="color-dot dot-blue ${item.color === 'blue' ? 'active' : ''}" data-color="blue" title="Blue"></div>
        <div class="color-dot dot-green ${item.color === 'green' ? 'active' : ''}" data-color="green" title="Green"></div>
        <div class="color-dot dot-pink ${item.color === 'pink' ? 'active' : ''}" data-color="pink" title="Pink"></div>
        <div class="color-dot dot-purple ${item.color === 'purple' ? 'active' : ''}" data-color="purple" title="Purple"></div>
      </div>
      <button class="note-delete-btn" title="Delete Note">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
        </svg>
      </button>
    </div>
  `;
  
  const contentEl = card.querySelector('.note-content');
  
  card.addEventListener('click', (e) => {
    if (selectionModeActive) {
      e.preventDefault();
      e.stopPropagation();
      const checkbox = card.querySelector('.item-checkbox');
      if (checkbox) {
        checkbox.checked = !checkbox.checked;
        toggleItemSelection(item.id, checkbox.checked);
      }
    }
  });
  
  const checkboxEl = card.querySelector('.item-checkbox');
  if (checkboxEl) {
    checkboxEl.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleItemSelection(item.id, checkboxEl.checked);
    });
  }
  
  contentEl.addEventListener('blur', async () => {
    const newText = contentEl.innerText.trim();
    if (newText !== item.content) {
      await DBService.updateNoteContent(item.id, newText);
      item.content = newText;
      showToast("Note saved");
    }
  });
  
  contentEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && e.shiftKey)) {
      contentEl.blur();
      e.preventDefault();
    }
  });
  
  const dots = card.querySelectorAll('.color-dot');
  dots.forEach(dot => {
    dot.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newColor = dot.dataset.color;
      await DBService.updateNoteColor(item.id, newColor);
      
      dots.forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      
      card.className = `note-card note-${newColor}`;
      item.color = newColor;
      showToast("Color updated");
    });
  });
  
  card.querySelector('.note-delete-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this note?")) {
      await DBService.deleteItem(item.id);
      showToast("Removed note");
      render();
    }
  });
  
  card.setAttribute('draggable', 'true');
  
  card.addEventListener('dragstart', (e) => {
    card.classList.add('dragging');
    draggedItemId = item.id;
    draggedType = 'item';
    e.dataTransfer.effectAllowed = 'move';
  });
  
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    draggedItemId = null;
    draggedType = null;
    document.querySelectorAll('.item-card, .note-card').forEach(el => el.classList.remove('drag-hover'));
  });
  
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (draggedType === 'item' && draggedItemId !== item.id) {
      card.classList.add('drag-hover');
    }
  });
  
  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-hover');
  });
  
  card.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    card.classList.remove('drag-hover');
    
    if (draggedType === 'item' && draggedItemId && draggedItemId !== item.id) {
      await reorderItems(activeCollectionId, draggedItemId, item.id);
      render();
    }
  });
  
  return card;
}

// Helper: Create Link Card Element
function createLinkCardElement(item) {
  const card = document.createElement('div');
  card.className = `item-card ${item.itemTheme ? `item-theme-${item.itemTheme}` : ''}`;
  card.dataset.id = item.id;
  
  const domain = getDomainName(item.url);
  const formattedDate = new Date(item.created).toLocaleDateString(undefined, { 
    month: 'short', 
    day: 'numeric' 
  });
  
  let faviconSrc = "";
  if (chrome.runtime && chrome.runtime.id) {
    faviconSrc = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(item.url)}&size=32`;
  } else {
    faviconSrc = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  }

  const fallbackChar = domain ? domain[0].toUpperCase() : 'W';

  const checkboxHTML = selectionModeActive ? `
    <div class="item-checkbox-wrapper">
      <input type="checkbox" class="item-checkbox" data-id="${item.id}" ${selectedItemIds.has(item.id) ? 'checked' : ''} />
    </div>
  ` : '';

  card.innerHTML = `
    ${checkboxHTML}
    <div class="item-thumbnail-container">
      ${item.thumbnail ? `<img class="item-thumbnail" src="${escapeHTML(item.thumbnail)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />` : ''}
      <div class="thumbnail-fallback" style="${item.thumbnail ? 'display: none;' : ''}">
        <span>${fallbackChar}</span>
      </div>
    </div>
    <img class="item-favicon" src="${faviconSrc}" alt="" style="display:none;" 
      onload="this.style.display='inline-block'; if(this.nextElementSibling) this.nextElementSibling.style.display='none';" 
      onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-flex';" />
    <div class="item-favicon-fallback" style="display:inline-flex; width:16px; height:16px; align-items:center; justify-content:center; background:var(--primary-light); color:var(--primary-color); border-radius:2px; font-size:10px; font-weight:bold; margin-top:3px; flex-shrink:0;">
      ${domain ? domain[0].toUpperCase() : 'W'}
    </div>
    <div class="item-details">
      <a class="item-title" href="${escapeHTML(item.url)}" target="_blank" title="${escapeHTML(item.title)}">${escapeHTML(item.title)}</a>
      <div class="item-meta">
        <span class="item-domain">${escapeHTML(domain)}</span>
        <span>&bull;</span>
        <span class="item-date">${formattedDate}</span>
      </div>
      <div class="link-note-preview ${item.linkNote ? '' : 'hidden'}">${escapeHTML(item.linkNote || '')}</div>
    </div>
    <div class="item-actions">
      <button class="icon-button-small edit-link-note-btn ${item.linkNote ? 'has-note' : ''}" title="${item.linkNote ? 'Edit Tab Note' : 'Add Tab Note'}" data-id="${item.id}">
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/>
          <path d="M20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
        </svg>
      </button>
      <button class="icon-button-small change-item-theme-btn ${item.itemTheme ? 'has-theme' : ''}" title="Change Tab Color" data-id="${item.id}">
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path d="M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zM6.5 12C5.67 12 5 11.33 5 10.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
        </svg>
      </button>
      <button class="icon-button-small delete-item-btn" title="Delete Link" data-id="${item.id}">
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
        </svg>
      </button>
    </div>
    <div class="link-note-editor hidden">
      <textarea class="link-note-input" maxlength="500" placeholder="Add a note for this saved tab...">${escapeHTML(item.linkNote || '')}</textarea>
      <div class="link-note-actions">
        <button class="btn btn-secondary cancel-link-note-btn">Cancel</button>
        <button class="btn btn-primary save-link-note-btn">Save Note</button>
      </div>
    </div>
  `;
  
  card.addEventListener('click', (e) => {
    if (selectionModeActive) {
      e.preventDefault();
      e.stopPropagation();
      const checkbox = card.querySelector('.item-checkbox');
      if (checkbox) {
        checkbox.checked = !checkbox.checked;
        toggleItemSelection(item.id, checkbox.checked);
      }
      return;
    }
    if (e.target.closest('.delete-item-btn') || e.target.closest('.edit-link-note-btn') || e.target.closest('.change-item-theme-btn') || e.target.closest('.item-theme-popover') || e.target.closest('.link-note-editor')) return;
    if (window.getSelection().toString()) return;
    
    e.preventDefault();
    if (chrome.tabs) {
      chrome.tabs.create({ url: item.url });
    } else {
      window.open(item.url, '_blank');
    }
  });
  
  const checkboxEl = card.querySelector('.item-checkbox');
  if (checkboxEl) {
    checkboxEl.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleItemSelection(item.id, checkboxEl.checked);
    });
  }

  const noteEditor = card.querySelector('.link-note-editor');
  const noteInput = card.querySelector('.link-note-input');
  const notePreview = card.querySelector('.link-note-preview');
  const editNoteBtn = card.querySelector('.edit-link-note-btn');

  if (editNoteBtn && noteEditor && noteInput) {
    editNoteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      noteEditor.classList.toggle('hidden');
      if (!noteEditor.classList.contains('hidden')) {
        noteInput.focus();
        noteInput.setSelectionRange(noteInput.value.length, noteInput.value.length);
      }
    });
  }

  const saveNoteBtn = card.querySelector('.save-link-note-btn');
  if (saveNoteBtn && noteInput && noteEditor) {
    saveNoteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newNote = noteInput.value.trim();
      await DBService.updateLinkNote(item.id, newNote);
      item.linkNote = newNote;

      if (notePreview) {
        notePreview.textContent = newNote;
        notePreview.classList.toggle('hidden', !newNote);
      }
      if (editNoteBtn) {
        editNoteBtn.classList.toggle('has-note', !!newNote);
        editNoteBtn.title = newNote ? 'Edit Tab Note' : 'Add Tab Note';
      }

      noteEditor.classList.add('hidden');
      showToast(newNote ? 'Tab note saved' : 'Tab note cleared');
    });
  }

  const cancelNoteBtn = card.querySelector('.cancel-link-note-btn');
  if (cancelNoteBtn && noteInput && noteEditor) {
    cancelNoteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      noteInput.value = item.linkNote || '';
      noteEditor.classList.add('hidden');
    });
  }

  if (noteInput) {
    noteInput.addEventListener('click', (e) => e.stopPropagation());
    noteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        noteInput.value = item.linkNote || '';
        noteEditor.classList.add('hidden');
        e.preventDefault();
      }
    });
  }

  const themeBtn = card.querySelector('.change-item-theme-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', (e) => {
      e.stopPropagation();

      const existingPopover = card.querySelector('.item-theme-popover');
      if (existingPopover) {
        existingPopover.remove();
        return;
      }

      document.querySelectorAll('.item-theme-popover').forEach(el => el.remove());
      const popover = document.createElement('div');
      popover.className = 'item-theme-popover';
      const themes = [
        { id: '', label: 'Default' },
        { id: 'blue', label: 'Blue' },
        { id: 'green', label: 'Green' },
        { id: 'yellow', label: 'Yellow' },
        { id: 'pink', label: 'Pink' },
        { id: 'purple', label: 'Purple' }
      ];

      themes.forEach(theme => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `item-theme-dot item-theme-dot-${theme.id || 'default'} ${(item.itemTheme || '') === theme.id ? 'active' : ''}`;
        btn.title = theme.label;
        btn.addEventListener('click', async (event) => {
          event.stopPropagation();
          await DBService.updateItemTheme(item.id, theme.id);
          item.itemTheme = theme.id;

          card.className = `item-card ${theme.id ? `item-theme-${theme.id}` : ''}`;
          themeBtn.classList.toggle('has-theme', !!theme.id);
          popover.remove();
          showToast(theme.id ? `Tab color updated to ${theme.label}` : 'Tab color reset');
        });
        popover.appendChild(btn);
      });

      card.appendChild(popover);
    });
  }
  
  card.querySelector('.delete-item-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const id = e.currentTarget.dataset.id;
    await DBService.deleteItem(id);
    showToast("Removed item");
    render();
  });
  
  card.setAttribute('draggable', 'true');
  
  card.addEventListener('dragstart', (e) => {
    card.classList.add('dragging');
    draggedItemId = item.id;
    draggedType = 'item';
    e.dataTransfer.effectAllowed = 'move';
  });
  
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    draggedItemId = null;
    draggedType = null;
    document.querySelectorAll('.item-card, .note-card').forEach(el => el.classList.remove('drag-hover'));
  });
  
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (draggedType === 'item' && draggedItemId !== item.id) {
      card.classList.add('drag-hover');
    }
  });
  
  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-hover');
  });
  
  card.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    card.classList.remove('drag-hover');
    
    if (draggedType === 'item' && draggedItemId && draggedItemId !== item.id) {
      await reorderItems(activeCollectionId, draggedItemId, item.id);
      render();
    }
  });
  
  return card;
}

// --- Action Handlers ---

// Add Note
async function handleAddNote() {
  if (!activeCollectionId) return;
  try {
    const newNote = await DBService.addNote(activeCollectionId, "", "yellow");
    await render();
    // Focus the new note's contenteditable area
    const noteEl = document.querySelector(`.note-card[data-id="${newNote.id}"] .note-content`);
    if (noteEl) {
      noteEl.focus();
    }
  } catch (err) {
    console.error("Add note error:", err);
    showToast("Failed to add note.");
  }
}

// Create Collection
async function handleCreateCollection() {
  const input = document.getElementById('new-collection-input');
  const name = input.value.trim();
  
  if (!name) {
    showToast("Collection name cannot be empty.");
    return;
  }
  
  // Paywall check: Limit to 5 collections for free users
  if (!isProUser && collectionsList.length >= 5) {
    showPaywallModal();
    return;
  }

  try {
    const newCol = await DBService.addCollection(name);
    document.getElementById('inline-creation-form').classList.add('hidden');
    input.value = '';
    showToast(`Created "${name}"`);
    
    // Automatically navigate into the new collection to allow adding items right away
    setView('detail', newCol.id);
  } catch (err) {
    console.error("Create collection error:", err);
    showToast("Failed to create collection.");
  }
}

// Toggle Tab Group Creation Form
function toggleTabGroupForm(parentGroupId = null, parentTitle = '') {
  const form = document.getElementById('inline-tab-group-form');
  const input = document.getElementById('new-tab-group-input');
  const parentIdInput = document.getElementById('new-tab-group-parent-id');
  if (!form || !input) return;

  const isHidden = form.classList.contains('hidden');
  if (isHidden) {
    if (parentIdInput) parentIdInput.value = parentGroupId || '';
    input.value = '';
    input.placeholder = parentTitle ? `Sub-group in "${parentTitle}"...` : 'Enter tab group name...';
    form.classList.remove('hidden');
    input.focus();
  } else {
    // If already open, but user clicked "+ Sub-group" on a specific group
    if (parentGroupId && parentIdInput && parentIdInput.value !== parentGroupId) {
      parentIdInput.value = parentGroupId;
      input.value = '';
      input.placeholder = `Sub-group in "${parentTitle}"...`;
      input.focus();
    } else {
      form.classList.add('hidden');
      if (parentIdInput) parentIdInput.value = '';
      input.value = '';
    }
  }
}

// Create Tab Group
async function handleCreateTabGroup() {
  if (!activeCollectionId) {
    showToast("Please select a collection first.");
    return;
  }

  const input = document.getElementById('new-tab-group-input');
  const parentIdInput = document.getElementById('new-tab-group-parent-id');
  if (!input) return;

  const title = input.value.trim();
  if (!title) {
    showToast("Tab group name cannot be empty.");
    input.focus();
    return;
  }

  const parentGroupId = (parentIdInput && parentIdInput.value) ? parentIdInput.value : null;

  try {
    await DBService.addGroup(activeCollectionId, title, parentGroupId);
    const form = document.getElementById('inline-tab-group-form');
    if (form) form.classList.add('hidden');
    input.value = '';
    if (parentIdInput) parentIdInput.value = '';
    showToast(`Created tab group "${title}"`);
    await render();
  } catch (err) {
    console.error("Create tab group error:", err);
    showToast("Failed to create tab group.");
  }
}

// Rename Collection
async function handleRenameCollection() {
  const input = document.getElementById('rename-collection-input');
  const newName = input.value.trim();
  
  if (!newName) {
    showToast("Collection name cannot be empty.");
    return;
  }
  
  try {
    await DBService.updateCollectionName(activeCollectionId, newName);
    document.getElementById('active-collection-name').classList.remove('hidden');
    document.getElementById('rename-collection-form').classList.add('hidden');
    showToast("Collection renamed");
    render();
  } catch (err) {
    console.error("Rename collection error:", err);
    showToast("Failed to rename collection.");
  }
}

// Delete Collection
async function handleDeleteCollection() {
  const title = document.getElementById('active-collection-name').textContent;
  if (confirm(`Are you sure you want to delete the collection "${title}" and all its saved items?`)) {
    try {
      await DBService.deleteCollection(activeCollectionId);
      showToast(`Deleted "${title}"`);
      setView('master');
    } catch (err) {
      console.error("Delete collection error:", err);
      showToast("Failed to delete collection.");
    }
  }
}

// Add Current Active Tab
function resizeThumbnailDataUrl(dataUrl, maxWidth = 480, maxHeight = 270) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const sourceRatio = img.width / img.height;
      const targetRatio = maxWidth / maxHeight;
      let sourceWidth = img.width;
      let sourceHeight = img.height;
      let sourceX = 0;
      let sourceY = 0;

      if (sourceRatio > targetRatio) {
        sourceWidth = img.height * targetRatio;
        sourceX = (img.width - sourceWidth) / 2;
      } else {
        sourceHeight = img.width / targetRatio;
        sourceY = (img.height - sourceHeight) / 2;
      }

      const canvas = document.createElement('canvas');
      canvas.width = maxWidth;
      canvas.height = maxHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, maxWidth, maxHeight);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}

async function captureActiveTabThumbnail(activeTab) {
  if (!chrome.tabs || !chrome.tabs.captureVisibleTab || !activeTab || !activeTab.windowId) {
    return "";
  }

  if (!activeTab.url || /^(edge|chrome|about|file):/i.test(activeTab.url)) {
    return "";
  }

  try {
    const screenshot = await chrome.tabs.captureVisibleTab(activeTab.windowId, {
      format: 'jpeg',
      quality: 70
    });
    return await resizeThumbnailDataUrl(screenshot);
  } catch (err) {
    console.warn("Failed to capture tab thumbnail:", err);

    try {
      if (chrome.permissions && chrome.permissions.request) {
        const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
        if (granted) {
          const screenshot = await chrome.tabs.captureVisibleTab(activeTab.windowId, {
            format: 'jpeg',
            quality: 70
          });
          return await resizeThumbnailDataUrl(screenshot);
        }
      }
    } catch (permissionErr) {
      console.warn("Thumbnail permission or retry failed:", permissionErr);
    }

    return "";
  }
}

async function handleAddCurrentTab(targetGroupId = null) {
  const btn = document.getElementById('add-current-tab-btn');
  if (btn) btn.disabled = true;
  
  try {
    let activeTab = null;
    
    // Query active tab from chrome API
    if (chrome.tabs && chrome.tabs.query) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0) {
        activeTab = tabs[0];
      }
    }
    
    // Fallback if testing environment or unable to fetch tab
    if (!activeTab) {
      activeTab = {
        title: document.title || "Local Page",
        url: window.location.href,
        favIconUrl: ""
      };
    }
    
    // Filter out edge internal extensions or blank pages where collections cannot save
    if (!activeTab.url || activeTab.url.startsWith('chrome-extension://')) {
      showToast("Cannot add extension or internal system tabs.");
      if (btn) btn.disabled = false;
      return;
    }

    let targetCollectionId = activeCollectionId;
    let collectionName = "";

    // If in Master View, choose/create a collection
    if (currentView === 'master') {
      const collections = await DBService.getAllCollections();
      
      if (collections.length === 0) {
        // Create a default collection if none exists
        const defaultCol = await DBService.addCollection("My Collection");
        targetCollectionId = defaultCol.id;
        collectionName = defaultCol.name;
      } else {
        // Add to the most recently created collection (first in our list)
        targetCollectionId = collections[0].id;
        collectionName = collections[0].name;
      }
    } else {
      const collections = await DBService.getAllCollections();
      let activeCol = collections.find(c => c.id === activeCollectionId);
      if (!activeCol && collections.length > 0) {
        activeCol = collections[0];
        targetCollectionId = activeCol.id;
      }
      collectionName = activeCol ? activeCol.name : "Collection";
    }

    let thumbnail = "";
    try {
      thumbnail = await captureActiveTabThumbnail(activeTab);
    } catch (thumbErr) {
      console.warn("Thumbnail capture error:", thumbErr);
    }

    // Fallback to page-provided thumbnail metadata when screenshot capture is unavailable.
    try {
      if (!thumbnail && chrome.tabs && chrome.scripting && activeTab.id) {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: () => {
            const ogImage = document.querySelector('meta[property="og:image"]');
            if (ogImage && ogImage.content) return ogImage.content;
            
            const twitterImage = document.querySelector('meta[name="twitter:image"]');
            if (twitterImage && twitterImage.content) return twitterImage.content;
            
            // Fallback to first high-res img
            const imgs = Array.from(document.querySelectorAll('img'));
            for (const img of imgs) {
              if (img.src && img.src.startsWith('http') && img.width > 200 && img.height > 200) {
                return img.src;
              }
            }
            return "";
          }
        });
        if (res && res.result) {
          thumbnail = res.result;
        }
      }
    } catch (err) {
      console.warn("Failed to extract thumbnail:", err);
    }

    const cleanGroupId = (typeof targetGroupId === 'string' && targetGroupId.trim()) ? targetGroupId.trim() : null;
    let finalGroupId = cleanGroupId;
    let groupTitle = "";

    if (finalGroupId) {
      const allItems = await DBService.getAllItems();
      const grp = allItems.find(i => i.id === finalGroupId && i.type === 'group');
      if (grp) {
        targetCollectionId = grp.collectionId;
        groupTitle = grp.title;

        // Auto-expand this group and its parents so newly added tab is visible
        if (grp.collapsed) {
          await DBService.toggleGroupCollapse(grp.id, false);
        }
        let parentId = grp.parentGroupId;
        while (parentId) {
          const parent = allItems.find(i => i.id === parentId && i.type === 'group');
          if (parent) {
            if (parent.collapsed) {
              await DBService.toggleGroupCollapse(parent.id, false);
            }
            parentId = parent.parentGroupId;
          } else {
            break;
          }
        }
      }
    } else if (activeTab.groupId !== undefined && activeTab.groupId > -1 && chrome.tabGroups && chrome.tabGroups.get) {
      // Auto-detect browser tab group
      try {
        const bgGroup = await chrome.tabGroups.get(activeTab.groupId);
        if (bgGroup) {
          const bgTitle = (bgGroup.title && bgGroup.title.trim()) || 'Tab Group';
          const colItems = await DBService.getItems(targetCollectionId);
          let matchGroup = colItems.find(i => i.type === 'group' && i.title.toLowerCase() === bgTitle.toLowerCase());
          if (!matchGroup) {
            const colorMap = {
              'grey': 'blue', 'blue': 'blue', 'red': 'red', 'yellow': 'orange',
              'green': 'green', 'pink': 'red', 'purple': 'purple', 'cyan': 'blue', 'orange': 'orange'
            };
            const grpColor = colorMap[bgGroup.color] || 'blue';
            matchGroup = await DBService.addGroup(targetCollectionId, bgTitle, null, grpColor);
          }
          finalGroupId = matchGroup.id;
          groupTitle = matchGroup.title;
        }
      } catch (err) {
        // Tab group query fallback
      }
    }

    // Save item
    await DBService.addItem(
      targetCollectionId,
      activeTab.title,
      activeTab.url,
      activeTab.favIconUrl || "",
      thumbnail,
      finalGroupId
    );
    
    if (groupTitle) {
      showToast(`Added to "${groupTitle}" in ${collectionName}`);
    } else {
      showToast(`Added to "${collectionName}"`);
    }
    
    // If in Master View, dynamically refresh the count on card. 
    // If in Detail View, dynamically render the new item.
    await render();
    
  } catch (err) {
    console.error("Add current tab error:", err);
    showToast(`Error saving current tab: ${err && err.message ? err.message : err}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Import Backup File (Parses Text/JSON/HTML)
function handleImportBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const textContent = event.target.result;
      const parsedData = parseBackupFile(textContent, file.name);
      
      const stats = await DBService.importBackupData(parsedData);
      showToast(`Imported ${stats.collectionsImported} collections (${stats.itemsImported} links)!`);
      
      // Clear input so same file can be uploaded again
      e.target.value = '';
      
      // Refresh UI
      render();
    } catch (err) {
      console.error("Import error:", err);
      showToast(err.message || "Failed to import backup. Check file structure.");
      e.target.value = '';
    }
  };
  
  reader.readAsText(file);
}

// Export Backup File (Generates a clean JSON file containing all collections and links)
async function handleExportBackup() {
  const exportBtn = document.getElementById('menu-file-export');
  if (exportBtn) exportBtn.disabled = true;
  showToast("Preparing backup...");
  
  try {
    const backupData = await DBService.exportBackupData();
    
    if (backupData.length === 0) {
      showToast("No collections found to export.");
      exportBtn.disabled = false;
      return;
    }
    
    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Generate date string for filename
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `edge_collections_backup_${dateStr}.json`;
    
    // Create hidden download link and click it
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = filename;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    
    // Cleanup
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(url);
    
    showToast("Backup exported successfully!");
  } catch (err) {
    console.error("Export error:", err);
    showToast("Failed to export backup.");
  } finally {
    exportBtn.disabled = false;
  }
}

// Parse content pasted into the editable paste box (handles rich-HTML and plain text list of URLs)
function handlePasteAreaInput() {
  const pasteArea = document.getElementById('paste-area');
  const confirmBtn = document.getElementById('confirm-clipboard-import-btn');
  const statusSpan = document.getElementById('detected-links-count');
  const nameInput = document.getElementById('paste-collection-name');
  
  // Try to find any anchors first (HTML paste from clipboard)
  const anchors = pasteArea.querySelectorAll('a');
  let links = [];
  
  if (anchors.length > 0) {
    anchors.forEach(a => {
      const url = a.href;
      const title = a.textContent.trim() || a.innerText.trim() || url;
      if (url && url.startsWith('http')) {
        links.push({ title, url });
      }
    });
  } else {
    // Fallback: Parse the raw text line-by-line
    const textContent = pasteArea.innerText || pasteArea.textContent || "";
    const lines = textContent.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    
    // Attempt standard URL discovery in text lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^https?:\/\/\S+/i.test(line)) {
        let title = line;
        if (i > 0 && !/^https?:\/\/\S+/i.test(lines[i-1])) {
          title = lines[i-1];
        }
        links.push({ title, url: line });
      } else {
        const separators = [' | ', ' - ', '\t', ','];
        let parsed = false;
        for (const sep of separators) {
          if (line.includes(sep)) {
            const parts = line.split(sep);
            const urlPart = parts.find(p => /^https?:\/\/\S+/i.test(p.trim()));
            if (urlPart) {
              const titlePart = parts.find(p => p !== urlPart);
              links.push({
                title: titlePart ? titlePart.trim() : "Untitled",
                url: urlPart.trim()
              });
              parsed = true;
              break;
            }
          }
        }
        if (!parsed && line.toLowerCase().includes('http')) {
          const match = line.match(/https?:\/\/\S+/i);
          if (match) {
            const url = match[0];
            const title = line.replace(url, '').trim() || url;
            links.push({ title, url });
          }
        }
      }
    }
  }
  
  // Deduplicate links by URL
  const seenUrls = new Set();
  const uniqueLinks = [];
  links.forEach(link => {
    if (!seenUrls.has(link.url)) {
      seenUrls.add(link.url);
      uniqueLinks.push(link);
    }
  });
  
  // Cache parsed links temporarily on pasteArea for the confirm handler
  pasteArea.dataset.parsedLinks = JSON.stringify(uniqueLinks);
  
  if (uniqueLinks.length > 0) {
    statusSpan.textContent = `Detected ${uniqueLinks.length} ${uniqueLinks.length === 1 ? 'link' : 'links'}! Ready to import.`;
    statusSpan.className = 'modal-status';
    confirmBtn.disabled = false;
    
    // If collection name is empty, auto-detect or set a default
    if (!nameInput.value.trim()) {
      nameInput.value = "Pasted Collection";
    }
  } else {
    statusSpan.textContent = 'No links detected yet';
    statusSpan.className = 'modal-status error';
    confirmBtn.disabled = true;
  }
}

// Confirm importing links from clipboard paste
async function handleConfirmClipboardImport() {
  const pasteArea = document.getElementById('paste-area');
  const nameInput = document.getElementById('paste-collection-name');
  const confirmBtn = document.getElementById('confirm-clipboard-import-btn');
  const clipboardModal = document.getElementById('clipboard-modal');
  
  const rawLinks = pasteArea.dataset.parsedLinks;
  if (!rawLinks) return;
  
  const links = JSON.parse(rawLinks);
  if (links.length === 0) return;
  
  confirmBtn.disabled = true;
  
  let colName = nameInput.value.trim();
  if (!colName) {
    colName = "Pasted Collection";
  }
  
  try {
    const importPayload = [{
      name: colName,
      items: links
    }];
    
    const stats = await DBService.importBackupData(importPayload);
    showToast(`Pasted Import: Added "${colName}" with ${stats.itemsImported} links!`);
    
    // Clear and hide
    pasteArea.innerHTML = '';
    nameInput.value = '';
    clipboardModal.classList.add('hidden');
    
    // Refresh UI
    render();
  } catch (err) {
    console.error("Paste import failed:", err);
    showToast("Failed to import links.");
  } finally {
    confirmBtn.disabled = false;
  }
}

// HTML Bookmarks Parser (parses Netscape bookmark folder structures)
function parseHTMLBookmarks(htmlContent) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');
  const result = [];
  
  // Netscape bookmark folders typically use <H3> tags for folder names
  const folders = doc.querySelectorAll('h3');
  
  if (folders.length > 0) {
    folders.forEach(h3 => {
      const folderName = h3.textContent.trim();
      if (!folderName) return;
      
      const parentNode = h3.parentElement; // Typically a <DT>
      // Find the next <DL> which lists the items inside this folder
      let siblingDl = parentNode.querySelector('dl');
      if (!siblingDl) {
        let nextSibling = parentNode.nextElementSibling;
        while (nextSibling && nextSibling.tagName.toLowerCase() !== 'dl' && nextSibling.tagName.toLowerCase() !== 'dt') {
          nextSibling = nextSibling.nextElementSibling;
        }
        if (nextSibling && nextSibling.tagName.toLowerCase() === 'dl') {
          siblingDl = nextSibling;
        }
      }
      
      const items = [];
      if (siblingDl) {
        const anchors = siblingDl.querySelectorAll('a');
        anchors.forEach(a => {
          const url = a.getAttribute('href') || a.href;
          if (url && url.startsWith('http')) {
            items.push({
              title: a.textContent.trim() || url,
              url: url,
              favicon: a.getAttribute('icon') || ""
            });
          }
        });
      }
      
      if (items.length > 0) {
        result.push({
          name: folderName,
          items: items
        });
      }
    });
  } else {
    // Fallback: If no folders, just collect all anchors on the page into one collection
    const anchors = doc.querySelectorAll('a');
    const items = [];
    anchors.forEach(a => {
      const url = a.getAttribute('href') || a.href;
      if (url && url.startsWith('http')) {
        items.push({
          title: a.textContent.trim() || url,
          url: url,
          favicon: a.getAttribute('icon') || ""
        });
      }
    });
    if (items.length > 0) {
      result.push({
        name: "Imported Links",
        items: items
      });
    }
  }
  
  return result;
}

// Backup Parser (Flexible Format Handler)
function parseBackupFile(fileContent, filename) {
  const content = fileContent.trim().replace(/^\uFEFF/, '');
  
  // Try Netscape HTML Bookmarks first if file looks like HTML
  if (content.toLowerCase().includes('<h3') || content.toLowerCase().includes('<dl') || content.toLowerCase().includes('href=')) {
    try {
      const parsedHTML = parseHTMLBookmarks(content);
      if (parsedHTML.length > 0) {
        return parsedHTML;
      }
    } catch (htmlErr) {
      console.log("HTML Bookmarks parsing failed, falling back to JSON:", htmlErr);
    }
  }
  
  // Try JSON first
  try {
    const data = JSON.parse(content);
    
    // Case 1: Dict object: { "Collection Name": [ {title, url}, ... ] }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const result = [];
      for (const [colName, items] of Object.entries(data)) {
        if (Array.isArray(items)) {
          const parsedItems = items
            .filter(item => item && (item.url || item.link || item.type === 'note'))
            .map(item => {
              if (item.type === 'note') {
                return {
                  type: 'note',
                  content: item.content || "",
                  color: item.color || "yellow"
                };
              } else {
                return {
                  type: 'link',
                  title: item.title || item.name || item.url || item.link || "Untitled",
                  url: item.url || item.link,
                  favicon: item.favicon || "",
                  thumbnail: item.thumbnail || "",
                  linkNote: item.linkNote || "",
                  itemTheme: item.itemTheme || ""
                };
              }
            });
          result.push({ name: colName, items: parsedItems });
        }
      }
      if (result.length > 0) return result;
    }
    
    // Case 2: Array of collections: [ { name: "...", items: [...] }, ... ]
    if (Array.isArray(data)) {
      const isCollectionArray = data.some(el => el && typeof el === 'object' && (el.name || el.title) && Array.isArray(el.items || el.links));
      
      if (isCollectionArray) {
        return data.map(col => {
          const name = col.name || col.title || "Imported Collection";
          const rawItems = col.items || col.links || [];
          const items = rawItems
            .filter(item => item && (item.url || item.link || item.type === 'note'))
            .map(item => {
              if (item.type === 'note') {
                return {
                  type: 'note',
                  content: item.content || "",
                  color: item.color || "yellow"
                };
              } else {
                return {
                  type: 'link',
                  title: item.title || item.name || item.url || item.link || "Untitled",
                  url: item.url || item.link,
                  favicon: item.favicon || "",
                  thumbnail: item.thumbnail || ""
                };
              }
            });
          return { name, items };
        });
      } else {
        // Flat array of items: [ { title, url }, ... ] or [ "http://...", ... ]
        const items = data.map(item => {
          if (typeof item === 'string') {
            return { title: item, url: item, favicon: "" };
          }
          if (item && typeof item === 'object') {
            return {
              title: item.title || item.name || item.url || item.link || "Untitled",
              url: item.url || item.link || "",
              favicon: item.favicon || "",
              linkNote: item.linkNote || "",
              itemTheme: item.itemTheme || ""
            };
          }
          return null;
        }).filter(item => item && item.url);
        
        const defaultName = filename ? filename.replace(/\.[^/.]+$/, "") : "Imported Collection";
        return [{ name: defaultName, items }];
      }
    }
  } catch (jsonError) {
    // Not JSON, continue to text list parsing
  }
  
  // Case 3: Text file (one URL per line, or Title | URL lines)
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  const items = [];
  
  for (const line of lines) {
    if (/^https?:\/\/\S+/i.test(line)) {
      items.push({ title: line, url: line, favicon: "" });
    } else {
      const separators = [' | ', ' - ', '\t', ','];
      let parsed = false;
      for (const sep of separators) {
        if (line.includes(sep)) {
          const parts = line.split(sep);
          const urlPart = parts.find(p => /^https?:\/\/\S+/i.test(p.trim()));
          if (urlPart) {
            const titlePart = parts.find(p => p !== urlPart);
            items.push({
              title: titlePart ? titlePart.trim() : "Untitled",
              url: urlPart.trim(),
              favicon: ""
            });
            parsed = true;
            break;
          }
        }
      }
      if (!parsed && line.toLowerCase().includes('http')) {
        const match = line.match(/https?:\/\/\S+/i);
        if (match) {
          const url = match[0];
          const title = line.replace(url, '').trim() || url;
          items.push({ title, url, favicon: "" });
        }
      }
    }
  }
  
  if (items.length > 0) {
    const defaultName = filename ? filename.replace(/\.[^/.]+$/, "") : "Imported Links";
    return [{ name: defaultName, items }];
  }
  
  throw new Error("Could not parse file. Make sure it is JSON or a list of URLs.");
}

// --- Search Filter Handler ---
async function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();
  
  const masterPanel = document.getElementById('collections-list-view');
  const detailPanel = document.getElementById('collection-items-view');
  const searchResultsPanel = document.getElementById('search-results-view');
  
  if (!query) {
    // Restore original view panel if we were in search
    if (searchResultsPanel) searchResultsPanel.classList.add('hidden');
    
    if (preSearchView) {
      currentView = preSearchView.view;
      activeCollectionId = preSearchView.collectionId;
      preSearchView = null;
    }
    
    if (currentView === 'master') {
      if (masterPanel) masterPanel.classList.remove('hidden');
      if (detailPanel) detailPanel.classList.add('hidden');
      renderCollectionsList();
    } else {
      if (masterPanel) masterPanel.classList.add('hidden');
      if (detailPanel) detailPanel.classList.remove('hidden');
      renderCollectionDetails();
    }
    return;
  }
  
  // Save current view state before searching if not already saved
  if (!preSearchView) {
    preSearchView = { view: currentView, collectionId: activeCollectionId };
  }
  
  // Transition to search results panel
  if (masterPanel) masterPanel.classList.add('hidden');
  if (detailPanel) detailPanel.classList.add('hidden');
  if (searchResultsPanel) searchResultsPanel.classList.remove('hidden');
  
  try {
    const allCollections = await DBService.getAllCollections();
    const allItems = await DBService.getAllItems();
    let matchingCols = [];
    let groupedItems = {};
    
    if (isProUser) {
      // Filter matching collections
      matchingCols = allCollections.filter(col => col.name.toLowerCase().includes(query));
      
      // Filter matching content items
      const matchingItems = allItems.filter(item => {
        if (item.type === 'group') return false;
        if (item.type === 'note') {
          return (item.content || "").toLowerCase().includes(query);
        } else {
          return (item.title || "").toLowerCase().includes(query) ||
                 (item.url || "").toLowerCase().includes(query) ||
                 (item.linkNote || "").toLowerCase().includes(query);
        }
      });
      
      // Group matching items by collection
      matchingItems.forEach(item => {
        if (!groupedItems[item.collectionId]) {
          groupedItems[item.collectionId] = [];
        }
        groupedItems[item.collectionId].push(item);
      });
    } else {
      // Free tier: limit search to current local view scope
      if (preSearchView.view === 'master') {
        matchingCols = allCollections.filter(col => col.name.toLowerCase().includes(query));
      } else if (preSearchView.view === 'detail' && preSearchView.collectionId) {
        const localItems = await DBService.getItems(preSearchView.collectionId);
        const matchingItems = localItems.filter(item => {
          if (item.type === 'group') return false;
          if (item.type === 'note') {
            return (item.content || "").toLowerCase().includes(query);
          } else {
            return (item.title || "").toLowerCase().includes(query) ||
                   (item.url || "").toLowerCase().includes(query) ||
                   (item.linkNote || "").toLowerCase().includes(query);
          }
        });
        
        if (matchingItems.length > 0) {
          groupedItems[preSearchView.collectionId] = matchingItems;
        }
      }
    }
    
    renderSearchResults(matchingCols, groupedItems, allCollections, query, allItems);
  } catch (err) {
    console.error("Global search query error:", err);
  }
}

function renderSearchResults(matchingCols, groupedItems, allCollections, query, allItems = []) {
  const container = document.getElementById('search-results-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  const hasCols = matchingCols.length > 0;
  const hasItems = Object.keys(groupedItems).length > 0;
  
  if (!hasCols && !hasItems) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon-wrapper">
          <svg viewBox="0 0 24 24" width="48" height="48" class="empty-icon">
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
        </div>
        <h3>No results found</h3>
        <p>We couldn't find any collections or items matching "${escapeHTML(query)}".</p>
      </div>
    `;
    
    if (!isProUser) {
      const banner = document.createElement('div');
      banner.className = 'search-upgrade-banner';
      banner.innerHTML = `
        <p>Global search is a Pro feature. Upgrade to search all folders instantly.</p>
        <button class="btn btn-primary" id="search-upgrade-btn">Upgrade to Pro</button>
      `;
      banner.querySelector('#search-upgrade-btn').addEventListener('click', showPaywallModal);
      container.appendChild(banner);
    }
    return;
  }
  
  // Build map of groups for quick badge lookup
  const groupMap = new Map();
  if (Array.isArray(allItems)) {
    allItems.filter(i => i.type === 'group').forEach(g => groupMap.set(g.id, g.title));
  }

  // 1. Render Matching Collections
  if (hasCols) {
    const colSection = document.createElement('div');
    colSection.className = 'search-results-section';
    colSection.innerHTML = `<div class="search-section-title">Matching Collections</div>`;
    
    const listWrapper = document.createElement('div');
    listWrapper.className = 'search-results-collections-list';
    
    matchingCols.forEach(col => {
      const card = document.createElement('div');
      card.className = `collection-card col-color-${col.color || 'blue'}`;
      card.dataset.id = col.id;
      card.innerHTML = `
        <div class="collection-card-left">
          <div class="collection-icon-box">
            <svg class="icon-inline" viewBox="0 0 24 24" width="20" height="20">
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
          </div>
          <div class="collection-info">
            <span class="collection-name" title="${escapeHTML(col.name)}">${escapeHTML(col.name)}</span>
            <span class="collection-count">${col.count} ${col.count === 1 ? 'item' : 'items'}</span>
          </div>
        </div>
      `;
      card.addEventListener('click', () => {
        // Clear search input and open the collection
        document.getElementById('search-input').value = '';
        setView('detail', col.id);
      });
      listWrapper.appendChild(card);
    });
    
    colSection.appendChild(listWrapper);
    container.appendChild(colSection);
  }
  
  // 2. Render Matching Items grouped by collection
  if (hasItems) {
    const itemsSection = document.createElement('div');
    itemsSection.className = 'search-results-section';
    itemsSection.innerHTML = `<div class="search-section-title">Matching Items</div>`;
    
    const groupsWrapper = document.createElement('div');
    groupsWrapper.className = 'search-results-groups-list';
    groupsWrapper.style.display = 'flex';
    groupsWrapper.style.flexDirection = 'column';
    groupsWrapper.style.gap = '12px';
    
    for (const colId in groupedItems) {
      const col = allCollections.find(c => c.id === colId);
      if (!col) continue;
      
      const groupEl = document.createElement('div');
      groupEl.className = `search-group col-color-${col.color || 'blue'}`;
      
      const headerEl = document.createElement('div');
      headerEl.className = 'search-group-header';
      headerEl.innerHTML = `
        <div class="search-group-header-left">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
          </svg>
          <span>${escapeHTML(col.name)}</span>
        </div>
        <div class="search-group-header-right">Open</div>
      `;
      
      headerEl.addEventListener('click', () => {
        document.getElementById('search-input').value = '';
        setView('detail', col.id);
      });
      groupEl.appendChild(headerEl);
      
      const itemsWrapper = document.createElement('div');
      itemsWrapper.className = 'search-group-items';
      
      groupedItems[colId].forEach(item => {
        const groupName = item.groupId && groupMap.has(item.groupId) ? groupMap.get(item.groupId) : '';
        const groupBadge = groupName ? `<span class="search-item-group-badge">📁 ${escapeHTML(groupName)}</span>` : '';

        if (item.type === 'note') {
          // Render note card
          const card = document.createElement('div');
          card.className = `note-card note-${item.color || 'yellow'}`;
          card.innerHTML = `
            <div class="note-content" style="max-height: 80px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">${escapeHTML(item.content)}</div>
            <div class="note-footer" style="margin-top: 4px; font-size: 9px; color: var(--text-tertiary); display: flex; align-items: center; justify-content: space-between;">
              <span>Note</span>
              ${groupBadge}
            </div>
          `;
          card.addEventListener('click', () => {
            // Take user to the collection detail view
            document.getElementById('search-input').value = '';
            setView('detail', col.id);
          });
          itemsWrapper.appendChild(card);
        } else {
          // Render link card
          const card = document.createElement('div');
          card.className = `item-card ${item.itemTheme ? `item-theme-${item.itemTheme}` : ''}`;
          const domain = getDomainName(item.url);
          
          let faviconSrc = "";
          if (chrome.runtime && chrome.runtime.id) {
            faviconSrc = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(item.url)}&size=32`;
          } else {
            faviconSrc = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
          }
          
          card.innerHTML = `
            <img class="item-favicon" src="${faviconSrc}" alt="" style="display:none;" 
              onload="this.style.display='inline-block'; if(this.nextElementSibling) this.nextElementSibling.style.display='none';" 
              onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-flex';" />
            <div class="item-favicon-fallback" style="display:inline-flex; width:16px; height:16px; align-items:center; justify-content:center; background:var(--primary-light); color:var(--primary-color); border-radius:2px; font-size:10px; font-weight:bold; margin-top:3px; flex-shrink:0;">
              ${domain ? domain[0].toUpperCase() : 'W'}
            </div>
            <div class="item-details" style="margin-left: 8px; min-width: 0; flex: 1;">
              <a class="item-title" href="${escapeHTML(item.url)}" target="_blank" title="${escapeHTML(item.title)}">${escapeHTML(item.title)}</a>
              <div class="item-meta" style="font-size: 9px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                <span class="item-domain">${escapeHTML(domain)}</span>
                ${groupBadge}
              </div>
              <div class="link-note-preview ${item.linkNote ? '' : 'hidden'}">${escapeHTML(item.linkNote || '')}</div>
            </div>
          `;
          
          // Link clicks inside search opens link directly
          card.addEventListener('click', (e) => {
            if (e.target.closest('a')) return;
            e.preventDefault();
            if (chrome.tabs) {
              chrome.tabs.create({ url: item.url });
            } else {
              window.open(item.url, '_blank');
            }
          });
          itemsWrapper.appendChild(card);
        }
      });
      
      groupEl.appendChild(itemsWrapper);
      groupsWrapper.appendChild(groupEl);
    }
    
    itemsSection.appendChild(groupsWrapper);
    container.appendChild(itemsSection);
  }

  // Append upgrade banner for free users
  if (!isProUser) {
    const banner = document.createElement('div');
    banner.className = 'search-upgrade-banner';
    banner.innerHTML = `
      <p>Global search is a Pro feature. Upgrade to search all folders instantly.</p>
      <button class="btn btn-primary" id="search-upgrade-btn">Upgrade to Pro</button>
    `;
    banner.querySelector('#search-upgrade-btn').addEventListener('click', showPaywallModal);
    container.appendChild(banner);
  }
}

// Toggle Grid/List View
function handleToggleView() {
  const container = document.getElementById('items-container');
  const icon = document.getElementById('view-toggle-icon');
  
  if (!container || !icon) return;
  
  const currentPref = localStorage.getItem('collections_view_pref') || 'grid';
  const newPref = currentPref === 'list' ? 'grid' : 'list';
  
  localStorage.setItem('collections_view_pref', newPref);
  
  updateViewPrefUI(newPref);
}

function updateViewPrefUI(pref) {
  const container = document.getElementById('items-container');
  const icon = document.getElementById('view-toggle-icon');
  if (!container || !icon) return;
  
  if (pref === 'grid') {
    container.classList.add('grid-view');
    icon.innerHTML = '<path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>';
    icon.parentElement.title = "Switch to List View";
  } else {
    container.classList.remove('grid-view');
    icon.innerHTML = '<path d="M4 11h5V5H4v6zm0 7h5v-6H4v6zm6 0h5v-6h-5v6zm6 0h5v-6h-5v6zm-6-7h5V5h-5v6zm6-6v6h5V5h-5z"/>';
    icon.parentElement.title = "Switch to Grid View";
  }
}

// --- Multi-Select & Bulk Actions Handlers ---
function handleToggleSelectionMode() {
  if (currentView !== 'detail') return;
  selectionModeActive = !selectionModeActive;
  selectedItemIds.clear();
  render();
}

function handleSelectAll() {
  if (currentView !== 'detail') return;
  const allItemIds = activeCollectionItems.map(item => item.id);
  const allSelected = allItemIds.length > 0 && allItemIds.every(id => selectedItemIds.has(id));
  
  if (allSelected) {
    selectedItemIds.clear();
  } else {
    allItemIds.forEach(id => selectedItemIds.add(id));
  }
  render();
}

function toggleItemSelection(id, isSelected) {
  if (isSelected) {
    selectedItemIds.add(id);
  } else {
    selectedItemIds.delete(id);
  }
  
  const selectAllBtn = document.getElementById('select-all-btn');
  if (selectAllBtn) {
    const allItemIds = activeCollectionItems.map(item => item.id);
    const allSelected = allItemIds.length > 0 && allItemIds.every(id => selectedItemIds.has(id));
    selectAllBtn.textContent = allSelected ? "Deselect All" : "Select All";
  }
  
  updateBulkActionsBar();
}

function updateBulkActionsBar() {
  const bar = document.getElementById('bulk-actions-bar');
  const mainContent = document.querySelector('.main-content');
  const countSpan = document.getElementById('selected-count');
  
  if (!bar) return;
  
  if (selectionModeActive && currentView === 'detail') {
    bar.classList.remove('hidden');
    if (mainContent) mainContent.classList.add('with-bulk-bar');
    if (countSpan) {
      const size = selectedItemIds.size;
      countSpan.textContent = `${size} ${size === 1 ? 'item' : 'items'} selected`;
    }
  } else {
    bar.classList.add('hidden');
    if (mainContent) mainContent.classList.remove('with-bulk-bar');
  }
}

function handleBulkOpen() {
  if (selectedItemIds.size === 0) return;
  
  let openedCount = 0;
  selectedItemIds.forEach(id => {
    const item = activeCollectionItems.find(i => i.id === id);
    if (item && item.type !== 'note' && item.url) {
      openedCount++;
      if (chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: item.url });
      } else {
        window.open(item.url, '_blank');
      }
    }
  });
  
  showToast(`Opened ${openedCount} ${openedCount === 1 ? 'tab' : 'tabs'}`);
  
  selectionModeActive = false;
  selectedItemIds.clear();
  render();
}

async function handleBulkCopy() {
  if (selectedItemIds.size === 0) return;
  
  const lines = [];
  selectedItemIds.forEach(id => {
    const item = activeCollectionItems.find(i => i.id === id);
    if (item) {
      if (item.type === 'note') {
        lines.push(item.content || "");
      } else {
        lines.push(`[${item.title || "Untitled"}](${item.url})`);
        if (item.linkNote) {
          lines.push(`Note: ${item.linkNote}`);
        }
      }
    }
  });
  
  const textToCopy = lines.join('\n');
  try {
    await navigator.clipboard.writeText(textToCopy);
    showToast(`Copied ${selectedItemIds.size} items to clipboard!`);
  } catch (err) {
    console.error("Clipboard write failed:", err);
    showToast("Failed to copy items.");
  }
  
  selectionModeActive = false;
  selectedItemIds.clear();
  render();
}

async function handleBulkDelete() {
  const size = selectedItemIds.size;
  if (size === 0) return;
  
  if (confirm(`Are you sure you want to delete the ${size} selected items?`)) {
    try {
      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      
      selectedItemIds.forEach(id => {
        store.delete(id);
      });
      
      showToast(`Deleted ${size} items`);
      
      selectionModeActive = false;
      selectedItemIds.clear();
      render();
    } catch (err) {
      console.error("Bulk delete error:", err);
      showToast("Failed to delete items.");
    }
  }
}

async function handleBulkMove() {
  if (selectedItemIds.size === 0) return;
  
  const collections = await DBService.getAllCollections();
  const allItems = await DBService.getAllItems();
  
  const moveListContainer = document.getElementById('move-collections-list');
  if (!moveListContainer) return;
  
  moveListContainer.innerHTML = '';

  const executeMove = async (targetColId, targetGroupId, targetName) => {
    try {
      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      
      for (const id of selectedItemIds) {
        const item = await new Promise((res, rej) => {
          const req = store.get(id);
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        
        if (item && item.type !== 'group') {
          item.collectionId = targetColId;
          item.groupId = targetGroupId || null;
          delete item.sortOrder;
          store.put(item);
        }
      }
      
      showToast(`Moved ${selectedItemIds.size} items to "${targetName}"`);
      document.getElementById('move-modal').classList.add('hidden');
      
      selectionModeActive = false;
      selectedItemIds.clear();
      render();
    } catch (err) {
      console.error("Bulk move error:", err);
      showToast("Failed to move items.");
    }
  };

  // Helper to add group options recursively
  const addGroupOptions = (colId, parentGroupId, level) => {
    const childGroups = allItems.filter(i => i.collectionId === colId && i.type === 'group' && (i.parentGroupId || null) === parentGroupId);
    childGroups.forEach(grp => {
      const grpEl = document.createElement('div');
      grpEl.className = 'move-group-item';
      grpEl.dataset.level = level;
      grpEl.innerHTML = `
        <span class="move-group-dot dot-${grp.color || 'blue'}"></span>
        <span class="move-group-title">📁 ${escapeHTML(grp.title)}</span>
      `;
      grpEl.addEventListener('click', () => {
        executeMove(colId, grp.id, grp.title);
      });
      moveListContainer.appendChild(grpEl);
      addGroupOptions(colId, grp.id, level + 1);
    });
  };

  collections.forEach(col => {
    // Collection Root Option
    const itemEl = document.createElement('div');
    itemEl.className = 'move-collection-item';
    itemEl.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16">
        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
      </svg>
      <span>${escapeHTML(col.name)} ${col.id === activeCollectionId ? '(Root / Ungrouped)' : ''}</span>
    `;
    itemEl.addEventListener('click', () => {
      executeMove(col.id, null, col.name);
    });
    moveListContainer.appendChild(itemEl);

    // List tab groups in this collection
    addGroupOptions(col.id, null, 1);
  });
  
  document.getElementById('move-modal').classList.remove('hidden');
}

// --- Gumroad License Verification Service ---
function getGumroadLicenseUses(purchase) {
  const uses = Number(purchase && purchase.uses);
  return Number.isFinite(uses) ? uses : 0;
}

async function verifyGumroadLicense(licenseKey, isSilent = false) {
  const statusMsg = document.getElementById('paywall-status-message');
  
  if (!isSilent && statusMsg) {
    statusMsg.className = 'paywall-status-text';
    statusMsg.style.display = 'block';
    statusMsg.style.color = 'var(--text-secondary)';
    statusMsg.textContent = 'Verifying license key...';
  }
  
  try {
    const requestBody = new URLSearchParams({
      'product_id': GUMROAD_PRODUCT_ID,
      'license_key': licenseKey.trim()
    });

    if (!isSilent) {
      requestBody.set('increment_uses_count', 'true');
    }

    const response = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: requestBody
    });
    
    const data = await response.json();
    
    if (data.success && data.purchase && !data.purchase.refunded && !data.purchase.chargebacked) {
      const licenseUses = getGumroadLicenseUses(data.purchase);

      if (licenseUses > MAX_LICENSE_USES) {
        throw new Error('This license key has already been activated on another browser profile or device.');
      }

      isProUser = true;
      if (chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ proLicenseKey: licenseKey.trim(), isProUser: true });
      } else {
        localStorage.setItem('proLicenseKey', licenseKey.trim());
        localStorage.setItem('isProUser', 'true');
      }

      updatePromoFooterVisibility();
      
      if (!isSilent) {
        if (statusMsg) {
          statusMsg.className = 'paywall-success-text';
          statusMsg.style.color = 'var(--success-color)';
          statusMsg.textContent = 'Pro License Activated Successfully! Thank you!';
        }
        showToast('Pro features unlocked!');
        setTimeout(() => {
          document.getElementById('paywall-modal').classList.add('hidden');
          render();
        }, 1500);
      }
      return true;
    } else {
      throw new Error(data.message || 'Verification failed. Key may be refunded or invalid.');
    }
  } catch (err) {
    console.error("License verification failed:", err);
    isProUser = false;
    updatePromoFooterVisibility();
    if (chrome.storage && chrome.storage.local) {
      await chrome.storage.local.remove(['proLicenseKey', 'isProUser']);
    } else {
      localStorage.removeItem('proLicenseKey');
      localStorage.removeItem('isProUser');
    }
    
    if (!isSilent && statusMsg) {
      statusMsg.className = 'paywall-error-text';
      statusMsg.style.color = 'var(--danger-color)';
      statusMsg.textContent = err.message || 'Invalid license key. Please check and try again.';
    }
    return false;
  }
}

async function checkProStatusOnStartup() {
  let savedKey = null;
  if (chrome.storage && chrome.storage.local) {
    const res = await chrome.storage.local.get(['proLicenseKey', 'isProUser']);
    savedKey = res.proLicenseKey;
    isProUser = !!res.isProUser;
  } else {
    savedKey = localStorage.getItem('proLicenseKey');
    isProUser = localStorage.getItem('isProUser') === 'true';
  }
  
  if (savedKey) {
    verifyGumroadLicense(savedKey, true);
  }

  updatePromoFooterVisibility();
}

async function getInstallStartedAt() {
  const storageKey = 'installedAt';
  const now = Date.now();

  if (chrome.storage && chrome.storage.local) {
    const res = await chrome.storage.local.get([storageKey]);
    if (Number.isFinite(res[storageKey])) {
      return res[storageKey];
    }

    await chrome.storage.local.set({ [storageKey]: now });
    return now;
  }

  const saved = Number(localStorage.getItem(storageKey));
  if (Number.isFinite(saved) && saved > 0) {
    return saved;
  }

  localStorage.setItem(storageKey, String(now));
  return now;
}

function showPaywallModal() {
  const statusMsg = document.getElementById('paywall-status-message');
  if (statusMsg) statusMsg.style.display = 'none';
  const licenseInput = document.getElementById('license-input');
  if (licenseInput) licenseInput.value = '';
  const modal = document.getElementById('paywall-modal');
  if (modal) modal.classList.remove('hidden');
}

async function updatePromoFooterVisibility() {
  const promoFooter = document.getElementById('promo-footer');
  if (!promoFooter) return;

  const installedAt = await getInstallStartedAt();
  const hasUsedForAWeek = Date.now() - installedAt >= PROMO_FOOTER_DELAY_MS;
  promoFooter.classList.toggle('hidden', !!isProUser || !hasUsedForAWeek);
}

// --- Helper Functions ---
function getDomainName(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace('www.', '');
  } catch (err) {
    return "";
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Toast notification displayer
let toastTimeout = null;
function showToast(message) {
  const toast = document.getElementById('toast-notification');
  const toastMsg = document.getElementById('toast-message');
  
  toastMsg.textContent = message;
  toast.classList.remove('hidden');
  
  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }
  
  toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

// --- Bing Saves Import Logic ---
let activeBingTabId = null;
let isBingScraping = false;
let tabCheckInterval = null;

async function checkActiveTabForBing() {
  const warningBanner = document.getElementById('bing-tab-warning');
  const successBanner = document.getElementById('bing-tab-success');
  const startBtn = document.getElementById('start-bing-import-btn');

  try {
    if (!chrome.tabs || !chrome.tabs.query) {
      // Non-extension fallback/mocking
      warningBanner.classList.add('hidden');
      successBanner.classList.remove('hidden');
      startBtn.disabled = false;
      return;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0) {
      const activeTab = tabs[0];
      const url = activeTab.url || "";
      if (url.includes('bing.com/saves')) {
        activeBingTabId = activeTab.id;
        warningBanner.classList.add('hidden');
        successBanner.classList.remove('hidden');
        startBtn.disabled = false;
      } else {
        activeBingTabId = null;
        warningBanner.classList.remove('hidden');
        successBanner.classList.add('hidden');
        startBtn.disabled = true;
      }
    }
  } catch (err) {
    console.error("Error checking active tab:", err);
  }
}

function startTabCheckPolling() {
  stopTabCheckPolling();
  checkActiveTabForBing();
  tabCheckInterval = setInterval(checkActiveTabForBing, 1000);
}

function stopTabCheckPolling() {
  if (tabCheckInterval) {
    clearInterval(tabCheckInterval);
    tabCheckInterval = null;
  }
}

function handleBingImportButtonClick() {
  const modal = document.getElementById('bing-import-modal');
  const instructionsView = document.getElementById('bing-instructions-view');
  const progressView = document.getElementById('bing-progress-view');
  const cancelBtn = document.getElementById('cancel-bing-import-btn');
  const startBtn = document.getElementById('start-bing-import-btn');
  const progressBarFill = document.getElementById('bing-progress-bar-fill');
  
  progressBarFill.style.width = '0%';
  document.getElementById('bing-progress-status').textContent = 'Ready to import';
  document.getElementById('bing-progress-percent').textContent = '0%';
  document.getElementById('bing-progress-details').textContent = 'Waiting to begin...';
  
  instructionsView.classList.remove('hidden');
  progressView.classList.add('hidden');
  cancelBtn.textContent = 'Cancel';
  startBtn.classList.remove('hidden');
  
  modal.classList.remove('hidden');
  isBingScraping = false;
  
  startTabCheckPolling();
}

async function handleStartBingImport() {
  const instructionsView = document.getElementById('bing-instructions-view');
  const progressView = document.getElementById('bing-progress-view');
  const cancelBtn = document.getElementById('cancel-bing-import-btn');
  const startBtn = document.getElementById('start-bing-import-btn');
  
  if (!activeBingTabId) {
    showToast("Active tab is not bing.com/saves (Microsoft Edge Collections).");
    return;
  }
  
  stopTabCheckPolling();
  
  instructionsView.classList.add('hidden');
  progressView.classList.remove('hidden');
  startBtn.classList.add('hidden');
  cancelBtn.textContent = 'Cancel Import';
  
  isBingScraping = true;
  
  try {
    // Inject the script
    await chrome.scripting.executeScript({
      target: { tabId: activeBingTabId },
      files: ['bing_scraper.js']
    });
  } catch (err) {
    console.error("Scraper injection failed:", err);
    showToast("Failed to inject scraper script: " + err.message);
    isBingScraping = false;
    handleCloseBingModal();
  }
}

function handleCloseBingModal() {
  const modal = document.getElementById('bing-import-modal');
  stopTabCheckPolling();
  if (isBingScraping && activeBingTabId) {
    // Send cancel message to scraper script
    chrome.tabs.sendMessage(activeBingTabId, { type: 'BING_SAVE_CANCEL' }).catch(() => {});
  }
  modal.classList.add('hidden');
  isBingScraping = false;
}

// Runtime messaging listener
if (chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (!message) return;
    
    if (message.type === 'BING_SAVE_PROGRESS') {
      const { stepIndex, totalSteps, statusText, detailsText } = message;
      const percent = Math.round((stepIndex / totalSteps) * 100);
      
      const fill = document.getElementById('bing-progress-bar-fill');
      const status = document.getElementById('bing-progress-status');
      const pct = document.getElementById('bing-progress-percent');
      const details = document.getElementById('bing-progress-details');
      
      if (fill) fill.style.width = `${percent}%`;
      if (status) status.textContent = statusText || "Running scraper...";
      if (pct) pct.textContent = `${percent}%`;
      if (details) details.textContent = detailsText || "";
    }
    
    if (message.type === 'BING_SAVE_COMPLETE') {
      isBingScraping = false;
      const { collections } = message;
      
      const fill = document.getElementById('bing-progress-bar-fill');
      const status = document.getElementById('bing-progress-status');
      const pct = document.getElementById('bing-progress-percent');
      const details = document.getElementById('bing-progress-details');
      
      if (fill) fill.style.width = `100%`;
      if (status) status.textContent = "Saving to database...";
      if (pct) pct.textContent = `100%`;
      if (details) details.textContent = "Writing collections to local storage...";
      
      try {
        const stats = await DBService.importBackupData(collections);
        showToast(`Imported ${stats.collectionsImported} folders (${stats.itemsImported} links) from Bing!`);
        setTimeout(() => {
          handleCloseBingModal();
          render();
        }, 800);
      } catch (err) {
        console.error("Failed to write Bing data to DB:", err);
        showToast("Database write error: " + err.message);
        handleCloseBingModal();
      }
    }
    
    if (message.type === 'BING_SAVE_ERROR') {
      isBingScraping = false;
      const status = document.getElementById('bing-progress-status');
      const details = document.getElementById('bing-progress-details');
      if (status) status.textContent = "Import Failed";
      if (details) details.textContent = `Error: ${message.message}`;
      showToast("Bing Saves Scraper error: " + message.message);
    }
  });
}

// --- Cloud Sync UI and Event Handlers ---
function initCloudSyncUI() {
  const syncBtn = document.getElementById('cloud-sync-status-btn');
  const syncDot = document.getElementById('sync-status-dot');
  const menuCloudBtn = document.getElementById('menu-cloud-account');
  const cloudModal = document.getElementById('cloud-account-modal');
  const closeCloudModalBtn = document.getElementById('close-cloud-modal-btn');
  
  const authView = document.getElementById('cloud-auth-view');
  const dashboardView = document.getElementById('cloud-dashboard-view');
  
  const tabSignin = document.getElementById('cloud-tab-signin');
  const tabSignup = document.getElementById('cloud-tab-signup');
  const signinForm = document.getElementById('cloud-signin-form');
  const signupForm = document.getElementById('cloud-signup-form');
  
  const signinStatus = document.getElementById('cloud-signin-status');
  const signupStatus = document.getElementById('cloud-signup-status');
  const dashboardStatus = document.getElementById('cloud-dashboard-status');
  
  const userEmailText = document.getElementById('cloud-user-email-text');
  const lastSyncedTime = document.getElementById('cloud-last-synced-time');
  const syncNowBtn = document.getElementById('cloud-sync-now-btn');
  const signoutBtn = document.getElementById('cloud-signout-btn');

  function updateSyncIndicator(state) {
    if (!syncDot || !syncBtn) return;
    const isAuthed = typeof SupabaseClient !== 'undefined' && SupabaseClient.isAuthenticated();
    syncDot.className = 'sync-status-dot';
    syncBtn.classList.remove('syncing');

    if (!isAuthed) {
      syncDot.classList.add('unauthenticated');
      syncBtn.title = 'Cloud Sync & Account (Click to Sign In)';
      return;
    }

    if (state && state.status === 'syncing') {
      syncDot.classList.add('syncing');
      syncBtn.classList.add('syncing');
      syncBtn.title = 'Syncing collections with cloud...';
    } else if (state && state.status === 'error') {
      syncDot.classList.add('error');
      syncBtn.title = `Sync error: ${state.error || 'Check details'}`;
    } else if (state && state.status === 'offline') {
      syncDot.classList.add('offline');
      syncBtn.title = 'Offline - Sync paused';
    } else {
      syncDot.classList.add('idle');
      syncBtn.title = 'Cloud Sync: Up to date';
    }
  }

  if (typeof SyncService !== 'undefined') {
    SyncService.addListener(updateSyncIndicator);
    updateSyncIndicator(SyncService.getStatus());
  }

  async function refreshModalState() {
    if (!cloudModal) return;
    const isAuthed = typeof SupabaseClient !== 'undefined' && SupabaseClient.isAuthenticated();
    
    if (isAuthed) {
      const user = await SupabaseClient.getUser();
      if (authView) authView.classList.add('hidden');
      if (dashboardView) dashboardView.classList.remove('hidden');
      if (userEmailText) userEmailText.textContent = user ? user.email : 'Pro User';
      
      const lastSync = await SyncService.getLastSyncTime();
      if (lastSyncedTime) {
        lastSyncedTime.textContent = lastSync ? new Date(lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' + new Date(lastSync).toLocaleDateString() : 'Never';
      }
      if (dashboardStatus) {
        dashboardStatus.className = 'cloud-status-msg hidden';
        dashboardStatus.textContent = '';
      }
    } else {
      if (authView) authView.classList.remove('hidden');
      if (dashboardView) dashboardView.classList.add('hidden');
      
      // Auto-populate license key if user is already Pro locally
      const licenseInput = document.getElementById('cloud-signup-license');
      if (licenseInput) {
        let savedKey = '';
        if (chrome.storage && chrome.storage.local) {
          const res = await chrome.storage.local.get(['proLicenseKey']);
          savedKey = res.proLicenseKey || '';
        } else {
          savedKey = localStorage.getItem('proLicenseKey') || '';
        }
        if (savedKey) licenseInput.value = savedKey;
      }
    }
  }

  function openCloudModal() {
    if (cloudModal) {
      cloudModal.classList.remove('hidden');
      refreshModalState();
    }
  }

  if (syncBtn) {
    syncBtn.addEventListener('click', openCloudModal);
  }

  if (menuCloudBtn) {
    menuCloudBtn.addEventListener('click', () => {
      const menu = document.getElementById('more-actions-menu');
      if (menu) menu.classList.add('hidden');
      openCloudModal();
    });
  }

  if (closeCloudModalBtn) {
    closeCloudModalBtn.addEventListener('click', () => {
      if (cloudModal) cloudModal.classList.add('hidden');
    });
  }

  if (cloudModal) {
    cloudModal.addEventListener('click', (e) => {
      if (e.target === cloudModal) cloudModal.classList.add('hidden');
    });
  }

  // Tabs toggle
  if (tabSignin && tabSignup) {
    tabSignin.addEventListener('click', () => {
      tabSignin.classList.add('active');
      tabSignup.classList.remove('active');
      if (signinForm) signinForm.classList.remove('hidden');
      if (signupForm) signupForm.classList.add('hidden');
      if (signinStatus) signinStatus.classList.add('hidden');
    });

    tabSignup.addEventListener('click', () => {
      tabSignup.classList.add('active');
      tabSignin.classList.remove('active');
      if (signupForm) signupForm.classList.remove('hidden');
      if (signinForm) signinForm.classList.add('hidden');
      if (signupStatus) signupStatus.classList.add('hidden');
    });
  }

  // Sign In Form Submission
  if (signinForm) {
    signinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('cloud-signin-email').value;
      const password = document.getElementById('cloud-signin-password').value;
      const submitBtn = document.getElementById('cloud-signin-submit-btn');

      if (signinStatus) {
        signinStatus.className = 'cloud-status-msg info';
        signinStatus.textContent = 'Signing in to Supabase...';
        signinStatus.classList.remove('hidden');
      }
      if (submitBtn) submitBtn.disabled = true;

      try {
        await SupabaseClient.signIn(email, password);
        if (signinStatus) {
          signinStatus.className = 'cloud-status-msg success';
          signinStatus.textContent = 'Signed in successfully!';
        }
        await refreshModalState();
        updateSyncIndicator(SyncService.getStatus());
        showToast('Signed in to Cloud Sync');
        SyncService.sync();
      } catch (err) {
        if (signinStatus) {
          signinStatus.className = 'cloud-status-msg error';
          signinStatus.textContent = err.message || 'Login failed. Please check your credentials.';
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Sign Up Form Submission (Gated by Gumroad Pro License Key)
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('cloud-signup-email').value;
      const password = document.getElementById('cloud-signup-password').value;
      const licenseKey = document.getElementById('cloud-signup-license').value;
      const submitBtn = document.getElementById('cloud-signup-submit-btn');

      if (signupStatus) {
        signupStatus.className = 'cloud-status-msg info';
        signupStatus.textContent = 'Verifying Gumroad Pro license...';
        signupStatus.classList.remove('hidden');
      }
      if (submitBtn) submitBtn.disabled = true;

      try {
        const isKeyValid = await verifyGumroadLicense(licenseKey, false);
        if (!isKeyValid) {
          throw new Error('A valid Gumroad Pro license key is required to create a cloud account.');
        }

        if (signupStatus) {
          signupStatus.textContent = 'Creating cloud account...';
        }

        const res = await SupabaseClient.signUp(email, password, licenseKey);
        
        if (res.requiresEmailConfirmation) {
          if (signupStatus) {
            signupStatus.className = 'cloud-status-msg success';
            signupStatus.textContent = 'Registration successful! Please check your email to confirm your account before signing in.';
          }
        } else {
          if (signupStatus) {
            signupStatus.className = 'cloud-status-msg success';
            signupStatus.textContent = 'Account created and activated!';
          }
          await refreshModalState();
          updateSyncIndicator(SyncService.getStatus());
          showToast('Pro Cloud Account Created');
          SyncService.sync();
        }
      } catch (err) {
        if (signupStatus) {
          signupStatus.className = 'cloud-status-msg error';
          signupStatus.textContent = err.message || 'Signup failed.';
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Sync Now Action
  if (syncNowBtn) {
    syncNowBtn.addEventListener('click', async () => {
      syncNowBtn.classList.add('syncing');
      syncNowBtn.disabled = true;
      if (dashboardStatus) {
        dashboardStatus.className = 'cloud-status-msg info';
        dashboardStatus.textContent = 'Syncing collections with cloud...';
        dashboardStatus.classList.remove('hidden');
      }

      try {
        const result = await SyncService.sync();
        if (result && result.success) {
          if (dashboardStatus) {
            dashboardStatus.className = 'cloud-status-msg success';
            dashboardStatus.textContent = `Sync complete at ${new Date().toLocaleTimeString()}!`;
          }
          if (lastSyncedTime) {
            lastSyncedTime.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' + new Date().toLocaleDateString();
          }
          showToast('Cloud sync complete');
        } else {
          throw new Error(result ? (result.error || result.reason) : 'Sync failed');
        }
      } catch (err) {
        if (dashboardStatus) {
          dashboardStatus.className = 'cloud-status-msg error';
          dashboardStatus.textContent = `Sync error: ${err.message}`;
        }
      } finally {
        syncNowBtn.classList.remove('syncing');
        syncNowBtn.disabled = false;
        updateSyncIndicator(SyncService.getStatus());
      }
    });
  }

  // Sign Out Action
  if (signoutBtn) {
    signoutBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to sign out from Cloud Sync? Your local collections will remain saved on this device.')) {
        await SupabaseClient.signOut();
        await refreshModalState();
        updateSyncIndicator(SyncService.getStatus());
        showToast('Signed out from Cloud Sync');
      }
    });
  }
}

