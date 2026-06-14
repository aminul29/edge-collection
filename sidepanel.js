// State Management
let db = null;
let currentView = 'master'; // 'master' or 'detail'
let activeCollectionId = null;
let collectionsList = []; // Caching collections for search filtering
let activeCollectionItems = []; // Caching items for search filtering

let draggedCollectionId = null;
let draggedItemId = null;
let draggedType = null; // 'collection' or 'item'
let backDragTimeout = null;

let selectionModeActive = false;
let selectedItemIds = new Set();
let preSearchView = null;

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
        
        // Count items for each collection
        const counts = {};
        items.forEach(item => {
          counts[item.collectionId] = (counts[item.collectionId] || 0) + 1;
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
        created: Date.now()
      };
      
      const request = store.add(collection);
      request.onsuccess = () => resolve(collection);
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
        const updateReq = store.put(col);
        updateReq.onsuccess = () => resolve(col);
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
        const updateReq = store.put(col);
        updateReq.onsuccess = () => resolve(col);
        updateReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  },


  deleteCollection(id) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['collections', 'items'], 'readwrite');
      
      transaction.onerror = (e) => reject(e.target.error);
      transaction.oncomplete = () => resolve();
      
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


  addItem(collectionId, title, url, favicon, thumbnail) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      const item = {
        id: generateId(),
        collectionId: collectionId,
        title: title || "Untitled Page",
        url: url,
        favicon: favicon || "",
        thumbnail: thumbnail || "",
        type: "link",
        created: Date.now()
      };
      
      const request = store.add(item);
      request.onsuccess = () => resolve(item);
      request.onerror = (e) => reject(e.target.error);
    });
  },

  addNote(collectionId, content, color) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      const item = {
        id: generateId(),
        collectionId: collectionId,
        type: "note",
        content: content || "",
        color: color || "yellow",
        created: Date.now()
      };
      
      const request = store.add(item);
      request.onsuccess = () => resolve(item);
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
        const updateReq = store.put(item);
        updateReq.onsuccess = () => resolve(item);
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
        const updateReq = store.put(item);
        updateReq.onsuccess = () => resolve(item);
        updateReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  },

  deleteItem(id) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("Database not initialized"));
      
      const transaction = db.transaction(['items'], 'readwrite');
      const store = transaction.objectStore('items');
      const request = store.delete(id);
      
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
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
        
        group.items.forEach((item, itemIndex) => {
          const itemStoreObj = {
            id: generateId() + '_' + index + '_' + itemIndex,
            collectionId: colId,
            created: Date.now() - (group.items.length - itemIndex) * 10 // slightly spacing creation times
          };
          
          if (item.type === 'note') {
            itemStoreObj.type = 'note';
            itemStoreObj.content = item.content || '';
            itemStoreObj.color = item.color || 'yellow';
          } else {
            itemStoreObj.type = 'link';
            itemStoreObj.title = item.title || "Untitled";
            itemStoreObj.url = item.url;
            itemStoreObj.favicon = item.favicon || "";
            itemStoreObj.thumbnail = item.thumbnail || "";
          }
          
          itemStore.add(itemStoreObj);
          itemsImported++;
        });
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
          if (item.type === 'note') {
            itemsMap[item.collectionId].push({
              type: 'note',
              content: item.content,
              color: item.color || 'yellow'
            });
          } else {
            itemsMap[item.collectionId].push({
              type: 'link',
              title: item.title,
              url: item.url,
              favicon: item.favicon || "",
              thumbnail: item.thumbnail || ""
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
  
  for (let i = 0; i < collections.length; i++) {
    collections[i].sortOrder = i;
    store.put(collections[i]);
  }
}

async function reorderItems(collectionId, draggedId, targetId) {
  if (!db) return;
  const items = await DBService.getItems(collectionId);
  const draggedIdx = items.findIndex(i => i.id === draggedId);
  const targetIdx = items.findIndex(i => i.id === targetId);
  if (draggedIdx === -1 || targetIdx === -1) return;
  
  const [draggedItem] = items.splice(draggedIdx, 1);
  items.splice(targetIdx, 0, draggedItem);
  
  const transaction = db.transaction(['items'], 'readwrite');
  const store = transaction.objectStore('items');
  
  for (let i = 0; i < items.length; i++) {
    items[i].sortOrder = i;
    store.put(items[i]);
  }
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
      delete item.sortOrder; // falls back to newest inside the target collection
      
      const updateReq = store.put(item);
      updateReq.onsuccess = () => resolve(item);
      updateReq.onerror = (e) => reject(e.target.error);
    };
    getReq.onerror = (e) => reject(e.target.error);
  });
}

// --- DOM and Event Listeners Setup ---
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await DBService.init();
    setupEventListeners();
    await render();
  } catch (err) {
    console.error("Initialization failed:", err);
    showToast("Error initializing local storage.");
  }
});

function setupEventListeners() {
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
  document.getElementById('add-current-tab-btn').addEventListener('click', handleAddCurrentTab);
  
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

  // Dropdown Menu Toggling
  const menuTrigger = document.getElementById('menu-trigger-btn');
  const dropdownMenu = document.getElementById('more-actions-menu');
  
  if (menuTrigger && dropdownMenu) {
    menuTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('hidden');
    });
    
    document.addEventListener('click', (e) => {
      if (!dropdownMenu.classList.contains('hidden') && !e.target.closest('#more-actions-menu') && e.target !== menuTrigger) {
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
  searchInput.value = '';

  if (view === 'master') {
    backBtn.classList.add('hidden');
    viewTitle.textContent = "Collections";
    masterPanel.classList.remove('hidden');
    detailPanel.classList.add('hidden');
    searchInput.placeholder = "Search collections...";
    if (addNoteBtn) addNoteBtn.classList.add('hidden');
    if (createCollectionBtn) createCollectionBtn.classList.remove('hidden');
  } else if (view === 'detail') {
    backBtn.classList.remove('hidden');
    masterPanel.classList.add('hidden');
    detailPanel.classList.remove('hidden');
    searchInput.placeholder = "Search items...";
    if (addNoteBtn) addNoteBtn.classList.remove('hidden');
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
          
          const existingPopover = card.querySelector('.color-picker-popover');
          if (existingPopover) {
            existingPopover.remove();
            return;
          }
          
          document.querySelectorAll('.color-picker-popover').forEach(el => el.remove());
          
          const popover = document.createElement('div');
          popover.className = 'color-picker-popover';
          
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
          
          card.appendChild(popover);
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
  const pref = localStorage.getItem('collections_view_pref') || 'list';
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
      const label = document.createElement('span');
      label.className = 'detail-color-label';
      label.textContent = 'Theme:';
      detailColorPicker.appendChild(label);
      
      const colors = ['blue', 'purple', 'red', 'green', 'orange'];
      colors.forEach(color => {
        const btn = document.createElement('button');
        btn.className = `color-dot-btn btn-${color} ${activeCol.color === color || (!activeCol.color && color === 'blue') ? 'active' : ''}`;
        btn.title = color.charAt(0).toUpperCase() + color.slice(1);
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await DBService.updateCollectionColor(activeCol.id, color);
          showToast(`Theme updated to ${color}`);
          render();
        });
        detailColorPicker.appendChild(btn);
      });
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
    const filteredItems = activeCollectionItems.filter(item => {
      if (!searchVal) return true;
      if (item.type === 'note') {
        return (item.content || "").toLowerCase().includes(searchVal);
      } else {
        return (item.title || "").toLowerCase().includes(searchVal) || 
               (item.url || "").toLowerCase().includes(searchVal);
      }
    });
    
    filteredItems.forEach(item => {
      if (item.type === 'note') {
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
        
        // Selection mode card click toggle
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
        
        // Auto-save on blur
        contentEl.addEventListener('blur', async () => {
          const newText = contentEl.innerText.trim();
          if (newText !== item.content) {
            await DBService.updateNoteContent(item.id, newText);
            item.content = newText;
            showToast("Note saved");
          }
        });
        
        // Keydown handlers
        contentEl.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' || (e.key === 'Enter' && e.shiftKey)) {
            contentEl.blur();
            e.preventDefault();
          }
        });
        
        // Color picker handlers
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
        
        // Delete handler
        card.querySelector('.note-delete-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm("Are you sure you want to delete this note?")) {
            await DBService.deleteItem(item.id);
            showToast("Removed note");
            render();
          }
        });
        
        // Drag and drop setup for reordering items inside a collection
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
          card.classList.remove('drag-hover');
          
          if (draggedType === 'item' && draggedItemId && draggedItemId !== item.id) {
            await reorderItems(activeCollectionId, draggedItemId, item.id);
            render();
          }
        });
        
        container.appendChild(card);
      } else {
        const card = document.createElement('div');
        card.className = 'item-card';
        card.dataset.id = item.id;
        
        const domain = getDomainName(item.url);
        const formattedDate = new Date(item.created).toLocaleDateString(undefined, { 
          month: 'short', 
          day: 'numeric' 
        });
        
        // Safe MV3 favicon retrieval
        let faviconSrc = "";
        if (chrome.runtime && chrome.runtime.id) {
          faviconSrc = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(item.url)}&size=32`;
        } else {
          faviconSrc = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
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
          <img class="item-favicon" src="${faviconSrc}" alt="" 
            onerror="this.src='https://www.google.com/s2/favicons?sz=64&domain=${domain}'; this.onerror=function(){ this.style.display='none'; this.nextElementSibling.style.display='inline-flex'; }" />
          <div class="item-favicon-fallback" style="display:none; width:16px; height:16px; align-items:center; justify-content:center; background:var(--primary-light); color:var(--primary-color); border-radius:2px; font-size:10px; font-weight:bold; margin-top:3px; flex-shrink:0;">
            ${domain ? domain[0].toUpperCase() : 'W'}
          </div>
          <div class="item-details">
            <a class="item-title" href="${escapeHTML(item.url)}" target="_blank" title="${escapeHTML(item.title)}">${escapeHTML(item.title)}</a>
            <div class="item-meta">
              <span class="item-domain">${escapeHTML(domain)}</span>
              <span>&bull;</span>
              <span class="item-date">${formattedDate}</span>
            </div>
          </div>
          <div class="item-actions">
            <button class="icon-button-small delete-item-btn" title="Delete Link" data-id="${item.id}">
              <svg viewBox="0 0 24 24" width="14" height="14">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
          </div>
        `;
        
        // Let whole item card click open in new tab (except when clicking delete button or text selection)
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
          if (e.target.closest('.delete-item-btn')) return;
          if (window.getSelection().toString()) return; // Don't navigate if user is highlight-selecting title text
          
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
        
        // Delete listener
        card.querySelector('.delete-item-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = e.currentTarget.dataset.id;
          await DBService.deleteItem(id);
          showToast("Removed item");
          render();
        });
        
        // Drag and drop setup for reordering items inside a collection
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
          card.classList.remove('drag-hover');
          
          if (draggedType === 'item' && draggedItemId && draggedItemId !== item.id) {
            await reorderItems(activeCollectionId, draggedItemId, item.id);
            render();
          }
        });
        
        container.appendChild(card);
      }
    });
  } catch (err) {
    console.error("Render items error:", err);
  }
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
async function handleAddCurrentTab() {
  const btn = document.getElementById('add-current-tab-btn');
  btn.disabled = true;
  
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
      btn.disabled = false;
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
      const activeCol = collections.find(c => c.id === activeCollectionId);
      collectionName = activeCol ? activeCol.name : "Collection";
    }

    // Try to query thumbnail from active tab
    let thumbnail = "";
    try {
      if (chrome.tabs && chrome.scripting && activeTab.id) {
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

    // Save item
    await DBService.addItem(
      targetCollectionId,
      activeTab.title,
      activeTab.url,
      activeTab.favIconUrl || "",
      thumbnail
    );
    
    showToast(`Added to "${collectionName}"`);
    
    // If in Master View, dynamically refresh the count on card. 
    // If in Detail View, dynamically render the new item.
    render();
    
  } catch (err) {
    console.error("Add current tab error:", err);
    showToast("Error saving current tab.");
  } finally {
    btn.disabled = false;
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
                  thumbnail: item.thumbnail || ""
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
              favicon: item.favicon || ""
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
    
    // Filter matching collections
    const matchingCols = allCollections.filter(col => col.name.toLowerCase().includes(query));
    
    // Filter matching items
    const matchingItems = allItems.filter(item => {
      if (item.type === 'note') {
        return (item.content || "").toLowerCase().includes(query);
      } else {
        return (item.title || "").toLowerCase().includes(query) || (item.url || "").toLowerCase().includes(query);
      }
    });
    
    // Group matching items by collection
    const groupedItems = {};
    matchingItems.forEach(item => {
      if (!groupedItems[item.collectionId]) {
        groupedItems[item.collectionId] = [];
      }
      groupedItems[item.collectionId].push(item);
    });
    
    renderSearchResults(matchingCols, groupedItems, allCollections, query);
  } catch (err) {
    console.error("Global search query error:", err);
  }
}

function renderSearchResults(matchingCols, groupedItems, allCollections, query) {
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
    return;
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
      card.innerHTML = `
        <div class="collection-card-left">
          <div class="collection-icon-box">
            <svg class="icon-inline" viewBox="0 0 24 24" width="20" height="20">
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
          </div>
          <div class="collection-info">
            <span class="collection-name">${escapeHTML(col.name)}</span>
            <span class="collection-count">${col.count} ${col.count === 1 ? 'item' : 'items'}</span>
          </div>
        </div>
        <div class="collection-card-actions" style="opacity: 1;">
          <span class="search-group-header-right">View</span>
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
        if (item.type === 'note') {
          // Render note card
          const card = document.createElement('div');
          card.className = `note-card note-${item.color || 'yellow'}`;
          card.innerHTML = `
            <div class="note-content" style="max-height: 80px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">${escapeHTML(item.content)}</div>
            <div class="note-footer" style="margin-top: 4px; font-size: 9px; color: var(--text-tertiary);">Note</div>
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
          card.className = 'item-card';
          const domain = getDomainName(item.url);
          
          let faviconSrc = "";
          if (chrome.runtime && chrome.runtime.id) {
            faviconSrc = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(item.url)}&size=32`;
          } else {
            faviconSrc = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
          }
          
          card.innerHTML = `
            <img class="item-favicon" src="${faviconSrc}" alt="" onerror="this.src='https://www.google.com/s2/favicons?sz=64&domain=${domain}'; this.onerror=function(){ this.style.display='none'; this.nextElementSibling.style.display='inline-flex'; }" />
            <div class="item-favicon-fallback" style="display:none; width:16px; height:16px; align-items:center; justify-content:center; background:var(--primary-light); color:var(--primary-color); border-radius:2px; font-size:10px; font-weight:bold; margin-top:3px; flex-shrink:0;">
              ${domain ? domain[0].toUpperCase() : 'W'}
            </div>
            <div class="item-details" style="margin-left: 8px;">
              <a class="item-title" href="${escapeHTML(item.url)}" target="_blank" title="${escapeHTML(item.title)}">${escapeHTML(item.title)}</a>
              <div class="item-meta" style="font-size: 9px;">
                <span class="item-domain">${escapeHTML(domain)}</span>
              </div>
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
}

// Toggle Grid/List View
function handleToggleView() {
  const container = document.getElementById('items-container');
  const icon = document.getElementById('view-toggle-icon');
  
  if (!container || !icon) return;
  
  const currentPref = localStorage.getItem('collections_view_pref') || 'list';
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
  const otherCollections = collections.filter(c => c.id !== activeCollectionId);
  
  const moveListContainer = document.getElementById('move-collections-list');
  if (!moveListContainer) return;
  
  moveListContainer.innerHTML = '';
  
  if (otherCollections.length === 0) {
    moveListContainer.innerHTML = '<p style="font-size:12px; color:var(--text-secondary); text-align:center; padding:10px 0;">No other collections found. Create a new collection first.</p>';
  } else {
    otherCollections.forEach(col => {
      const itemEl = document.createElement('div');
      itemEl.className = 'move-collection-item';
      itemEl.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16">
          <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
        <span>${escapeHTML(col.name)}</span>
      `;
      itemEl.addEventListener('click', async () => {
        try {
          const transaction = db.transaction(['items'], 'readwrite');
          const store = transaction.objectStore('items');
          
          for (const id of selectedItemIds) {
            const item = await new Promise((res, rej) => {
              const req = store.get(id);
              req.onsuccess = () => res(req.result);
              req.onerror = () => rej(req.error);
            });
            
            if (item) {
              item.collectionId = col.id;
              delete item.sortOrder;
              store.put(item);
            }
          }
          
          showToast(`Moved ${selectedItemIds.size} items to "${col.name}"`);
          document.getElementById('move-modal').classList.add('hidden');
          
          selectionModeActive = false;
          selectedItemIds.clear();
          render();
        } catch (err) {
          console.error("Bulk move error:", err);
          showToast("Failed to move items.");
        }
      });
      moveListContainer.appendChild(itemEl);
    });
  }
  
  document.getElementById('move-modal').classList.remove('hidden');
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
    showToast("Active tab is not Bing Saves.");
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
