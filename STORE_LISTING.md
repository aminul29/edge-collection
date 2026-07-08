# Store Listing & Gumroad Submission Copy

Use the text below to update your Gumroad description and Microsoft Edge Add-ons store listing.

---

## 1. Gumroad Product Description Box (Privacy Policy Text)
*Copy and paste the text below into the description box of your Gumroad product details:*

```text
---
PRIVACY POLICY
---
Your privacy is our priority. The Edge Collections Sidebar extension operates entirely locally:
1. All your folder structures, links, and custom notes are stored locally in your browser's secure IndexedDB storage.
2. We do not collect, store, or transmit your personal data, browser history, or collection details to any external servers.
3. To validate your Pro features, the extension connects directly to the secure Gumroad API (https://api.gumroad.com) using your license key. This connection only transmits the license key and the product identifier to check your activation status. No personal or collections data is shared.
4. The extension is completely self-contained and loads all scripts, styles, and fonts locally, preventing external tracking.
5. If you uninstall the extension, your local collection database is deleted by your browser.
```

---

## 2. Microsoft Edge Add-ons Store Listing
*Copy and paste the text below into the "Detailed Description" section in the Microsoft Edge Partner Center:*

### Title (Max 64 characters)
`Edge Collections Sidebar`

### Short Description (Max 132 characters)
`Access and organize your saved pages, links, and notes in a clean, convenient sidebar. Import, export, and manage with ease.`

### Detailed Description (Up to 10,000 characters)
*Use the formatted text below to give your store listing a professional, feature-rich, and premium look:*

```text
Restore the classic, native-feeling Collections experience directly in your Microsoft Edge sidebar!

Edge Collections Sidebar is a clean, modern, and highly-productive productivity tool that lets you organize pages, save references, and write notes without leaving your current tab. Built using the latest Manifest V3 standards, it provides a fast, responsive, and completely private space to curate your web findings.

Whether you are conducting deep research, organizing project tasks, plan-making, or just saving interesting articles to read later, Edge Collections Sidebar is the perfect companion.

---

★ KEY FEATURES

• DOCK IN THE SIDEBAR: Keeps your active tab clear while you browse, drag, and drop references directly into your sidebar.
• RESTORE BING SAVES / MICROSOFT COLLECTIONS: Seamlessly import your existing collections from "bing.com/saves" with a single click.
• ORGANIZE IN FOLDERS: Create custom collections, name them, choose colors, and sort them to fit your workflow.
• INTERACTIVE NOTES: Add rich-text notes inside your collections with custom colors to highlight key thoughts, tasks, or summaries.
• EASY DRAG-AND-DROP: Reorder collections, move links, and arrange your structure effortlessly.
• BULK ACTIONS: Select multiple links to open them all at once in new tabs, copy URLs, move them between folders, or delete them in batches.
• 100% PRIVATE & LOCAL: All your data is stored securely in your browser's IndexedDB. No external servers, no tracking, and no third-party data sharing.
• OFFLINE BACKUPS: Export your collections as clean JSON backup files and import them on other devices to keep your workspaces synced.

---

★ PRO WORKFLOW UPGRADES

Get the most out of your sidebar with our optional Pro upgrade:
• Free users can create up to 5 collections with unlimited links, notes, imports, exports, and bulk actions.
• Pro users unlock unlimited collections and the premium "Sync from Microsoft Edge Collections" feature.

---

★ SECURE & LIGHTWEIGHT

We value extension speed and security:
• Fully Manifest V3 compliant.
• No external tracking scripts, CDNs, or network analytics calls.
• Fully self-contained font styling and graphics for instant loads and zero tracking.
```

---

## 3. Privacy & Permissions Submission Form Answers
*Copy and paste these exact justifications into the Partner Center submission form fields:*

### Single purpose description
```text
The single purpose of this extension is to provide a dedicated, docked sidebar where users can save, organize, import, and manage web pages, links, and notes locally in their browser.
```

### sidePanel justification
```text
Required to display the main user interface for managing collections and notes in a docked sidebar alongside the active browsing tab.
```

### storage justification
```text
Required to persist extension preferences and Pro/licensing activation status locally on the user's device.
```

### tabs justification
```text
Required to detect changes in the active tab URL to support the 'Add Current Tab' feature and automatically verify if the user is on the Bing Saves page for migration.
```

### activeTab justification
```text
Required to safely read the URL and Title of the currently active tab when the user clicks 'Add Current Tab' to add it to their collection.
```

### scripting justification
```text
Required to execute the local scraper script (bing_scraper.js) in the context of the user's open bing.com/saves page to import their existing collections.
```

### Host permission justification
```text
<all_urls> is required to capture a small local screenshot thumbnail of the visible active tab when the user clicks "Add Tab". These thumbnails are stored locally with the saved collection item and are not transmitted to any server. https://*.bing.com/* is required to execute the scraping script on the bing.com/saves tab for importing existing collections. https://api.gumroad.com/* is required to communicate with the Gumroad licensing API to validate the user's Pro license key.
```

### Are you using remote code?
*Select **No***

### Justification (for Remote Code)
```text
No remote code is used. All code, styles, and assets (including fonts and icons) are packaged locally within the extension zip file.
```

### What user data do you plan to collect...
*Select **None** (Ensure no data types are selected, as the extension stores everything locally).*

### Privacy policy URL
```text
https://aminul29.github.io/edge-collection/privacy.html
```

### I certify that the following disclosures are true
*Check **all three** certification checkboxes.*
