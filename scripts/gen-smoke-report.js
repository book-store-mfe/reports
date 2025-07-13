const fs = require('fs');
const path = require('path');

const report = JSON.parse(fs.readFileSync('playwright-report/results.json', 'utf-8'));

let md = '# Smoke Test Report\n\n';
md += '| Test | Status | Screenshot |\n|------|--------|------------|\n';

report.suites.forEach(suite => {
  suite.tests.forEach(test => {
    const name = test.title.join(' > ');
    const status = test.outcome === 'expected' ? '✅' : '❌';
    const screenshot = test.attachments?.find(a => a.name === 'screenshot')?.path || '';
    md += `| ${name} | ${status} | ${screenshot ? `![](${screenshot})` : ''} |\n`;
  });
});

fs.writeFileSync('smoke-report.md', md);
