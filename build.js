const fs = require('fs');
const path = require('path');

// Source directory (project root)
const projectRoot = path.resolve(__dirname, '..'); // scratch/gratis-testen-tracker
const buildDir = path.join(projectRoot, 'build');

console.log('Starting build...');

// Ensure build directory exists
fs.mkdirSync(buildDir, { recursive: true });

// Copy style.css from project root to build
fs.copyFileSync(path.join(projectRoot, 'style.css'), path.join(buildDir, 'style.css'));
console.log('Copied style.css');

// Copy app.js from project root to build
fs.copyFileSync(path.join(projectRoot, 'app.js'), path.join(buildDir, 'app.js'));
console.log('Copied app.js');

// Copy images folder recursively
function copyFolderRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyFolderRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
copyFolderRecursive(path.join(projectRoot, 'images'), path.join(buildDir, 'images'));
console.log('Copied images recursively');

// Convert data.js to data.json (strip the variable declaration)
const dataJsPath = path.join(projectRoot, 'data.js');
let dataContent = fs.readFileSync(dataJsPath, 'utf8');

// Find the array start after the first '['
const arrayStart = dataContent.indexOf('[');
const arrayEnd = dataContent.lastIndexOf(']');
if (arrayStart === -1 || arrayEnd === -1) {
  console.error('Could not locate array in data.js');
  process.exit(1);
}
let jsonArray = dataContent.slice(arrayStart, arrayEnd + 1);
// Remove any trailing commas before closing brackets for valid JSON
jsonArray = jsonArray.replace(/,\s*\]/g, ']');
fs.writeFileSync(path.join(buildDir, 'data.json'), jsonArray, 'utf8');
console.log('Created data.json');

// Read root index.html
const indexHtmlPath = path.join(projectRoot, 'index.html');
let indexContent = fs.readFileSync(indexHtmlPath, 'utf8');

// In root index.html, we have:
//   <script src="data.js?v=3.22"></script>
//   <script src="app.js?v=3.22"></script>
// Let's replace the script loading data.js with inline code.
// We'll read the data.js content and inject it directly.
const inlineDataScript = `<script>
  // Inlined from data.js to allow running locally without CORS errors
  ${dataContent.trim()}
  
  // Attach CAMPAIGNS to window to fit appState initialization
  window.CAMPAIGNS = CAMPAIGNS;
</script>`;

// Let's use a regex that matches <script src="data.js..."></script>
const dataScriptRegex = /<script\s+src=["']data\.js(?:\?v=[0-9.]*)?["']><\/script>/i;

if (dataScriptRegex.test(indexContent)) {
  indexContent = indexContent.replace(dataScriptRegex, inlineDataScript);
  console.log('Successfully inlined data.js content into index.html');
} else {
  console.warn('Could not find data.js script tag in index.html to replace. Using fallback replacement...');
  // Fallback: search for data.js
  indexContent = indexContent.replace(/<script src="data\.js[^"]*"><\/script>/i, inlineDataScript);
}

// Save compiled index.html to build folder
fs.writeFileSync(path.join(buildDir, 'index.html'), indexContent, 'utf8');
console.log('Created compiled build/index.html');

console.log('Build completed successfully.');
