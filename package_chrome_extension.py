import json
import os
import zipfile


CHROME_EXTENSION_NAME = "Collections Sidebar - Save Tabs & Notes"


def package_chrome_extension():
    os.makedirs("dist", exist_ok=True)

    with open("manifest.json", "r", encoding="utf-8") as manifest_file:
        manifest = json.load(manifest_file)

    version = manifest["version"]
    zip_name = f"collections-sidebar-save-tabs-notes-chrome-v{version}.zip"
    zip_path = os.path.join("dist", zip_name)

    manifest["name"] = CHROME_EXTENSION_NAME
    manifest["action"]["default_title"] = "Collections Sidebar"
    manifest["host_permissions"] = [
        permission
        for permission in manifest.get("host_permissions", [])
        if permission != "<all_urls>"
    ]

    include_files = [
        "background.js",
        "bing_scraper.js",
        "supabase_client.js",
        "sync_service.js",
        "sidepanel.js",
        "sidepanel.html",
        "sidepanel.css",
        "fonts.css",
    ]

    include_dirs = [
        "icons",
        "fonts",
    ]

    print(f"Creating Chrome Web Store package at {zip_path}...")

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
        zip_file.writestr(
            "manifest.json",
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        )
        print("Adding Chrome manifest: manifest.json")

        for filename in include_files:
            if not os.path.exists(filename):
                print(f"WARNING: Required file {filename} not found!")
                continue

            if filename == "sidepanel.html":
                with open(filename, "r", encoding="utf-8") as html_file:
                    html = html_file.read()
                html = html.replace(
                    "<title>Edge Collections Sidebar</title>",
                    f"<title>{CHROME_EXTENSION_NAME}</title>",
                )
                zip_file.writestr(filename, html)
                print(f"Adding Chrome-adjusted file: {filename}")
            else:
                zip_file.write(filename)
                print(f"Adding file: {filename}")

        for dirname in include_dirs:
            if not os.path.exists(dirname):
                print(f"WARNING: Required directory {dirname} not found!")
                continue

            print(f"Adding folder: {dirname}")
            for root, dirs, files in os.walk(dirname):
                dirs.sort()
                for file in sorted(files):
                    file_path = os.path.join(root, file)
                    zip_file.write(file_path, file_path)

    print(f"\nSuccessfully created Chrome package: {zip_path}")
    print("Upload this ZIP to the Chrome Web Store Developer Dashboard.")


if __name__ == "__main__":
    package_chrome_extension()
