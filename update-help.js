const fs = require('fs');

const contentFile = 'panel/frontend/src/content/help-content.ts';
let content = fs.readFileSync(contentFile, 'utf8');

// The user wants project introduction, workflows, architecture etc from README to be added to Help page.
// The easiest way is to add a new section in help-content.ts, e.g., PROJECT_INFO, and then modify Help.tsx to display it.
// Wait, the Help.tsx already has 'quick-start', 'faq', 'shortcuts', 'changelog', 'feedback'.
// We can add a 'project-intro' section at the beginning.

