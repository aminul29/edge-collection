// State Management
let db = null;
let currentView = 'master'; // 'master' or 'detail'
let activeCollectionId = null;
let collectionsList = []; // Caching collections for search filtering
let activeCollectionItems = []; // Caching items for search filtering

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
        
        // Sort collections by creation date (newest on top)
        result.sort((a, b) => b.created - a.created);
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
        // Sort items by creation date (newest on top)
        items.sort((a, b) => b.created - a.created);
        resolve(items);
      };
      
      request.onerror = (e) => reject(e.target.error);
    });
  },

  addItem(collectionId, title, url, favicon) {
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
        created: Date.now()
      };
      
      const request = store.add(item);
      request.onsuccess = () => resolve(item);
      request.onerror = (e) => reject(e.target.error);
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
            title: item.title || "Untitled",
            url: item.url,
            favicon: item.favicon || "",
            created: Date.now() - (group.items.length - itemIndex) * 10 // slightly spacing creation times
          };
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
          itemsMap[item.collectionId].push({
            title: item.title,
            url: item.url,
            favicon: item.favicon || ""
          });
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
  document.getElementById('back-button').addEventListener('click', () => {
    setView('master');
  });

  // Action Bar Buttons
  document.getElementById('add-current-tab-btn').addEventListener('click', handleAddCurrentTab);
  
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
}

// --- View Router ---
function setView(view, collectionId = null) {
  currentView = view;
  activeCollectionId = collectionId;
  
  const backBtn = document.getElementById('back-button');
  const viewTitle = document.getElementById('view-title');
  const masterPanel = document.getElementById('collections-list-view');
  const detailPanel = document.getElementById('collection-items-view');
  const searchInput = document.getElementById('search-input');
  const inlineForm = document.getElementById('inline-creation-form');
  
  inlineForm.classList.add('hidden');
  searchInput.value = '';

  if (view === 'master') {
    backBtn.classList.add('hidden');
    viewTitle.textContent = "Collections";
    masterPanel.classList.remove('hidden');
    detailPanel.classList.add('hidden');
    searchInput.placeholder = "Search collections...";
  } else if (view === 'detail') {
    backBtn.classList.remove('hidden');
    masterPanel.classList.add('hidden');
    detailPanel.classList.remove('hidden');
    searchInput.placeholder = "Search items...";
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
      card.className = 'collection-card';
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
          <button class="icon-button-small delete-col-shortcut" title="Delete Collection" data-id="${col.id}">
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      `;
      
      // Click to open collection
      card.addEventListener('click', (e) => {
        // Prevent opening if clicking shortcut delete
        if (e.target.closest('.delete-col-shortcut')) return;
        setView('detail', col.id);
      });
      
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
  
  try {
    // Refresh collection metadata (for name/rename sync)
    const collections = await DBService.getAllCollections();
    const activeCol = collections.find(c => c.id === activeCollectionId);
    
    if (!activeCol) {
      // Collection deleted elsewhere
      setView('master');
      return;
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
    const filteredItems = activeCollectionItems.filter(item => 
      item.title.toLowerCase().includes(searchVal) || 
      item.url.toLowerCase().includes(searchVal)
    );
    
    filteredItems.forEach(item => {
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

      card.innerHTML = `
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
        if (e.target.closest('.delete-item-btn')) return;
        if (window.getSelection().toString()) return; // Don't navigate if user is highlight-selecting title text
        
        e.preventDefault();
        if (chrome.tabs) {
          chrome.tabs.create({ url: item.url });
        } else {
          window.open(item.url, '_blank');
        }
      });
      
      // Delete listener
      card.querySelector('.delete-item-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        await DBService.deleteItem(id);
        showToast("Removed item");
        render();
      });
      
      container.appendChild(card);
    });
  } catch (err) {
    console.error("Render items error:", err);
  }
}

// --- Action Handlers ---

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

    // Save item
    await DBService.addItem(
      targetCollectionId,
      activeTab.title,
      activeTab.url,
      activeTab.favIconUrl || ""
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
            .filter(item => item && (item.url || item.link))
            .map(item => ({
              title: item.title || item.name || item.url || item.link || "Untitled",
              url: item.url || item.link,
              favicon: item.favicon || ""
            }));
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
            .filter(item => item && (item.url || item.link))
            .map(item => ({
              title: item.title || item.name || item.url || item.link || "Untitled",
              url: item.url || item.link,
              favicon: item.favicon || ""
            }));
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
function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();
  
  if (currentView === 'master') {
    // Re-render master view which will automatically filter using cached collectionsList
    renderCollectionsList();
  } else if (currentView === 'detail') {
    // Re-render detail view which will automatically filter using cached activeCollectionItems
    renderCollectionDetails();
  }
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
