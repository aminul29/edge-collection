# Edge Collections Sidebar: Master Marketing & Product Dossier
*The Ultimate Source of Truth, Product History, Positioning, and Omnichannel Content Playbook*

---

## 1. Executive Summary & The Genesis Story

### The Discontinuation of Microsoft Edge Collections
* **Phase 1 (Edge v145):** Microsoft initiated a stealth phase-out by locking the feature, preventing users from adding new web pages or items to their collections.
* **Phase 2 (June 4, 2026 — Microsoft Edge v149):** Microsoft officially retired and stripped the native Collections user interface out of Microsoft Edge entirely. 
* **The Aftermath:** Millions of active users—researchers, developers, students, and everyday power users who relied on Edge Collections as their daily workspace—woke up to find their collections missing from the browser sidebar. Personal account data was banished to an obscure web page (`bing.com/saves`), where items lacked browser integration, rich notes were stripped or disconnected from links, and no docked sidebar existed. Enterprise/work users who missed the export deadline suffered permanent loss of their curated research.
* **Microsoft's Justification:** Microsoft claimed the retirement was intended to "simplify the browser and focus on higher-value experiences" while nudging users toward basic browser Favorites and Microsoft OneNote. In reality, Favorites lack interactive notes, visual previews, color coding, and flexible grouping; OneNote is too heavy and disconnected from daily tab navigation.

### The Genesis of Edge Collections Sidebar
* **The Launch Date (June 14, 2026):** Exactly 10 days after Microsoft killed Collections, the first working version (`fa89eef`) of **Edge Collections Sidebar** was built.
* **The Core Mission:** Restore the beloved, docked sidebar collections experience directly inside Microsoft Edge—and then take it a step further by bringing it to Google Chrome, which has never had a native collections workspace.
* **The Evolution (v1.0.0 → v1.1.2):** What started as a rescue utility to restore classic functionality has grown into a modern, local-first power tool featuring nested sub-folders, native browser tab group capture, rich per-tab notes, sticky note cards, multi-select bulk operations, and cross-device cloud synchronization.

---

## 2. Chronological Product History & Git Commits Deep Dive

Every major capability in the extension was born out of real user feedback, usability hurdles, and continuous engineering iterations:

| Date | Version / Commit | Milestone & Strategic Value |
| :--- | :--- | :--- |
| **2026-06-14** | `fa89eef` | **First Version:** Established the core sidebar architecture using Manifest V3 `sidePanel` API and local browser `IndexedDB` storage. |
| **2026-06-14** | `2d72042` | **Sticky Note Cards:** Added rich, color-coded sticky notes (yellow, blue, green, pink, purple) inside collections, restoring Edge's missing note-taking capability. |
| **2026-06-14** | `1d98fd2` | **Drag-and-Drop Reordering:** Fluid drag-and-drop mechanics to manually sort links and notes within collections. |
| **2026-06-14** | `23f79be` | **Multi-Select & Bulk Actions:** Checkbox selection mode to open tabs in bulk, copy formatted Markdown links to clipboard, or mass-delete. |
| **2026-06-15** | `85fdf57` | **Color-Coded Collections:** Introduced collection-level accent color themes for visual workspace separation. |
| **2026-06-15** | `87d390a` - `dfc0414` | **Bing Saves Importer (`bing_scraper.js`):** Built a 1-click automated scraper script that logs into `bing.com/saves`, extracts stranded folders/links/notes, and imports them locally into IndexedDB. |
| **2026-06-15** | `27abb19` - `795b171` | **Store Launch (v1.0.0):** Microsoft Edge Add-ons store submission, landing page creation, and permission audit hardening. |
| **2026-07-08** | `8bca06d` - `ec79dba` | **Pro Licensing & Thumbnail Enhancements:** Gumroad API activation gating (free tier up to 5 collections; Pro unlocks unlimited collections and Bing Saves scraper). |
| **2026-07-09** | `94d816b` | **Per-Tab Notes & Custom Card Themes (v1.0.8):** Added inline notes attached directly to individual saved links, plus individual card color highlighting. |
| **2026-09-19** | `a330497` | **Nested Tab Grouping & Sub-Groups (v1.0.9):** Deep folder hierarchies, drag-and-drop nesting, native browser `tabGroups` auto-capture upon saving tabs, and per-group list/grid views. |
| **2026-09-19** | `bf2b4ff` | **Pro Cloud Accounts & Two-Way Sync (v1.1.0):** Integrated Supabase backend (`sync_service.js`) for optional real-time, encrypted two-way synchronization across multiple machines. |
| **2026-09-20** | `91a720b` | **Resilient Nested Saving (v1.1.1):** Fixed target collection resolving, sanitized PointerEvents in IndexedDB, and introduced automatic ancestor group expansion. |
| **2026-09-21** | `b156f06` | **Add Note Everywhere (v1.1.2):** Introduced `Add Note to this Group` action inside folder headers, note document iconography, and responsive CSS flexbox wrapping for tab notes. |

---

## 3. Core Philosophy & Value Propositions (Why We Win)

### 1. Local-First & Zero Telemetry
* **100% Client-Side Privacy:** Everything lives in the user's browser IndexedDB by default. No analytics, no Google Analytics trackers, no tracking pixels, and no browsing history harvesting.
* **Offline Ready:** The extension works seamlessly on airplanes, trains, or during internet outages.

### 2. Native Sidebar Experience (Manifest V3 Side Panel)
* Unlike legacy extensions that open in a popup window (which closes the moment you click away) or full-screen dashboards that hijack your current tab, our extension docks permanently alongside your web page.
* You browse on the left; you organize, save, and annotate on the right.

### 3. Freedom from Cloud SaaS Subscriptions
* Most modern bookmark/tab managers (Raindrop.io, Toby, Notion Web Clipper) force users into monthly $5-$10/month recurring cloud subscriptions and host personal browsing data on external servers.
* Edge Collections Sidebar gives users a **generous free core** and an **affordable Lifetime Pro license**, keeping costs fixed and data local.

### 4. 1-Click Bing Saves Rescue
* No other extension on the market provides an automated in-browser scraper script (`bing_scraper.js`) specifically engineered to crawl `bing.com/saves` and reconstruct lost Edge Collections with one click.

### 5. Nested Sub-Folders & Native Browser Group Capture
* Most tab managers only offer a flat list. We offer unlimited multi-level nested folders with drag-and-drop nesting.
* If you have grouped tabs open in your browser, clicking "Add Tab" detects your native tab group and reproduces it inside your collection automatically.

---

## 4. Target Audience Personas & Emotional Drivers

### Persona 1: "The Stranded Edge Power User"
* **Demographics:** Professionals, developers, system admins, enterprise knowledge workers.
* **Pain Point:** "Microsoft ruined my workflow. June 4 came, and Collections vanished. My research is trapped in Bing Saves, Favorites are useless, and OneNote is too bulky."
* **Emotional Hook:** Relief, nostalgia, vindication ("Get back what Microsoft took away").
* **Key Feature:** 1-Click Bing Saves Importer + Native Sidebar feel.

### Persona 2: "The Chronic Tab Hoarder"
* **Demographics:** Students, freelancers, agency owners, digital marketers, general internet users.
* **Pain Point:** 60+ tabs open across 4 windows. Laptop fans screaming, RAM at 95%. Terrified of closing tabs because they'll "need them later."
* **Emotional Hook:** Calm, clarity, cognitive relief, decluttering.
* **Key Feature:** 1-Click "Save All Tabs", Bulk Open, Grouping, and Instant Search.

### Persona 3: "The Deep Academic / Researcher / Writer"
* **Demographics:** Graduate students, authors, journalists, UX/market researchers.
* **Pain Point:** Bookmarks only store URLs, but research requires context. Why did I save this link? What was the quote?
* **Emotional Hook:** Synthesis, intellectual organization, focus.
* **Key Feature:** Per-tab contextual notes, sticky note cards with color codes, nested topic folders.

### Persona 4: "The Privacy & Anti-SaaS Advocate"
* **Demographics:** Open-source enthusiasts, privacy-conscious power users.
* **Pain Point:** Sick of software-as-a-service rent-seeking, account creation friction, and data brokers tracking web activity.
* **Emotional Hook:** Data sovereignty, speed, simplicity.
* **Key Feature:** Local IndexedDB storage, JSON export/backup, zero telemetry, optional one-time buy.

---

## 5. Competitive Feature Comparison Matrix

| Feature | Edge Collections Sidebar | Microsoft Edge Collections (Retired) | Chrome Side Panel / Reading List | Raindrop.io | OneTab |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Sidebar Docked View** | ✅ **Yes** | ❌ Discontinued | ⚠️ Very Basic | ⚠️ Limited | ❌ Full tab |
| **Chrome & Edge Cross-Browser** | ✅ **Yes** | ❌ Edge only | ❌ Chrome only | ✅ Yes | ✅ Yes |
| **Local-First (No Account Needed)**| ✅ **Yes** | ❌ Cloud tied | ⚠️ Google Sync | ❌ Cloud-only | ✅ Yes |
| **1-Click Bing Saves Migration** | ✅ **Yes (Exclusive)**| ❌ N/A | ❌ No | ❌ No | ❌ No |
| **Nested Sub-Folders** | ✅ **Yes** | ❌ Flat only | ❌ No | ✅ Paid only | ❌ No |
| **Sticky Note Cards** | ✅ **Yes (5 colors)** | ⚠️ Basic text | ❌ No | ❌ No | ❌ No |
| **Per-Tab Contextual Notes** | ✅ **Yes** | ❌ No | ❌ No | ✅ Yes | ❌ No |
| **Native TabGroups Capture** | ✅ **Yes** | ❌ No | ❌ No | ❌ No | ❌ No |
| **Bulk Open / Markdown Export** | ✅ **Yes** | ⚠️ Partial | ❌ No | ✅ Yes | ⚠️ Raw text |
| **Pricing Model** | **Free + Lifetime Pro** | Free (Discontinued)| Free | $40+/year sub | Free |

---

## 6. Omnichannel Marketing Copy & Distribution Blueprint

### Campaign Track A: "The Edge Collections Rescue" (Urgency & Relief)

#### 1. Reddit Post Template
* **Target Subreddits:** `r/MicrosoftEdge`, `r/edge`, `r/browsers`, `r/windows`, `r/productivity`
* **Title Ideas:**
  * *Miss Microsoft Edge Collections after the June update? I spent the summer rebuilding it from scratch.*
  * *If Microsoft Edge version 149 broke your research workflow, here is how to get your Collections back.*
  * *How I restored the classic Edge Collections sidebar (and rescued all my lost Bing Saves links).*

```markdown
Hey everyone,

Like many of you, I was devastated when Microsoft officially killed the Collections sidebar in Edge version 149 on June 4. Moving items to Favorites just isn't the same—Favorites don't have visual preview cards, color coding, sticky notes, or a dedicated dockable sidebar. And accessing old links via bing.com/saves is clumsy and slow.

Rather than waiting for Microsoft to change their mind, I built an extension: **Edge Collections Sidebar**.

What it does:
1. **Restores the classic sidebar UI:** Sits cleanly in your Edge sidebar (and works on Chrome too).
2. **1-Click Bing Saves Rescue:** Injects an automated tool to scrape and import all your old folders and links from bing.com/saves straight into your browser.
3. **Sticky Notes & Per-Tab Notes:** Add color-coded sticky notes to folders, or attach notes directly to individual tabs so you remember why you saved them.
4. **Nested Sub-Folders:** Multi-level folder nesting with drag-and-drop (something native Edge Collections never even supported!).
5. **100% Local & Private:** All data lives in your browser's IndexedDB. No tracking, no external servers, no ads.

The core extension is completely free (up to 5 collections with unlimited tabs and notes). If you need unlimited folders or cross-device cloud sync, there's a simple Lifetime Pro option.

I just pushed v1.1.2 with full support for notes inside nested sub-folders. 

Would love to hear your thoughts and feedback!
👉 Edge Add-ons: [Link]
👉 Chrome Web Store: [Link]
```

#### 2. Twitter / X Viral Thread
```text
1/7 🚨 Still mourning the loss of Microsoft Edge Collections after the June 4 update?

Microsoft removed the sidebar UI and exiled everyone's links to bing.com/saves. 

So I rebuilt it from scratch—and added the features Microsoft never gave us. 🧵👇

2/7 Edge Collections was the best productivity feature Microsoft ever built. 
Favorites are boring. OneNote is too bulky. 
A lightweight, dockable sidebar for tabs and notes is the sweet spot.

3/7 Here is what Edge Collections Sidebar brings back:
✅ Native dockable sidebar (Edge + Chrome)
✅ 1-Click Bing Saves auto-migration
✅ Nested folders with drag-and-drop
✅ Color-coded sticky note cards
✅ Inline notes attached to individual links
✅ 100% local IndexedDB privacy

4/7 📁 The biggest upgrade over Microsoft's native version:
NESTED SUB-GROUPS. 
You can now nest project folders inside client folders, complete with list or grid views and custom color dot indicators.

5/7 📝 In today's v1.1.2 release, you can now add standalone notes inside nested sub-folders and attach quick annotations directly to any saved link.

6/7 🔒 Privacy first: Zero tracking. Zero telemetry. No account required to get started. All your data stays on your machine.

7/7 Reclaim your sidebar workflow today:
Edge Add-ons: [URL]
Chrome Web Store: [URL]

RT to help a stranded Edge user! 🔁
```

---

### Campaign Track B: "The Supercharged Tab Workspace" (General Productivity & Chrome)

#### 1. Short-Form Video Storyboard (TikTok / YouTube Shorts / Reels / X)
* **Duration:** 30–45 Seconds
* **Pacing:** High-energy, relatable problem, snappy visual transformation.

| Second | Visual Scene | Voiceover / Text Overlay |
| :---: | :--- | :--- |
| **0:00 - 0:04** | **Hook:** Zoom in on a chaotic browser window with 75 tiny, unreadable tabs. Laptop fan noise SFX. | *"Be honest... does your browser look like this right now?"* [Text: Stop hoarding 80 tabs] |
| **0:04 - 0:10** | **Pain:** Mouse hovering frantically trying to find the one tab with that important article or recipe. | *"You keep them open because you're terrified you'll forget them. But it's slowing down your brain and your laptop."* |
| **0:10 - 0:18** | **Action:** Click the sidebar icon. A clean, modern panel slides open. Drag tabs into organized, color-coded folders. | *"Instead, open this docked Collections sidebar. Group your research into nested folders with one click."* |
| **0:18 - 0:26** | **Feature Flex:** Show a color-coded sticky note being typed, then show a per-tab note preview. | *"You can drop sticky notes, add annotations directly to your links, and even capture browser tab groups automatically."* |
| **0:26 - 0:35** | **Climax & CTA:** Click "Close all tabs", showing a pristine, empty browser with everything neatly organized on the right. | *"Close the tabs. Keep your brain clear. Download Edge Collections Sidebar on Chrome and Edge today."* |

#### 2. Product Hunt Launch Asset Blueprint
* **Tagline:** The native collections and notes sidebar Microsoft retired—now for Edge & Chrome.
* **Short Description:** Organize tabs into nested folders, attach contextual notes, and rescue your lost Bing saves in a fast, local-first sidebar workspace.
* **Maker Comment Hook:**
  > *"Hey Product Hunt! 👋 I built Collections Sidebar because I was fed up with bloated cloud bookmark apps that charge $10/month just to remember web pages, and furious when Microsoft killed Edge Collections in June. I wanted a permanent sidebar that lives right next to my active tab, stores everything locally in IndexedDB with zero tracking, and lets me organize research with nested folders and color-coded notes. It's completely free to use—let me know what you think!"*

---

## 7. App Store Optimization (ASO) & SEO Keyword Blueprint

### Search Volume Drivers (Keywords to Target)
* **Primary High-Intent Keywords:**
  * `Edge collections alternative`
  * `Microsoft edge collections missing`
  * `Restore edge collections`
  * `Edge collections sidebar`
  * `Tab manager sidebar`
  * `Vertical tabs notes`
  * `Save tabs and notes`
  * `Bing saves export import`
  * `Chrome collections sidebar`
* **Long-Tail Problem Keywords:**
  * `How to get edge collections back after update`
  * `Edge version 149 collections removed`
  * `Best tab manager with sticky notes`
  * `Local first bookmark manager extension`

### Optimized Store Titles & Descriptions
* **Edge Store Title:** `Edge Collections Sidebar - Save Tabs & Notes`
* **Chrome Store Title:** `Collections Sidebar - Save Tabs & Notes`
* **Core Hook in First 3 Lines of Store Description:**
  > *"Restore the classic, native Collections experience directly in your browser sidebar! Organize research into nested folders, take rich notes, and rescue your lost Bing saves with zero tracking."*

---

## 8. Monetization Strategy: Lifetime Pro vs. Free

* **The Free Tier (Generous & Habit-Forming):**
  * Up to 5 full collections.
  * Unlimited saved links & tabs.
  * Unlimited sticky notes & tab notes.
  * Drag-and-drop organization.
  * Multi-select bulk actions (open all, copy markdown, delete).
  * Offline JSON export & backup.
* **The Lifetime Pro Value Proposition (Scarcity & Power):**
  * Unlimited collections & unlimited nested sub-groups.
  * Automated 1-Click Bing Saves Scraper & Importer.
  * Cross-device real-time cloud account backup via encrypted Supabase sync.
  * Custom theme accents.
  * **Marketing Hook:** *"Early Supporter Offer: Unlock Lifetime Pro before we transition to annual subscriptions!"*
