/**
 * Bing Saves Scraper Content Script
 * Injected dynamically into https://www.bing.com/saves
 * Communicates progress and final results back to the sidebar.
 */
(async () => {
  const log = (...args) => console.log('%c[BingScraper]', 'color:#0078d4; font-weight:bold;', ...args);
  log("Scraper script loaded and running...");

  // Abort controller flag
  let isAborted = false;

  // Listen for cancel/abort messages from the sidepanel
  const messageListener = (msg) => {
    if (msg && msg.type === 'BING_SAVE_CANCEL') {
      log("Cancellation requested by sidepanel.");
      isAborted = true;
    }
  };
  chrome.runtime.onMessage.addListener(messageListener);

  // Constants & selectors
  const SEL = {
    collection: '.collection, [role="tab"].collection',
    card: '.card',
    folderTile: '.card.card_refresh',     // a sub-collection tile link on root page
    cardLink: 'a.card__link',
    title: '.card__title',
    label: '.card__label',
    footnote: '.card__footnote',
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // Helper selectors
  const getCollTabs = () => [...document.querySelectorAll(SEL.collection)]
    .filter(c => (c.getAttribute('aria-label') || '').trim());
  
  const getCollName = el => (el.getAttribute('aria-label') || '').trim();
  
  const getCollByName = name => getCollTabs().find(c => getCollName(c) === name);
  
  const getActiveColl = () => document.querySelector('.collection.active, .collection[aria-selected="true"]');
  
  const getFolderTiles = () => [...document.querySelectorAll(SEL.folderTile)]
    .filter(c => !c.querySelector('a[href]'));
  
  const getTileByName = name => getFolderTiles()
    .find(c => (c.querySelector(SEL.title)?.textContent || '').trim() === name);

  // Dynamic scrolling to load lazy elements
  const loadAllCards = async () => {
    let prev = -1, stable = 0;
    for (let i = 0; i < 100; i++) {
      if (isAborted) return;
      const cards = document.querySelectorAll(SEL.card);
      const n = cards.length;
      if (cards[n - 1]) {
        cards[n - 1].scrollIntoView({ block: 'end' });
      }
      await sleep(250);
      if (n === prev) {
        stable++;
        if (stable >= 3) break;
      } else {
        stable = 0;
      }
      prev = n;
    }
    
    // Scroll back to top
    if (document.querySelectorAll(SEL.card)[0]) {
      document.querySelectorAll(SEL.card)[0].scrollIntoView({ block: 'start' });
    }
    await sleep(150);
  };

  // Wait until view changed and count is stable
  const waitViewToLoad = async (prevSearch, requireUrlChange = true) => {
    let last = -1, stable = 0, urlOk = !requireUrlChange;
    for (let i = 0; i < 60; i++) {
      if (isAborted) return;
      await sleep(150);
      if (requireUrlChange && location.search !== prevSearch) {
        urlOk = true;
      }
      const n = document.querySelectorAll(SEL.card).length;
      if (urlOk) {
        if (n === last) {
          stable++;
          if (stable >= 2) break;
        } else {
          stable = 0;
        }
      }
      last = n;
    }
    await sleep(150);
  };

  // Scrape current visible collection cards
  const scrapeCurrentView = () => {
    const items = [];
    const seenUrls = new Set();
    let skipped = 0;

    document.querySelectorAll(SEL.card).forEach(card => {
      const anchor = card.querySelector(SEL.cardLink) || card.querySelector('a[href]');
      if (!anchor) {
        skipped++;
        return;
      }

      let href = anchor.getAttribute('href');
      if (!href) {
        skipped++;
        return;
      }

      let url;
      try {
        url = new URL(href, location.href).href;
      } catch (e) {
        skipped++;
        return;
      }

      // Check if it's a valid link (HTTP/S) and not internal/relative notes
      if (!/^https?:/i.test(url)) {
        skipped++;
        return;
      }

      if (seenUrls.has(url)) return;
      seenUrls.add(url);

      let title = (card.querySelector(SEL.title)?.textContent
                  || card.querySelector(SEL.label)?.textContent
                  || anchor.getAttribute('aria-label')
                  || card.querySelector(SEL.footnote)?.textContent || '').trim();

      if (!title) {
        try {
          title = new URL(url).hostname;
        } catch (e) {
          title = url;
        }
      }

      items.push({
        title: title,
        url: url,
        favicon: ""
      });
    });

    return { items, skipped };
  };

  // Send progress helper
  const sendProgress = (stepIndex, totalSteps, statusText, detailsText = '') => {
    chrome.runtime.sendMessage({
      type: 'BING_SAVE_PROGRESS',
      stepIndex,
      totalSteps,
      statusText,
      detailsText
    });
  };

  // Main scraper loop
  try {
    sendProgress(0, 100, "Initializing scraper...", "Checking page elements...");
    await sleep(300);

    // 1) Go to Root collection (first tab or active tab)
    const rootTab = getActiveColl() || getCollTabs()[0];
    const rootName = rootTab ? getCollName(rootTab) : 'Saved';
    
    log(`Identified root tab: "${rootName}"`);
    
    const gotoRoot = async () => {
      const tab = getCollByName(rootName) || getActiveColl() || getCollTabs()[0];
      if (tab) {
        tab.click();
      }
      // Wait for it to become active
      for (let i = 0; i < 40; i++) {
        if (isAborted) return;
        await sleep(150);
        const active = getActiveColl();
        if (active && getCollName(active) === rootName && getFolderTiles().length >= 0) {
          break;
        }
      }
      await sleep(250);
    };

    if (isAborted) throw new Error("Import cancelled by user");
    sendProgress(1, 5, "Navigating to default collection...", `Opening ${rootName}...`);
    await gotoRoot();
    
    if (isAborted) throw new Error("Import cancelled by user");
    sendProgress(2, 5, "Loading default collection links...", "Scrolling to fetch all items...");
    await loadAllCards();

    // 2) Parse sub-collections names
    const subNamesFromTiles = getFolderTiles().map(c => (c.querySelector(SEL.title)?.textContent || '').trim()).filter(Boolean);
    const subNamesFromRail = getCollTabs().map(getCollName).filter(n => n && n !== rootName);
    const subNames = [...new Set([...subNamesFromTiles, ...subNamesFromRail])];

    if (isAborted) throw new Error("Import cancelled by user");
    log(`Scraping root folder links...`);
    const rootScraped = scrapeCurrentView();
    
    const collections = [{
      name: rootName,
      items: rootScraped.items
    }];
    
    const totalCollections = 1 + subNames.length;
    log(`Root folder "${rootName}" contains ${rootScraped.items.length} items. Found ${subNames.length} sub-collections.`);
    
    // 3) Visit and scrape each sub-collection
    let stepIndex = 1;
    for (const name of subNames) {
      if (isAborted) throw new Error("Import cancelled by user");
      stepIndex++;
      
      const progressPercent = Math.min(2 + Math.floor((stepIndex / totalCollections) * 3), 5);
      sendProgress(
        progressPercent,
        5,
        `Processing folder: ${name}`,
        `Loading items for collection ${stepIndex} of ${totalCollections}...`
      );

      const railTab = getCollByName(name);
      const prevSearch = location.search;

      if (railTab) {
        railTab.click();
        await waitViewToLoad(prevSearch, true);
      } else {
        // Fallback: Click root tab, find the folder tile on the dashboard, and click it
        await gotoRoot();
        if (isAborted) throw new Error("Import cancelled by user");
        const prevSearch2 = location.search;
        const tile = getTileByName(name);
        if (!tile) {
          log(`Warning: Folder tile "${name}" not found! Skipping.`);
          continue;
        }
        tile.click();
        await waitViewToLoad(prevSearch2, true);
      }

      if (isAborted) throw new Error("Import cancelled by user");
      await loadAllCards();
      
      if (isAborted) throw new Error("Import cancelled by user");
      const scraped = scrapeCurrentView();
      collections.push({
        name: name,
        items: scraped.items
      });
      log(`Scraped sub-collection "${name}": ${scraped.items.length} links (skipped ${scraped.skipped} non-link items).`);
    }

    if (isAborted) throw new Error("Import cancelled by user");
    
    // 4) Deduplication of root collection (optional but very clean)
    // Root represents "Recently Saved", which contains items already inside folders.
    // If we have sub-collections, let's remove items from root that exist in sub-collections.
    if (collections.length > 1) {
      const subCollectionUrls = new Set();
      for (let i = 1; i < collections.length; i++) {
        collections[i].items.forEach(item => subCollectionUrls.add(item.url));
      }
      
      const rootFolder = collections[0];
      const beforeCount = rootFolder.items.length;
      rootFolder.items = rootFolder.items.filter(item => !subCollectionUrls.has(item.url));
      const removedCount = beforeCount - rootFolder.items.length;
      log(`Deduplication: Removed ${removedCount} duplicates from default folder "${rootFolder.name}".`);
      
      // If root folder is empty after deduplication, remove it from list
      if (rootFolder.items.length === 0) {
        collections.shift();
        log(`Default folder "${rootFolder.name}" was fully duplicated, omitting.`);
      }
    }

    // Done! Send results back
    if (isAborted) throw new Error("Import cancelled by user");
    
    sendProgress(5, 5, "Completed scraping!", "Sending data back to Collections Sidebar...");
    await sleep(200);

    chrome.runtime.sendMessage({
      type: 'BING_SAVE_COMPLETE',
      collections: collections
    });
    
    log("Scraper complete! Sent BING_SAVE_COMPLETE with data.");
  } catch (error) {
    log("Error during scraping:", error);
    chrome.runtime.sendMessage({
      type: 'BING_SAVE_ERROR',
      message: error.message || "An unknown error occurred during parsing."
    });
  } finally {
    // Cleanup listeners
    chrome.runtime.onMessage.removeListener(messageListener);
  }
})();
