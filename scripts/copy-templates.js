const fs = require('fs');
const path = require('path');

const templateGroups = [
  {
    sourceDir: path.join(__dirname, '..', 'src', 'emails', 'templates'),
    destDir: path.join(__dirname, '..', 'dist', 'emails', 'templates'),
    extensions: new Set(['.hbs']),
  },
  {
    sourceDir: path.join(__dirname, '..', 'src', 'templates', 'form12bb'),
    destDir: path.join(__dirname, '..', 'dist', 'templates', 'form12bb'),
    extensions: new Set(['.html']),
  },
  {
    sourceDir: path.join(__dirname, '..', 'src', 'templates', 'poi'),
    destDir: path.join(__dirname, '..', 'dist', 'templates', 'poi'),
    extensions: new Set(['.xlsx']),
  },
];

function copyTemplateGroup({ sourceDir, destDir, extensions }) {
  try {
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Source directory does not exist: ${sourceDir}`);
    }

    fs.mkdirSync(destDir, { recursive: true });
    const files = fs.readdirSync(sourceDir);
    let copiedCount = 0;

    files.forEach(file => {
      if (extensions.has(path.extname(file))) {
        const sourcePath = path.join(sourceDir, file);
        const destPath = path.join(destDir, file);
        
        fs.copyFileSync(sourcePath, destPath);
        console.log(`Copied: ${file}`);
        copiedCount++;
      }
    });

    console.log(`Copied ${copiedCount} template files to ${destDir}`);
  } catch (error) {
    console.error('Error copying templates:', error);
    process.exit(1);
  }
}

templateGroups.forEach(copyTemplateGroup);
