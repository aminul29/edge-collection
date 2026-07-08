import os
import zipfile

def package_extension():
    zip_name = "edge-collections-sidebar-v1.0.8.zip"
    os.makedirs("dist", exist_ok=True)
    zip_path = os.path.join("dist", zip_name)
    
    # Files and directories to include in the package
    include_files = [
        "manifest.json",
        "background.js",
        "bing_scraper.js",
        "sidepanel.js",
        "sidepanel.html",
        "sidepanel.css",
        "fonts.css"
    ]
    
    include_dirs = [
        "icons",
        "fonts"
    ]
    
    print(f"Creating extension zip package at {zip_path}...")
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        # Add root files
        for filename in include_files:
            if os.path.exists(filename):
                print(f"Adding file: {filename}")
                zip_file.write(filename)
            else:
                print(f"WARNING: Required file {filename} not found!")
                
        # Add folders recursively
        for dirname in include_dirs:
            if os.path.exists(dirname):
                print(f"Adding folder: {dirname}")
                for root, dirs, files in os.walk(dirname):
                    for file in files:
                        file_path = os.path.join(root, file)
                        # Relative path inside zip
                        zip_file.write(file_path, file_path)
            else:
                print(f"WARNING: Required directory {dirname} not found!")
                
    print(f"\nSuccessfully created package: {zip_path}")
    print("This ZIP contains only the clean extension assets and is ready for submission to the Microsoft Edge Add-ons store.")

if __name__ == "__main__":
    package_extension()
